import {complete,modelEnabled} from './inference.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {compileHocon,emitHocon,demand} from './command-hocon.mjs';
import {inspectEvidence} from './studio-guardrails.mjs';

const short={type:'string',minLength:1,maxLength:48},sentence={type:'string',minLength:1,maxLength:150};
const agent={type:'object',properties:{role:short,instructions:sentence},required:['role','instructions'],additionalProperties:false};
const schema={type:'object',properties:{title:short,objective:sentence,mode:{type:'string',enum:['parallel','sequence']},coordinator:agent,specialists:{type:'array',items:agent,minItems:1,maxItems:5}},required:['title','objective','mode','coordinator','specialists'],additionalProperties:false};
async function design(prompt,draft){
 demand(modelEnabled(),'Connect the inference provider to generate a network.',503);
 const previous=draft?compileHocon(draft.source):null;
 const adding=previous&&/\badd\b/i.test(prompt)&&!/\b(remove|replace|rename)\b/i.test(prompt)&&!(/\badd\b[^.!?]*\band\b/i.test(prompt));
 if(adding)demand(previous.network.agents.length<6,'This network already has six agents.');
 const context=previous?{objective:previous.description,roles:previous.network.agents.map(a=>({role:a.role,task:a.instructions.slice(0,180),after:a.after,id:a.id}))}:null;
 let content;
 try{content=await complete({system:adding?'Identify the new specialist requested in the user message. Return only its short role name and one concrete instruction.': 'Design a small agent network for the requested work. For revisions preserve relevant roles and apply the requested change. The coordinator writes the final result. Give each specialist a distinct role and one short actionable instruction. Use only evidence supplied at run time. Match requested roles. Choose parallel unless tasks require sequence. Keep the title under eight words.',user:JSON.stringify({current:adding?undefined:context,request:inspectEvidence(prompt).modelInput}),schema:adding?agent:schema,temperature:0.15,maxTokens:adding?220:1024,timeout:90000});}
 catch{demand(false,'Inference provider unavailable. Retry or import a HOCON file.',503);}
 let p;try{p=JSON.parse(content);}catch{demand(false,'The designer returned an incomplete definition. Shorten the request and retry.',502);}
 if(adding){
  const nodes=structuredClone(previous.network.agents),root=nodes.pop();
  let i=1;while(previous.network.agents.some(a=>a.id==='agent_'+i))i++;
  const id='agent_'+i,serial=/\b(sequence|sequential|after all)\b/i.test(prompt);
  const named=prompt.match(/\badd\s+(?:(?:a|an|one|another|new)\s+)*([\w -]{2,65}?)(?=\s+(?:as|who|that|to|in parallel|after|before)\b|[.,;!?]|$)/i)?.[1]?.trim();
  const name=named&&!/\band\b/.test(named)?named:p.role;
  nodes.push({id,role:name,instructions:p.instructions,after:serial?[...root.after]:[]});
  root.after=serial?[id]:[...root.after,id];
  return emitHocon(previous.title,previous.description,[root,...nodes]);
 }
 demand(Array.isArray(p.specialists)&&p.specialists.length>0&&p.specialists.length<=5&&p.coordinator,'Invalid designer output.',502);
 const lead=prompt.match(/(?:^|[.!?]\s+)(?:a|an|the) ([\w -]{2,45}?) (?:combines|consolidates|synthesizes)\b/i)?.[1]?.trim();
 const coordinator=lead?{...p.coordinator,role:lead}:p.coordinator;
 const others=p.specialists.filter(s=>s.role.toLowerCase()!==coordinator.role.toLowerCase());
 const workers=others.map((s,i)=>({...s,id:'agent_'+(i+1),after:p.mode==='sequence'&&i?['agent_'+i]:[]}));
 const explicitTitle=prompt.match(/^(?:build|design|create)\s+(?:a |an )?([\w -]{2,64}? network)\b/i)?.[1];
 const title=explicitTitle?explicitTitle[0].toUpperCase()+explicitTitle.slice(1):p.title?.trim()||previous?.title||prompt;
 return emitHocon(title.slice(0,100),(p.objective?.trim()||prompt).slice(0,1200),[{...coordinator,id:'coordinator',after:p.mode==='sequence'&&workers.length?[workers.at(-1).id]:workers.map(w=>w.id)},...workers]);
}

