// Snapshot of rural household tap connections from the JJM state table.
export const source='https://www.ejalshakti.gov.in/JJMReport/JJMIndia.aspx';
const records=[
 {state:'Andhra Pradesh',connected:7319255,households:9553387},
 {state:'Telangana',connected:5398219,households:5398219}
];
export function waterContext(state){
 const record=records.find(r=>r.state===state);
 if(!record)return null;
 return {...record,asOf:'2026-11-20',indicator:'Rural households with tap water supply',source};
}
