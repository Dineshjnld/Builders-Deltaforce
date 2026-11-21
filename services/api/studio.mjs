import {modelEnabled,usingBedrock} from './inference.mjs';
import {compileHocon} from './command-hocon.mjs';
import {networkSpec,starterNetwork} from './agent-network.mjs';
import {runSpecialists} from './studio-agents.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {inspectEvidence} from './studio-guardrails.mjs';
import {performance} from 'node:perf_hooks';

import {waterContext,source as waterSource} from './public-context.mjs';
import {districtCatalog,indiaAiCatalog,searchDistricts} from './gov-data.mjs';

export const templates=[
 ['Administration','Department briefing','subject','Briefing analyst','https://igod.gov.in/'],
 ['Program delivery','Project review','project reference','Program analyst','https://igod.gov.in/'],
 ['Enterprise','Architecture review','system','Architecture reviewer',''],
 ['Revenue','Application completeness','application reference','Revenue caseworker','https://bhubharati.telangana.gov.in/Bhubharati_userManuals'],
 ['Rural water','Water supply inspection','location','Field engineer','https://www.ejalshakti.gov.in/JJMReport/JJMIndia.aspx'],
 ['Health administration','Facility maintenance','facility','Facility officer','https://www.telangana.gov.in/departments/'],
 ['Police administration','Service request acknowledgement','request reference','Service desk officer','https://www.telangana.gov.in/departments/'],
 ['Enterprise','Technical design review','system','Architecture reviewer','']
].map(([department,title,field,agent,source])=>({department,title,field,agent,source}));

