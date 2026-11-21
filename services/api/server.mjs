import {commandCentre} from './command.mjs';
import {studio} from './studio.mjs';
import {connectors} from './connectors.mjs';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {readFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {categories,processObservation} from '../ai-core/inspection.mjs';
import {baselineFields,compileWorkflow} from '../ai-core/compiler.mjs';

const database = process.env.DB_PATH ?? 'var/fieldos.sqlite';
if(database!==':memory:') mkdirSync(dirname(database),{recursive:true});
const db = new DatabaseSync(database);
db.exec('PRAGMA busy_timeout=5000');
db.exec(readFileSync(new URL('../../infrastructure/migrations/001.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../../infrastructure/migrations/002.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../../infrastructure/migrations/003.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../../infrastructure/migrations/004.sql',import.meta.url),'utf8'));
const query = (sql,...args)=>db.prepare(sql).all(...args);
const one = (sql,...args)=>db.prepare(sql).get(...args);
const run = (sql,...args)=>db.prepare(sql).run(...args);
const now = ()=>new Date().toISOString();
function fail(status,message){ throw Object.assign(new Error(message),{status}); }
function requireThat(condition,status,message){if(!condition) fail(status,message);}
function transaction(action){
  db.exec('BEGIN IMMEDIATE');
  try {const result=action();db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
}
const clean=(value,max)=>typeof value==='string' ? value.trim().slice(0,max) : '';
const digest=value=>createHash('sha256').update(value).digest('hex');
function passwordHash(password,salt=randomBytes(16).toString('hex')){
  return salt+':'+scryptSync(password,salt,64).toString('hex');
}
function addUser(org,department,email,password,role){
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&password.length>=10,400,'Use a valid email and a password of at least 10 characters.');
  requireThat(!one('SELECT id FROM users WHERE email=?',email),409,'Email already registered.');
  const id=randomUUID();
  run('INSERT INTO users VALUES(?,?,?,?,?,?)',id,org,department,email,passwordHash(password),role);
  return id;
}
if(process.env.DELTA_DEMO==='1'&&!one('SELECT id FROM organizations WHERE id=?','demo')){
  transaction(()=>{
    run('INSERT INTO organizations VALUES(?,?)','demo','Vennela Municipal Services');
    for(const role of ['officer','supervisor','admin','auditor']) addUser('demo','Sanitation',role+'@vennela.example','FieldOS-demo-2026',role);
  });
}
if(process.env.DELTA_DEMO==='1'&&!one('SELECT id FROM organizations WHERE id=?','studio-demo')){
  transaction(()=>{
    run('INSERT INTO organizations VALUES(?,?)','studio-demo','Government innovation lab');
    for(const role of ['officer','supervisor','admin','auditor']) addUser('studio-demo','Program operations',role+'@studio.example','AgentStudio-demo-2026',role);
  });
}
if(process.env.DELTA_DEPLOYMENT==='pilot'){
  if(process.env.DELTA_DEMO==='1'||process.env.DELTA_ALLOW_SIGNUP==='1'||process.env.DELTA_HTTPS!=='1')throw Error('Pilot deployment requires private provisioning and HTTPS cookies.');
  if(one("SELECT id FROM organizations WHERE id IN ('studio-demo','demo')"))throw Error('Use a clean pilot database.');
  transaction(()=>{
    if(one('SELECT id FROM users LIMIT 1'))return;
    const configuration=JSON.parse(readFileSync(process.env.STUDIO_BOOTSTRAP_FILE,'utf8').replace(/^\uFEFF/,''));
    const org=clean(configuration.organization,120),department=clean(configuration.department,120);
    requireThat(org&&department&&typeof configuration.password==='string'&&configuration.password.length>=16,400,'Invalid pilot bootstrap file.');
    const id=randomUUID();
    run('INSERT INTO organizations VALUES(?,?)',id,org);
    addUser(id,department,clean(configuration.email,254).toLowerCase(),configuration.password,'admin');
  });
}
const sessionUser=(req)=>{
  const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
    req.headers.cookie?.match(/(?:^|; )delta=([a-f0-9]{64})(?:;|$)/)?.[1];
  const user=token&&one('SELECT u.id,u.org,u.department,u.email,u.role,o.name organization FROM sessions s JOIN users u ON u.id=s.user JOIN organizations o ON u.org=o.id WHERE s.token=? AND s.expires>?',digest(token),Date.now());
  requireThat(user,401,'Please sign in.');
  return user;
};
async function body(req){
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    requireThat(size<=4_300_000,413,'Request exceeds the upload limit.');
    chunks.push(chunk);
  }
  try {const data=JSON.parse(Buffer.concat(chunks).toString());if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}
  catch{fail(400,'Send a JSON object.');}
}
function audit(user,id,action,details={}){
  run('INSERT INTO events(org,department,actor,inspection,action,details,timestamp) VALUES(?,?,?,?,?,?,?)',
      user.org,user.department,user.email,id,action,JSON.stringify(details),now());
}
const projection='id,officer,status,version,content,updated';
function report(user,id){
  const row=one('SELECT '+projection+' FROM inspections WHERE org=? AND department=? AND id=?',user.org,user.department,id);
  requireThat(row&&(user.role!=='officer'||row.officer===user.id),404,'Inspection not found.');
  return {...row,content:JSON.parse(row.content)};
}
const published=user=>one('SELECT id,title,required,source_hash FROM workflow_versions WHERE org=? AND department=? AND status=?',user.org,user.department,'published');
const role=(user,...roles)=>requireThat(roles.includes(user.role),403,'Your role cannot perform this action.');
const attempts=new Map();

