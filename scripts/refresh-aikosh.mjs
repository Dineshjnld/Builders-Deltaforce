import { writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Refresh only public card metadata. The operational model never sends case evidence here.
const cards=[
  ['indicvoices_r','Speech synthesis'],
  ['indicsynth','Speech evaluation'],
  ['multilingual_table_detection','Document evaluation']
];
const entries=[];
for(const [id,use] of cards){
  const source='https://aikosh.indiaai.gov.in/home/datasets/details/'+id+'.html';
  const response=await fetch(source,{signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error('AIKosh returned '+response.status+' for '+id);
  const html=await response.text();
  const title=html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const license=html.match(/class="pill-label"[^>]*>\s*LICENSE\s*<\/span>\s*<span[^>]*>\s*([^<]+)/i)?.[1]?.trim();
  if(!title||!license)throw Error('Missing public title or license for '+id);
  entries.push({id,title,license,source,use});
}
const path=fileURLToPath(new URL('../services/api/aikosh-cards.json',import.meta.url));
const tmp=path+'.'+randomUUID()+'.tmp';
try{
  await writeFile(tmp,JSON.stringify({publisher:'IndiaAI AIKosh',retrievedAt:new Date().toISOString(),entries},null,2)+'\n',{flag:'wx'});
  await rename(tmp,path);
}finally{await rm(tmp,{force:true});}
console.log(entries.map(e=>e.title+' | '+e.license).join('\n'));
