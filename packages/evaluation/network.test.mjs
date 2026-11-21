import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkSpec,executeNetwork,starterNetwork} from '../../services/api/agent-network.mjs';

test('invalid dependencies, context fields and cycles fail before inference',()=>{
 for(const change of [
  g=>g.agents[0].after.push('missing_agent'),g=>g.agents[0].after.push('briefing'),
  g=>g.agents[0].inputs.push('secret'),g=>g.agents[0].id='constructor',
  g=>g.agents[2].after.pop(),g=>g.agents[0].id=g.agents[1].id
 ]){
  const graph=structuredClone(starterNetwork);change(graph);
  assert.throws(()=>networkSpec(graph),e=>e.status===400);
 }
});
test('parallel branches receive declared fields and fan in exactly once',async()=>{
 const seen=new Map();
 const result=await executeNetwork(starterNetwork,{evidence:'test evidence',procedure:'procedure'},async(role,instructions,packet)=>{
  assert(!seen.has(role));seen.set(role,packet);
  return {role,status:'Completed',output:role,ms:1};
 });
 assert.equal(seen.get('Procedure reviewer').evidence,undefined);
 assert.equal(seen.get('Evidence analyst').evidence,'test evidence');
 assert.deepEqual(seen.get('Briefing editor').handoffs.map(h=>h.draft),['Evidence analyst','Procedure reviewer']);
 assert.equal(result.at(-1).id,'briefing');
});
test('unavailable parent prevents its dependent from invoking the model',async()=>{
 const roles=[];
 const result=await executeNetwork(starterNetwork,{},async role=>{
  roles.push(role);return {role,status:role==='Evidence analyst'?'Unavailable':'Completed',output:'',ms:0};
 });
 assert.equal(result.at(-1).status,'Skipped');
 assert(!roles.includes('Briefing editor'));
});
