import snapshot from './gov-districts.json' with {type:'json'};
import cards from './aikosh-cards.json' with {type:'json'};

export function indiaAiCatalog() {
  return structuredClone(cards);
}

const asOf = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(snapshot.retrievedAt));
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
const states = new Map(snapshot.states.map(({state,source}) => [state,source]));
const aliases = new Map([['ap','Andhra Pradesh'],['tg','Telangana'],['ts','Telangana']]);
for (const state of states.keys()) aliases.set(normalize(state),state);

function describe(row) {
  const base = 'https://igod.gov.in/district/' + row.id;
  return {
    name:row.name,state:row.state,districtId:row.id,source:states.get(row.state),
    subdistrictUrl:base+'/sub_districts',blocksUrl:base+'/blocks',
    subdistrictCount:row.subdistricts.length,asOf
  };
}

export function districtCatalog() {
  return {
    id:'igod-districts',title:'District and subdistrict directory',asOf,
    retrievedAt:snapshot.retrievedAt,count:snapshot.districts.length,
    subdistrictCount:snapshot.districts.reduce((n,row)=>n+row.subdistricts.length,0),
    source:'https://igod.gov.in/',
    states:snapshot.states.map(row=>({...row,count:snapshot.districts.filter(d=>d.state===row.state).length}))
  };
}

export function searchDistricts({state='',query='',exact=false,limit=61}={}) {
  const selected = aliases.get(normalize(state));
  const term = normalize(query);
  if ((state && !selected) || (query && !term)) return [];
  const boundedLimit = Number.isInteger(Number(limit)) ? Math.max(0,Math.min(100,Number(limit))) : 61;
  return snapshot.districts.filter(row=>{
    const name = normalize(row.name);
    return (!selected || row.state===selected) && (!term || (exact ? name===term : name.includes(term)));
  }).slice(0,boundedLimit).map(describe);
}

export function districtDetails(id) {
  const row = snapshot.districts.find(row=>row.id===String(id));
  return row ? {...describe(row),subdistricts:[...row.subdistricts]} : null;
}