function check(ok,status,message){if(!ok)throw Object.assign(new Error(message),{status});}
function value(input,max){return typeof input==='string'?input.trim().slice(0,max):'';}
function language(text){
 const scripts=[[/\p{Script=Telugu}/u,'te'],[/\p{Script=Devanagari}/u,'hi'],[/[A-Za-z]{2}/,'en']];
 return scripts.filter(([re])=>re.test(text)).map(([,code])=>code).join('+')||'und';
}
function assess(note,fields){
 return fields.filter(field=>!note.split(/\r?\n/).some(line=>{
 const at=line.indexOf('=');
 return at>0 && line.slice(0,at).trim().toLowerCase()===field.toLowerCase() && line.slice(at+1).trim().length>0;
 }));
}
function evaluate(fields){
 const complete=fields.map(f=>f+' = Synthetic example').join('\n');
 return [{name:'Complete intake',pass:assess(complete,fields).length===0},
 {name:'Missing evidence',pass:assess('Unstructured note',fields).length===fields.length},
 {name:'Private identifier removed from model input',pass:!inspectEvidence('Contact demo@example.test').modelInput.includes('@')},
 {name:'Approval override detected',pass:inspectEvidence('bypass approval').suspicious},
 {name:'Empty field',pass:assess(fields[0]+' = ',fields).includes(fields[0])}];
}
export function studio(db,{body,role,audit,transaction}){
 db.exec(`CREATE TABLE IF NOT EXISTS studio_policies(id INTEGER PRIMARY KEY,org TEXT,dept TEXT,title TEXT,agent TEXT,sop TEXT,fields TEXT,source TEXT,author TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS studio_runs(id TEXT PRIMARY KEY,org TEXT,dept TEXT,policy INTEGER REFERENCES studio_policies(id),evidence TEXT,result TEXT,state TEXT,actor TEXT,created TEXT);
 CREATE INDEX IF NOT EXISTS studio_scope ON studio_runs(org,dept,created);`);
 if(!db.prepare('PRAGMA table_info(studio_policies)').all().some(c=>c.name==='approver'))db.exec('ALTER TABLE studio_policies ADD COLUMN approver TEXT');
 if(!db.prepare('PRAGMA table_info(studio_policies)').all().some(c=>c.name==='strategy'))db.exec("ALTER TABLE studio_policies ADD COLUMN strategy TEXT DEFAULT 'Parallel review'");
 if(!db.prepare('PRAGMA table_info(studio_policies)').all().some(c=>c.name==='network'))db.exec('ALTER TABLE studio_policies ADD COLUMN network TEXT');
 const activeNetworks=new Map();
 return async(req,user,path)=>{
 const scope=[user.org,user.department];
 if(req.method==='GET'&&path==='/api/studio/networks')return db.prepare("SELECT id,title,created,fields FROM studio_policies WHERE org=? AND dept=? AND strategy='Agent network' ORDER BY id DESC").all(...scope).map(row=>({...row,fields:JSON.parse(row.fields)}));
 if(req.method==='GET'&&path==='/api/studio/overview'){
  const filter="org=? AND dept=? AND (?<>'officer' OR actor=?)";
  const args=[...scope,user.role,user.email];
  const counts=db.prepare("SELECT count(*) FILTER (WHERE state='Pending') pending,count(*) FILTER (WHERE state<>'Pending') reviewed FROM studio_runs WHERE "+filter).get(...args);
  return {...counts,templates,policies:db.prepare('SELECT count(*) n FROM studio_policies WHERE org=? AND dept=?').get(...scope).n,
   cases:db.prepare('SELECT count(*) n FROM cases WHERE org=? AND department=?').get(...scope).n,
   activity:db.prepare("SELECT created,state,(SELECT title FROM studio_policies WHERE id=policy) title FROM studio_runs WHERE "+filter+" ORDER BY created DESC LIMIT 5").all(...args)};
 }
 if(req.method==='GET'&&path==='/api/studio/data')return {...districtCatalog(),indiaAI:indiaAiCatalog()};
 if(req.method==='POST'&&path==='/api/studio/districts'){
  const input=await body(req);
  return searchDistricts({state:value(input.state,80),query:value(input.query,100)});
 }
 const policies=db.prepare('SELECT * FROM studio_policies WHERE org=? AND dept=? ORDER BY id DESC').all(...scope);
 if(req.method==='GET'&&path==='/api/studio')return {templates,starterNetwork,policies,supervisors:user.role==='admin'?db.prepare("SELECT email FROM users WHERE org=? AND department=? AND role='supervisor' ORDER BY email").all(...scope):[],runs:db.prepare("SELECT id,policy,result,state,actor,created FROM studio_runs WHERE org=? AND dept=? AND (?<>'officer' OR actor=?) ORDER BY created DESC LIMIT 40").all(...scope,user.role,user.email),localModel:!!process.env.STUDIO_MODEL_URL};
 check(req.method==='POST',405,'Use POST');
 const input=await body(req);
 if(path==='/api/studio/transcribe'){
  role(user,'admin','officer','supervisor');
  check(process.env.SPEECH_URL,503,'Private speech worker unavailable.');
  check(['en','te','hi'].includes(input.language),400,'Choose a supported language.');
  let bytes;
  if(input.caseId){
   const row=db.prepare("SELECT attachment FROM evolution_messages JOIN cases ON id=case_id WHERE org=? AND department=? AND id=? AND message_type='voice'").get(...scope,input.caseId);
   check(row?.attachment,404,'Voice attachment unavailable.');bytes=row.attachment;
  }else{
   check(typeof input.audio==='string'&&input.audio.length<=4000000,400,'Supply a short WAV or Ogg recording.');
   bytes=Buffer.from(input.audio,'base64');
  }
  check(bytes.length>0&&bytes.length<=3000000,413,'Audio must fit within 3 MB.');
  let response;
  try{response=await fetch(process.env.SPEECH_URL+'/transcribe/'+input.language,{method:'POST',body:bytes,signal:AbortSignal.timeout(30000)});}
  catch{check(false,503,'Speech worker unavailable.');}
  const result=await response.json();check(response.ok,response.status,result.error);
  audit(user,input.caseId||'file','speech_transcribed',{language:input.language,ms:result.ms});
  return result;
 }
 if(path==='/api/studio/publish'||path==='/api/studio/evaluate'){
 role(user,'admin');
 const fields=[...new Set(value(input.fields,500).split(',').map(s=>s.trim()).filter(Boolean))];
 check(fields.length>0&&fields.length<=12&&fields.every(f=>f.length<=60&&!/[=\r\n]/.test(f)),400,'Enter 1–12 required field names.');
 const title=value(input.title,100),agent=value(input.agent,80),sop=value(input.sop,5000),source=value(input.source,500);
 check(title&&agent&&sop.length>=12&&(!source||/^https:\/\//.test(source)),400,'Enter a title, officer role, SOP and optional HTTPS source.');
 const approver=value(input.approver,254);
 const strategy=input.strategy??'Parallel review';
 check(['Parallel review','Single specialist','Rules only','Agent network'].includes(strategy),400,'Unknown execution strategy.');
 if(approver)check(db.prepare("SELECT 1 FROM users WHERE org=? AND department=? AND role='supervisor' AND email=?").get(...scope,approver),400,'Select a department supervisor.');
 const network=strategy==='Agent network'?networkSpec(input.network):null;
 const tests=evaluate(fields);
 if(network)tests.push({name:'Acyclic network with one final handoff',pass:true});
 const replay=db.prepare('SELECT id,evidence,result FROM studio_runs WHERE org=? AND dept=? ORDER BY created DESC LIMIT 20').all(...scope).map(r=>({id:r.id,before:JSON.parse(r.result).missing,after:assess(r.evidence,fields)}));
 if(path.endsWith('evaluate'))return {tests,replay};
 check(tests.every(t=>t.pass),409,'Evaluation failed.');
 return transaction(()=>{const id=Number(db.prepare('INSERT INTO studio_policies(org,dept,title,agent,sop,fields,source,author,created,approver,strategy,network) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...scope,title,agent,sop,JSON.stringify(fields),source,user.email,new Date().toISOString(),approver,strategy,network?JSON.stringify(network):null).lastInsertRowid);audit(user,String(id),'studio_published',{tests,strategy});return {id};});
 }
 if(path==='/api/studio/run'||path==='/api/studio/invoke'){
 role(user,'admin','officer','supervisor');
 const policy=policies.find(p=>p.id===Number(input.policy));check(policy,404,'Workflow not found.');
 const external=path.endsWith('/invoke');
 let id=randomUUID(),fingerprint;
 function priorReceipt(){
  const row=db.prepare('SELECT state,result FROM studio_runs WHERE id=? AND org=? AND dept=? AND actor=?').get(id,...scope,user.email);
  if(!row)return null;
  check(JSON.parse(row.result).requestDigest===fingerprint,409,'Request ID reused with different input.');
  return {id,state:row.state,policy:policy.id};
 }
 if(external){
  check(policy.strategy==='Agent network',404,'Published network not found.');
  check(typeof input.requestId==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(input.requestId),400,'Supply a stable request ID.');
  check(typeof input.evidence==='string'&&input.evidence.trim()&&input.evidence.length<=8000&&!input.caseId&&!input.inspectionId,400,'Supply direct evidence of up to 8000 characters.');
  id=createHash('sha256').update(JSON.stringify([...scope,user.id,input.requestId])).digest('hex');
  fingerprint=createHash('sha256').update(JSON.stringify([policy.id,input.evidence,input.state??'',input.district??''])).digest('hex');
  const prior=priorReceipt();if(prior)return prior;
 }
 const release=db.prepare('SELECT source,digest FROM command_releases WHERE policy=?').get(policy.id);
 if(release)policy.network=JSON.stringify(compileHocon(release.source).network);
 let evidence=value(input.evidence,8000),origin='Direct intake';
 if(input.caseId){const row=db.prepare('SELECT message_text,message_type FROM cases WHERE org=? AND department=? AND id=?').get(...scope,input.caseId);check(row,404,'Case not found.');evidence=row.message_type==='voice'?evidence:row.message_text;check(evidence,422,'This case needs a reviewed transcript or caption.');origin=(row.message_type==='api'?'Intake API ':'WhatsApp ')+input.caseId;}
 if(input.inspectionId){const row=db.prepare('SELECT content,officer FROM inspections WHERE org=? AND department=? AND id=?').get(...scope,input.inspectionId);check(row&&(user.role!=='officer'||row.officer===user.id),404,'Inspection not found.');const c=JSON.parse(row.content);evidence=[c.transcript,c.observations,c.location&&'location = '+c.location].filter(Boolean).join('\n');origin='Field inspection '+input.inspectionId;}
 check(evidence,400,'Provide case evidence.');
 const start=performance.now(),missing=assess(evidence,JSON.parse(policy.fields));
 const guard=inspectEvidence(evidence);
 const action=guard.suspicious?'Review flagged evidence':missing.length?'Request clarification':'Forward for officer review';
 const result={flags:guard.flags,action,missing,origin,language:language(evidence),sop:policy.sop,source:policy.source,trace:['Intake clerk · evidence registered','Policy researcher · published SOP loaded',policy.agent+' · required fields checked','Security reviewer · supervisor approval required'],engine:'Local rules',summary:'',evidence};
 if(policy.source===waterSource&&input.state)result.publicContext=waterContext(input.state);
 if(input.district){
  const [record]=searchDistricts({state:value(input.state,80),query:value(input.district,100),exact:true});
  check(record&&record.name===input.district&&record.state===input.state,400,'Select a district in the chosen state.');
  result.district=record;result.trace.push('District verified against the iGOD snapshot');
 }
 if(release)result.sourceDigest=release.digest;
 result.strategy=policy.strategy;
 if(modelEnabled()&&!guard.suspicious&&policy.strategy!=='Rules only'){
 if(policy.strategy==='Agent network'){
  const tenant=JSON.stringify(scope);
  check(!activeNetworks.has(id),409,'A request with this ID is running. Retry with the same ID.');
  check(activeNetworks.size<8&&[...activeNetworks.values()].filter(value=>value===tenant).length<2,429,'Network capacity reached. Retry shortly.');
  activeNetworks.set(id,tenant);
  try{result.specialists=await runSpecialists(policy,guard.modelInput,missing,result.district);}
  finally{activeNetworks.delete(id);}
 }else result.specialists=await runSpecialists(policy,guard.modelInput,missing,result.district);
 result.summary=(policy.strategy==='Agent network'?result.specialists.at(-1):result.specialists[0]).output;
 if(policy.strategy==='Agent network'){
  result.runtime='LangGraph.js';result.networkState=result.specialists.at(-1).status;
  if(result.networkState!=='Completed')result.action='Review incomplete network run';
 }
 if(result.specialists.some(agent=>agent.status==='Completed'))result.engine=usingBedrock()?'Amazon Bedrock + rules':'Local model + rules';
 for(const agent of result.specialists)result.trace.push(agent.role+' · '+agent.status+' · '+agent.ms+' ms');
 }
 if(policy.strategy==='Agent network'&&!result.networkState){
  result.networkState=guard.suspicious?'Held by guardrail':'Model unavailable';
  result.action='Review network hold';result.trace.push(result.networkState);
 }
 result.ms=Math.round(performance.now()-start);
 if(external)result.requestDigest=fingerprint;
 return transaction(()=>{
  if(external){const prior=priorReceipt();if(prior)return prior;}
  db.prepare('INSERT INTO studio_runs VALUES(?,?,?,?,?,?,?,?,?)').run(id,...scope,policy.id,evidence,JSON.stringify(result),'Pending',user.email,new Date().toISOString());
  audit(user,id,'studio_run',{policy:policy.id,ms:result.ms,intake:external?'Network API':'Studio'});
  return external?{id,state:'Pending',policy:policy.id}:{id,...result};
 });
 }
 if(path==='/api/studio/decision'){role(user,'supervisor');check(['Approved','Returned'].includes(input.state),400,'Invalid decision.');
 return transaction(()=>{const changed=db.prepare("UPDATE studio_runs SET state=? WHERE id=? AND org=? AND dept=? AND state='Pending' AND actor<>? AND policy IN (SELECT id FROM studio_policies WHERE coalesce(approver,'')='' OR approver=?)").run(input.state,input.id,...scope,user.email,user.email);check(changed.changes===1,409,'Run unavailable or already reviewed.');audit(user,input.id,'studio_decision',{state:input.state});return {state:input.state};});}
 check(false,404,'Unknown Studio operation.');
 };
}
