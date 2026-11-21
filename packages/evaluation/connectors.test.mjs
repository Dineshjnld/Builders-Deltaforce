import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {connectors} from '../../services/api/connectors.mjs';

test('Department intake credential binds scope, deduplicates events and revokes immediately',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of ['001','003'])db.exec(readFileSync(new URL('../../infrastructure/migrations/'+file+'.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO organizations VALUES('office','Office')");
  const actor={org:'office',department:'Operations',role:'admin'};
  const bridge=connectors(db,{role:(u,r)=>assert.equal(u.role,r),body:async req=>req.input,audit:()=>{},transaction:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}});
  const manage=action=>bridge.catalog({method:'POST',input:{action}},actor);
  const {token}=await manage('rotate');
  const event={headers:{authorization:'Bearer '+token},input:{id:'record-1',text:'Synthetic briefing',department:'Other'}};
  const first=await bridge.accept(event);assert(first.stored);
  const duplicate=await bridge.accept(event);assert.deepEqual(duplicate,{id:first.id,stored:false});
  assert.equal(db.prepare('SELECT department FROM cases').get().department,'Operations');
  await assert.rejects(bridge.accept({...event,input:{...event.input,text:'Changed'}}),e=>e.status===409);
  await manage('revoke');await assert.rejects(bridge.accept(event),e=>e.status===401);
 }finally{db.close();}
});

