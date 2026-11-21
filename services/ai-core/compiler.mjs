export const baselineFields = ['date','location','category','observations','photo'];
export function compileWorkflow(source){
  const lines=source.split(/\r?\n/);
  const declaration=lines.findIndex(line=>/^required fields\s*:/i.test(line));
  if(declaration<0)return null;
  const raw=lines[declaration].slice(lines[declaration].indexOf(':')+1).split(',').map(field=>field.trim().toLowerCase());
  const names={inspection_date:'date',issue_category:'category',evidence:'photo',date:'date',location:'location',category:'category',photo:'photo',observations:'observations',transcript:'transcript'};
  if(raw.some(field=>!Object.hasOwn(names,field)))return null;
  const required=[...new Set(raw.map(field=>names[field]))];
  if(baselineFields.some(field=>!required.includes(field)))return null;
  return {required,sourceLine:declaration+1};
}