export function commandCentre(db,{body,role,audit,transaction}){
 db.exec(`CREATE TABLE IF NOT EXISTS command_drafts(id TEXT PRIMARY KEY,org TEXT,dept TEXT,revision INTEGER,title TEXT,source TEXT,messages TEXT,updated TEXT);
 CREATE TABLE IF NOT EXISTS command_releases(policy INTEGER PRIMARY KEY REFERENCES studio_policies(id),draft TEXT REFERENCES command_drafts(id),revision INTEGER,source TEXT,digest TEXT,UNIQUE(draft,revision));`);
 return async(req,user,path)=>{
  const scope=[user.org,user.department];
  const get=id=>{const row=db.prepare('SELECT * FROM command_drafts WHERE id=? AND org=? AND dept=?').get(id,...scope);demand(row,'Network not found.',404);return row;};
  function details(id){
   const d=get(id);const release=db.prepare('SELECT policy,digest FROM command_releases WHERE draft=? AND revision=?').get(id,d.revision);
   const runs=db.prepare(`SELECT r.id,r.state,r.result,r.actor,r.created,c.revision FROM studio_runs r JOIN command_releases c ON c.policy=r.policy WHERE c.draft=? AND r.org=? AND r.dept=? AND (?<>'officer' OR r.actor=?) ORDER BY r.created DESC LIMIT 12`).all(id,...scope,user.role,user.email);
   return {id,title:d.title,revision:d.revision,source:d.source,messages:JSON.parse(d.messages),graph:compileHocon(d.source).network,release,runs:runs.map(r=>({...r,result:JSON.parse(r.result)}))};
  }
  if(req.method==='GET'){
   if(path==='/api/command')return db.prepare('SELECT id,title,revision FROM command_drafts WHERE org=? AND dept=? ORDER BY updated DESC').all(...scope);
   return details(path.slice('/api/command/'.length));
  }
  demand(req.method==='POST','Use POST.',405);role(user,'admin');
  const input=await body(req),existing=input.id?get(input.id):null;
  if(existing)demand(existing.revision===input.revision,'Network changed. Reload before editing.',409);
  const now=new Date().toISOString(),id=existing?.id||randomUUID();
  if(path==='/api/command/publish'){
   demand(existing,'Create a network first.');
   return transaction(()=>{
    const prior=db.prepare('SELECT policy FROM command_releases WHERE draft=? AND revision=?').get(id,existing.revision);if(prior)return details(id);
    const {network,title,description}=compileHocon(existing.source),digest=createHash('sha256').update(existing.source).digest('hex');
    const policy=Number(db.prepare('INSERT INTO studio_policies(org,dept,title,agent,sop,fields,source,author,created,approver,strategy,network) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...scope,title,network.agents.at(-1).role,description,'[]','',user.email,now,'','Agent network',JSON.stringify(network)).lastInsertRowid);
    db.prepare('INSERT INTO command_releases VALUES(?,?,?,?,?)').run(policy,id,existing.revision,existing.source,digest);audit(user,id,'command_published',{policy,digest});return details(id);
   });
  }
  const chat=path==='/api/command/chat';
  demand(chat||path==='/api/command/save','Unknown operation.',404);
  if(chat)demand(typeof input.prompt==='string'&&input.prompt.trim()&&input.prompt.length<=2000,'Describe the network in 1–2,000 characters.');
  const source=chat?await design(input.prompt,existing):input.source;
  const {title,network}=compileHocon(source);
  const messages=existing?JSON.parse(existing.messages):[];
  if(chat)messages.push({role:'user',text:input.prompt});
  messages.push({role:'designer',text:(chat?'Designed ':'Validated ')+title+' with '+network.agents.length+' agents.'});
  return transaction(()=>{
   if(existing){
    const r=db.prepare('UPDATE command_drafts SET source=?,title=?,messages=?,updated=?,revision=revision+1 WHERE id=? AND revision=?').run(source,title,JSON.stringify(messages.slice(-60)),now,id,existing.revision);demand(r.changes===1,'Network changed. Reload before editing.',409);
   }else db.prepare('INSERT INTO command_drafts VALUES(?,?,?,?,?,?,?,?)').run(id,...scope,1,title,source,JSON.stringify(messages),now);
   audit(user,id,chat?'command_designed':'command_saved',{});return details(id);
  });
 };
}
