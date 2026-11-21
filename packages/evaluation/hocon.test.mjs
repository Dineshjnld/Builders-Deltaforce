import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {compileHocon,emitHocon} from '../../services/api/command-hocon.mjs';
const file=readFileSync(new URL('../../data/networks/proposal-review.hocon',import.meta.url),'utf8');
test('HOCON dependencies compile and round-trip through editable source',()=>{
 const compiled=compileHocon(file),agents=compiled.network.agents;
 assert.deepEqual(agents.at(-1).after,['cost','delivery']);
 const encoded=emitHocon(compiled.title,compiled.description,[agents.at(-1),...agents.slice(0,-1)]);
 assert.deepEqual(compileHocon(encoded),compiled);
});
test('unresolved tools, includes, duplicate keys and invalid syntax fail validation',()=>{
 for(const s of [file.replace('"cost", "delivery"','"absent"'),file+'\ninclude "external.conf"',file+'\ntools=[]',file.slice(0,-4),file.replace('name = "cost"','class = "custom"')])assert.throws(()=>compileHocon(s),e=>e.status===400);
});
