import {createHash,randomBytes,randomUUID} from 'node:crypto';

const hash=text=>createHash('sha256').update(text).digest('hex');
function fail(status,message){throw Object.assign(new Error(message),{status});}
async function probe(base,path){
 if(!base)return 'Unconfigured';
 try{const response=await fetch(base+path,{signal:AbortSignal.timeout(2000)});return response.ok?'Reachable':'Unavailable';}
 catch{return 'Unavailable';}
}

export function connectors(db,{role,body,audit,transaction}){
 db.exec('CREATE TABLE IF NOT EXISTS intake_keys(org TEXT,department TEXT,digest TEXT UNIQUE,PRIMARY KEY(org,department))');
 db.exec('CREATE TABLE IF NOT EXISTS network_keys(org TEXT,department TEXT,digest TEXT UNIQUE,expires INTEGER,PRIMARY KEY(org,department))');
 return {
  networkIdentity(req,path){
   const token=req.headers.authorization?.match(/^Bearer (dgn_[a-f0-9]{64})$/)?.[1];
   if(!token)return null;
   if(!['/api/studio/networks','/api/studio/invoke'].includes(path))fail(403,'Network credential scope exceeded.');
   const owner=db.prepare('SELECT org,department FROM network_keys WHERE digest=? AND expires>?').get(hash(token),Date.now());
   if(!owner)fail(401,'Expired or invalid network credential.');
   return {...owner,id:'network-connector',email:'network-connector',role:'officer'};
  },
  async catalog(req,user){
   const scope=[user.org,user.department];
   if(req.method==='POST'){
    role(user,'admin');const input=await body(req);
    if(!['rotate','revoke'].includes(input.action))fail(400,'Unknown key operation.');
    if(input.scope==='networks')return transaction(()=>{
     db.prepare('DELETE FROM network_keys WHERE org=? AND department=?').run(...scope);
     const token=input.action==='rotate'?'dgn_'+randomBytes(32).toString('hex'):null;
     if(token)db.prepare('INSERT INTO network_keys VALUES(?,?,?,?)').run(...scope,hash(token),Date.now()+30*86400000);
     audit(user,'networks','connector_'+input.action,{});return {token};
    });
    return transaction(()=>{
     db.prepare('DELETE FROM intake_keys WHERE org=? AND department=?').run(...scope);
     const token=input.action==='rotate'?randomBytes(32).toString('hex'):null;
     if(token)db.prepare('INSERT INTO intake_keys VALUES(?,?,?)').run(...scope,hash(token));
     audit(user,'intake','connector_'+input.action,{});
     return {token};
    });
   }
   if(req.method!=='GET')fail(405,'Use GET or POST.');
   const scoped=process.env.WHATSAPP_CASE_ORG===user.org&&process.env.WHATSAPP_CASE_DEPARTMENT===user.department;
   const [model,bridge]=await Promise.all([probe(process.env.STUDIO_MODEL_URL,'/health'),scoped?probe(process.env.EVOLUTION_CONNECTOR_URL,'/health'):'Unassigned']);
   let device='Unknown';
   if(scoped&&bridge==='Reachable'){
    try{const response=await fetch(process.env.EVOLUTION_CONNECTOR_URL+'/internal/device-state',{headers:{'X-Approval-Key':process.env.EVOLUTION_APPROVAL_KEY},signal:AbortSignal.timeout(3000)});if(response.ok)device=(await response.json()).state;}catch{}
   }
   return {model,bridge,device,speech:await probe(process.env.SPEECH_URL,'/health'),networkKey:!!db.prepare('SELECT 1 FROM network_keys WHERE org=? AND department=? AND expires>?').get(...scope,Date.now()),keyEnabled:!!db.prepare('SELECT 1 FROM intake_keys WHERE org=? AND department=?').get(...scope),checked:new Date().toISOString()};
  },
  async accept(req){
   const token=req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
   const owner=token&&db.prepare('SELECT org,department FROM intake_keys WHERE digest=?').get(hash(token));
   if(!owner)fail(401,'Invalid intake credential.');
   const input=await body(req);
   if(typeof input.id!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(input.id)||typeof input.text!=='string'||!input.text.trim()||input.text.length>8000)fail(400,'Supply an event ID and up to 8000 text characters.');
   const key='api:'+hash(JSON.stringify([owner.org,owner.department,input.id]));
   return transaction(()=>{
    const existing=db.prepare('SELECT id,message_text FROM cases WHERE whatsapp_message_id=?').get(key);
    if(existing){if(existing.message_text!==input.text)fail(409,'Event ID already used with different content.');return {id:existing.id,stored:false};}
    const id=randomUUID();
    db.prepare('INSERT INTO cases(id,org,department,whatsapp_message_id,sender,message_type,message_text,received_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner.org,owner.department,key,'intake-api','api',input.text,new Date().toISOString());
    audit({...owner,email:'intake-api'},id,'case_created',{channel:'api'});
    return {id,stored:true};
   });
  }
 };
}
