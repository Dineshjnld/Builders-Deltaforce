import { randomUUID } from 'node:crypto';
import { rename, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../services/api/gov-districts.json', import.meta.url));
const states = [
  ['Andhra Pradesh', 'https://igod.gov.in/sg/AP/E042/organizations'],
  ['Telangana', 'https://igod.gov.in/sg/TS/E042/organizations'],
];
const districts = [];

async function readDirectory(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(20000), redirect: 'error'});
  if (!response.ok) throw Error(`iGOD returned ${response.status} for ${url}`);
  const html = await response.text();
  const expected = Number(html.match(/(\d+)\s+Results?\b/i)?.[1]);
  const parse = fragment => fragment.split(/<div class="search-row(?: module)?">/).slice(1).map(row => {
    const match = row.match(/<div class="search-title">\s*([^<]+?)\s*<\/div>/);
    if (!match) throw Error('Unrecognized iGOD row at ' + url);
    return {name:match[1].replaceAll('&amp;', '&').trim(), links:row};
  });
  const rows = parse(html);
  while (rows.length < expected) {
    const limit = Math.min(5, expected - rows.length);
    const more = await fetch(url + '_more/' + rows.length + '/' + limit, {signal:AbortSignal.timeout(20000),redirect:'error'});
    if (!more.ok) throw Error('Could not load directory page for ' + url);
    const page = parse(await more.text());
    if (page.length !== limit) throw Error('Incomplete directory page at ' + url);
    rows.push(...page);
  }
  if (!rows.length || expected !== rows.length) {
    throw Error(`Incomplete directory at ${url}: expected ${expected}, parsed ${rows.length}`);
  }
  return rows;
}

for (const [state, url] of states) {
  for (const {name, links} of await readDirectory(url)) {
    const id = links.match(/href="https:\/\/igod\.gov\.in\/district\/(\d+)\/sub_districts"/)?.[1];
    if (!id || districts.some(row => row.id === id)) throw Error(`Invalid directory ID at ${name}`);
    const subdistrictUrl = `https://igod.gov.in/district/${id}/sub_districts`;
    const entries = await readDirectory(subdistrictUrl);
    districts.push({id, name, state, subdistricts:entries.map(row => row.name)});
  }
}
const snapshot = {retrievedAt:new Date().toISOString(), states:states.map(([state,source])=>({state,source})), districts};
const temporary = out + '.' + randomUUID() + '.tmp';
try {
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', {flag:'wx'});
  await rename(temporary, out);
} finally {
  await rm(temporary,{force:true});
}
console.log(districts.length+' districts and '+districts.reduce((n,row)=>n+row.subdistricts.length,0)+' subdistrict entries imported');
