// Run against a local demo workspace with the synthetic seeded accounts.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787/api/';
async function call(path,token,input,status=200){
 const response=await fetch(base+path,{method:input?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:input?JSON.stringify(input):undefined});
 const result=await response.json();
 assert.equal(response.status,status,JSON.stringify(result.error));
 return result;
}
const login=async role=>(await call('login',null,{email:role+'@studio.example',password:'AgentStudio-demo-2026'})).token;
const [admin,officer,supervisor]=await Promise.all(['admin','officer','supervisor'].map(login));
try {
 const draft={approver:'supervisor@studio.example',title:'Department briefing',agent:'Briefing analyst',fields:'subject',sop:'Verify the supplied subject and prepare a briefing for the designated supervisor.',source:'https://igod.gov.in/'};
 if(process.argv.includes('--network')){
  const catalog=await call('studio',admin);
  Object.assign(draft,{title:'District briefing network',strategy:'Agent network',network:catalog.starterNetwork});
  const invalid=structuredClone(draft);invalid.network.agents[0].after=['briefing'];await call('studio/publish',admin,invalid,400);
 }
 const evaluation=await call('studio/evaluate',admin,draft);assert(evaluation.tests.every(t=>t.pass));
 await call('studio/publish',officer,draft,403);
 const {id:policy}=await call('studio/publish',admin,draft);
 const run=await call('studio/run',officer,{policy,state:'Andhra Pradesh',district:'Polavaram',evidence:'subject = Training venue\nPrepare a synthetic district workshop briefing.'});
 if(draft.network){
  assert.equal(run.runtime,'LangGraph.js');assert.equal(run.networkState,'Completed');assert.equal(run.specialists.length,3);
  assert.equal(run.summary,run.specialists.at(-1).output);assert(run.summary);
 }
 assert.equal(run.missing.length,0);
 assert.equal(run.district.state,'Andhra Pradesh');
 await call('studio/decision',officer,{id:run.id,state:'Approved'},403);
 await call('studio/decision',supervisor,{id:run.id,state:'Approved'});
 await call('studio/decision',supervisor,{id:run.id,state:'Returned'},409);
 const dashboard=await call('studio',supervisor);assert(dashboard.runs.some(r=>r.id===run.id&&r.state==='Approved'));
 console.log(JSON.stringify({policy,run:run.id,checks:evaluation.tests,engine:run.engine,draftProduced:!!run.summary,specialists:run.specialists?.map(({role,status,ms})=>({role,status,ms})),elapsedMs:run.ms,state:'Approved',officerDenials:2,duplicateDecision:409},null,2));
} finally {await Promise.all([admin,officer,supervisor].map(t=>call('logout',t,{})));}