const integration=connectors(db,{audit,transaction,body,role});
const studioApi=studio(db,{body,role,audit,transaction});
const commandApi=commandCentre(db,{body,role,audit,transaction});
async function api(req,res,path){
  const post=req.method==='POST';
  if(post) requireThat(req.headers['content-type']?.startsWith('application/json'),415,'Use application/json.');
  if(req.method==='GET'&&path==='/api/config')return {demo:process.env.DELTA_DEMO==='1',signup:process.env.DELTA_DEMO==='1'||process.env.DELTA_ALLOW_SIGNUP==='1'};
  if(post&&path==='/api/login'){
    const key=req.socket.remoteAddress;
    const limit=attempts.get(key);
    requireThat(!limit||limit.until<Date.now()||limit.count<12,429,'Too many attempts. Try again in one minute.');
    const input=await body(req);
    const user=one('SELECT * FROM users WHERE email=?',clean(input.email,254).toLowerCase());
    const candidate=passwordHash(clean(input.password,256),user?.password.split(':')[0]??'00000000000000000000000000000000');
    if(!user||!timingSafeEqual(Buffer.from(candidate),Buffer.from(user.password))){
      if(!limit||limit.until<Date.now()) attempts.set(key,{until:Date.now()+60000,count:1});else limit.count++;
      fail(401,'Invalid credentials.');
    }
    attempts.delete(key);
    const token=randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)',digest(token),user.id,Date.now()+43200000);
    res.setHeader('Set-Cookie','delta='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(process.env.DELTA_HTTPS==='1'?'; Secure':''));
    return {token,role:user.role};
  }
  if(post&&path==='/api/organizations'){
    requireThat(process.env.DELTA_ALLOW_SIGNUP==='1'||process.env.DELTA_DEMO==='1',403,'Organization signup is disabled.');
    const input=await body(req);
    return transaction(()=>{
      const id=randomUUID();
      const name=clean(input.name,120),department=clean(input.department,120);
      requireThat(name&&department,400,'Enter an organization and department.');
      run('INSERT INTO organizations VALUES(?,?)',id,name);
      addUser(id,department,clean(input.email,254).toLowerCase(),clean(input.password,256),'admin');
      return {id};
    });
  }
  if(post&&path==='/api/intake')return integration.accept(req);
  const user=integration.networkIdentity(req,path)??sessionUser(req);
  if(path==='/api/connectors')return integration.catalog(req,user);
  if(path==='/api/command'||path.startsWith('/api/command/'))return commandApi(req,user,path);
  if(path==='/api/studio'||path.startsWith('/api/studio/'))return studioApi(req,user,path);
  if(post&&path==='/api/logout'){
    const token=req.headers.authorization?.slice(7)??req.headers.cookie?.match(/(?:^|; )delta=([a-f0-9]{64})/)?.[1];
    if(token)run('DELETE FROM sessions WHERE token=?',digest(token));
    res.setHeader('Set-Cookie','delta=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/');
    return {};
  }
  if(req.method==='GET'&&path==='/api/me') return process.env.EVOLUTION_CONNECTOR_URL ? {...user,evolutionEnabled:true} : user;
  if(req.method==='GET'&&path==='/api/cases'){
    if (!process.env.EVOLUTION_CONNECTOR_URL) {
      return query('SELECT id,message_type,message_text,received_at FROM cases WHERE org=? AND department=? ORDER BY received_at DESC,id DESC LIMIT 100',user.org,user.department);
    }
    return query(`
      SELECT c.id,c.message_type,c.message_text,c.received_at,
             e.case_id IS NOT NULL AS evolution,e.attachment IS NOT NULL AS has_attachment,
             COALESCE(e.provider_id NOT LIKE 'fixture-%' AND c.sender LIKE '%@s.whatsapp.net',0) AS can_reply,
             r.state AS response_state
      FROM cases c LEFT JOIN evolution_messages e ON c.id=e.case_id
      LEFT JOIN whatsapp_responses r ON c.id=r.case_id
      WHERE c.org=? AND c.department=? ORDER BY c.received_at DESC,c.id DESC LIMIT 100
    `,user.org,user.department);
  }
  const responseCase = path.match(/^\/api\/cases\/([a-f0-9-]+)\/response$/);
  if(post && responseCase && process.env.EVOLUTION_CONNECTOR_URL){
    role(user,'supervisor');
    const input=await body(req);
    const message=typeof input.text==='string'?input.text.trim():'';
    requireThat(message && message.length<=4096,400,'Enter a response up to 4096 characters.');
    let response;
    try {
      response=await fetch(process.env.EVOLUTION_CONNECTOR_URL+'/internal/approved-response',{
        method:'POST',signal:AbortSignal.timeout(20000),
        headers:{'Content-Type':'application/json','X-Approval-Key':process.env.EVOLUTION_APPROVAL_KEY},
        body:JSON.stringify({case_id:responseCase[1],org:user.org,department:user.department,approver:user.email,body:message})
      });
    } catch {
      fail(502,'Connector unavailable. Refresh Cases to check the send status.');
    }
    const result=await response.json();
    requireThat(response.ok,response.status,result.detail);
    return result;
  }
  if(req.method==='GET'&&path==='/api/workflows'){
    const active=published(user);
    return {
      active:active ? {...active,required:JSON.parse(active.required)} : {id:0,title:'Sanitation inspection',required:baselineFields},
      versions:user.role==='admin'?query('SELECT * FROM workflow_versions WHERE org=? AND department=? ORDER BY id DESC',user.org,user.department):[]
    };
  }
  if(post&&path==='/api/workflows/compile'){
    role(user,'admin');
    const input=await body(req);
    const title=clean(input.title,120),source=clean(input.source,30000);
    const compiled=compileWorkflow(source);
    requireThat(title&&compiled,400,'Supply a title and a Required fields line with all baseline fields.');
    return transaction(()=>{
      const id=Number(run('INSERT INTO workflow_versions(org,department,title,source,source_hash,required,status,created) VALUES(?,?,?,?,?,?,?,?)',
        user.org,user.department,title,source,digest(source),JSON.stringify(compiled.required),'pending_verification',now()).lastInsertRowid);
      audit(user,String(id),'workflow_compiled',{sourceLine:compiled.sourceLine});
      return {id,...compiled};
    });
  }
  const verify=path.match(/^\/api\/workflows\/(\d+)\/verify$/);
  if(post&&verify){
    role(user,'admin');
    const input=await body(req);
    requireThat(input.confirmed===true,400,'Confirm review of the source and extracted fields.');
    return transaction(()=>{
      const pending=one('SELECT id FROM workflow_versions WHERE id=? AND org=? AND department=? AND status=?',Number(verify[1]),user.org,user.department,'pending_verification');
      requireThat(pending,404,'Proposed workflow not found.');
      run('UPDATE workflow_versions SET status=? WHERE org=? AND department=? AND status=?','superseded',user.org,user.department,'published');
      run('UPDATE workflow_versions SET status=? WHERE id=?','published',pending.id);
      audit(user,String(pending.id),'workflow_published');
      return {id:pending.id};
    });
  }
  if(path==='/api/employees'){
    role(user,'admin');
    if(post){
      const input=await body(req);
      requireThat(['officer','supervisor','auditor'].includes(input.role),400,'Select an employee role.');
      return transaction(()=>{
        const id=addUser(user.org,user.department,clean(input.email,254).toLowerCase(),clean(input.password,256),input.role);
        audit(user,id,'employee_created',{role:input.role});return {id};
      });
    }
    return query('SELECT id,email,role FROM users WHERE org=? AND department=?',user.org,user.department);
  }
  if(req.method==='GET'&&path==='/api/inspections'){
    const scoped='SELECT '+projection+' FROM inspections WHERE org=? AND department=?';
    const rows=user.role==='officer'?query(scoped+' AND officer=? ORDER BY updated DESC',user.org,user.department,user.id):query(scoped+' ORDER BY updated DESC',user.org,user.department);
    return rows.map(row=>({...row,content:JSON.parse(row.content)}));
  }
  if(req.method==='GET'&&path==='/api/events'){
    const scoped='SELECT * FROM events WHERE org=? AND department=?';
    return user.role==='officer'?query(scoped+' AND (actor=? OR inspection IN (SELECT id FROM inspections WHERE org=? AND officer=?)) ORDER BY seq DESC LIMIT 200',user.org,user.department,user.email,user.org,user.id):query(scoped+' ORDER BY seq DESC LIMIT 200',user.org,user.department);
  }
  if(req.method==='GET'&&path==='/api/devices'){
    const sql='SELECT id,last_seen FROM devices WHERE org=? AND department=?';
    return user.role==='officer'?query(sql+' AND user=?',user.org,user.department,user.id):query(sql,user.org,user.department);
  }
  if(post&&path==='/api/process'){
    role(user,'officer');
    const input=await body(req);
    const result=processObservation({...input,observations:clean(input.observations,5000)});
    audit(user,'','processed',result.execution);
    return result;
  }
  if(post&&path==='/api/inspections'){
    role(user,'officer');
    const input=await body(req);
    const id=clean(input.id,36);
    requireThat(/^[a-f0-9-]{36}$/.test(id),400,'A stable inspection ID is required.');
    const device=clean(input.device,80);
    const content={
      date:clean(input.date,10), location:clean(input.location,300), category:clean(input.category,60),
      observations:clean(input.observations,5000), transcript:clean(input.transcript,5000),
      workflow:'sanitation-v1'
    };
    const photo=Buffer.from(clean(input.photo,4_000_000),'base64');
    requireThat(photo.length>=4&&photo[0]===255&&photo[1]===216&&photo.at(-2)===255&&photo.at(-1)===217,400,'Attach JPEG evidence under 3 MB.');
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(content.date)&&Number.isFinite(Date.parse(content.date))&&new Date(content.date).toISOString().slice(0,10)===content.date&&content.location&&categories.includes(content.category)&&content.observations&&input.confirmed===true,400,'Complete and confirm all inspection facts.');
    content.evidenceHash=createHash('sha256').update(photo).digest('hex');
    
    return transaction(()=>{
      const existing=one('SELECT officer,version,status,content FROM inspections WHERE org=? AND id=?',user.org,id);
      const previous=existing&&report(user,id);
      const active=previous
        ? one('SELECT id,required FROM workflow_versions WHERE id=? AND org=? AND department=?',Number(previous.content.workflowVersion??0),user.org,user.department)
        : published(user);
      content.workflowVersion=active?.id??0;
      if(active&&JSON.parse(active.required).includes('transcript')) requireThat(content.transcript,400,'The published workflow requires the original transcript.');
      const serialized=JSON.stringify(content);
      if(existing){
        const current=report(user,id);
        if(existing.content===serialized&&existing.version===Number(input.version??0)+1) return current;
        requireThat(existing.status==='changes_requested'&&existing.version===input.version,409,'Inspection changed. Refresh the report before resubmitting.');
        run('UPDATE inspections SET status=?,version=version+1,content=?,evidence=?,updated=? WHERE org=? AND id=?','submitted',serialized,photo,now(),user.org,id);
      }else{
        requireThat(!input.version,409,'Report version does not exist.');
        run('INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?,?)',id,user.org,user.department,user.id,'submitted',1,serialized,photo,now());
      }
      if(device)run('INSERT INTO devices VALUES(?,?,?,?,?) ON CONFLICT(id,user) DO UPDATE SET last_seen=excluded.last_seen',device,user.id,user.org,user.department,now());
      audit(user,id,'submitted',{evidenceHash:content.evidenceHash});
      return report(user,id);
    });
  }
  const match=path.match(/^\/api\/inspections\/([a-f0-9-]{36})(?:\/(evidence|decision))?$/);
  if(match){
    const [,id,action]=match;
    if(req.method==='GET'){
      const current=report(user,id);
      if(action==='evidence'){
        const {evidence}=one('SELECT evidence FROM inspections WHERE org=? AND id=?',user.org,id);
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store'});res.end(evidence);return;
      }
      if(!action){
        const history=query('SELECT action,actor,details,timestamp FROM events WHERE org=? AND department=? AND inspection=? ORDER BY seq DESC',user.org,user.department,id);
        return {...current,history};
      }
    }
    if(post&&action==='decision'){
      role(user,'supervisor');
      const input=await body(req);
      const comments=clean(input.comments,2000);
      requireThat(['approved','changes_requested','rejected'].includes(input.decision)&&(input.decision==='approved'||comments),400,'Provide a decision and comments for corrections or rejection.');
      return transaction(()=>{
        const current=report(user,id);
        requireThat(current.status==='submitted'&&current.version===input.version,409,'This submission has already changed.');
        run('UPDATE inspections SET status=?,updated=? WHERE org=? AND id=?',input.decision,now(),user.org,id);
        audit(user,id,input.decision,{comments,version:current.version});return report(user,id);
      });
    }
  }
  fail(404,'Endpoint not found.');
}

const staticFiles = new Map([['/',['index.html','text/html']],['/centre.js',['centre.js','text/javascript']],['/centre.css',['centre.css','text/css']]]);
for(const asset of ['hi.wav','te.wav','samples.json','benchmark.json']){
  staticFiles.set('/voice/'+asset,['voice/'+asset,asset.endsWith('.wav')?'audio/wav':'application/json']);
}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/')){
      res.setHeader('Cache-Control','no-store');
      const result=await api(req,res,path);
      if(res.writableEnded)return;
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
    }
    const file=staticFiles.get(path);
    requireThat(file&&req.method==='GET',404,'Page not found.');
    res.writeHead(200,{'Content-Type':file[1]+(file[1].startsWith('text/')?'; charset=utf-8':'')});
    res.end(readFileSync(new URL('../../apps/web/'+file[0],import.meta.url)));
  }catch(error){
    if(!error.status)console.error(error);
    if(res.headersSent){res.end();return;}
    res.writeHead(error.status??500,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:error.status?error.message:'Unexpected server error.'}));
  }
});
server.listen(Number(process.env.PORT??8787),process.env.HOST??'127.0.0.1',
  ()=>console.log('FieldOS listening on port '+server.address().port));



