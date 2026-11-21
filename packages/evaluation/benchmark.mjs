import {readFileSync} from 'node:fs';
import {processObservation} from '../../services/ai-core/inspection.mjs';
const cases=JSON.parse(readFileSync(new URL('../../data/synthetic-inspections/observations.json',import.meta.url)));
const runs=Array.from({length:100},()=>cases.map(([observations])=>processObservation({observations}))).flat();
const ordered=runs.map(run=>run.execution.milliseconds).sort((a,b)=>a-b);
console.log(JSON.stringify({runtime:process.version,platform:process.platform,arch:process.arch,cases:cases.length,runs:runs.length,accuracy:cases.filter(([observations,expected])=>processObservation({observations}).category===expected).length/cases.length,p50_ms:ordered[Math.floor(ordered.length*.5)],p95_ms:ordered[Math.floor(ordered.length*.95)],rss_bytes:process.memoryUsage().rss},null,2));