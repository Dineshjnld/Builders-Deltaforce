import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787/api/';
let token;
async function api(path,data,status=200){
 const res=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
 const value=await res.json();assert.equal(res.status,status,value.error);return value;
}
token=(await api('login',{email:'admin@studio.example',password:'AgentStudio-demo-2026'})).token;
try{
 const initial=await api('command/chat',{prompt:'Create a procurement review network with a cost analyst and a policy reviewer working in parallel. A procurement lead combines their findings.'});
 console.log('Generated',initial.title,initial.graph.agents.map(n=>n.role));
 const revised=await api('command/chat',{id:initial.id,revision:initial.revision,prompt:'Keep the procurement team and add a delivery risk analyst as another parallel specialist.'});console.log('Revised',revised.title,revised.graph.agents.map(n=>n.role));
 assert(revised.graph.agents.some(a=>a.role.toLowerCase()==='delivery risk analyst'));
 await api('command/save',{id:initial.id,revision:1,source:initial.source},409);
 await api('command/save',{id:initial.id,revision:2,source:'include "secret.conf"'},400);
 const saved=await api('command/save',{id:revised.id,revision:2,source:'# Reviewed for synthetic test\n'+revised.source});
 const published=await api('command/publish',{id:saved.id,revision:saved.revision});
 const run=await api('studio/run',{policy:published.release.policy,evidence:'Synthetic proposal: provide 12 laptops to a training team in 30 days for INR 420000. The vendor offers one year of support.'});
 assert.equal(run.sourceDigest,published.release.digest);assert.equal(run.networkState,'Completed');assert(run.summary);
 const fetched=await api('command/'+initial.id);assert(fetched.runs.some(r=>r.id===run.id));
 console.log(JSON.stringify({draft:initial.id,revision:saved.revision,policy:published.release.policy,sourceSha256:run.sourceDigest,agents:run.specialists.length,runMs:run.ms,state:fetched.runs[0].state}));
}finally{await api('logout',{});}
