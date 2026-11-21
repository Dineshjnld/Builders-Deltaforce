import {networkSpec} from './agent-network.mjs';

export function demand(ok,message,status=400){if(!ok)throw Object.assign(new Error(message),{status});}

// Restricted data-only HOCON. Tokens are consumed without filesystem or process access.
function readHocon(source){
 demand(typeof source==='string'&&source.length>0&&source.length<=24000,'Source must be between 1 and 24,000 characters.');
 const tokens=[];
 const pattern=/\s+|#[^\n]*|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|[{}\[\]=:,]|[A-Za-z_][A-Za-z0-9_-]*/gy;
 let offset=0;
 while(offset<source.length){
  pattern.lastIndex=offset;const match=pattern.exec(source);
  demand(match,'Unsupported HOCON syntax at character '+(offset+1)+'.');
  const word=match[0];offset=pattern.lastIndex;
  if(!/^\s|^#|^\/\//.test(word))tokens.push(word);
 }
 let pos=0;
 function string(token){
  demand(typeof token==='string','Expected a string.');
  if(token.startsWith('"""'))return token.slice(3,-3);
  if(token.startsWith('"')){try{return JSON.parse(token);}catch{demand(false,'Invalid quoted string.');}}
  demand(/^[A-Za-z_][\w-]*$/.test(token),'Expected a quoted string or identifier.');
  return token;
 }
 function value(depth){
  demand(depth<12,'HOCON nesting exceeds the limit.');
  const t=tokens[pos++];
  if(t==='{')return object('}',depth+1);
  if(t==='['){
   const values=[];while(tokens[pos]!==']'){values.push(value(depth+1));if(tokens[pos]===',')pos++;}
   pos++;return values;
  }
  return string(t);
 }
 function object(end,depth){
  const result=Object.create(null);
  while(tokens[pos]!==end){
   const key=string(tokens[pos++]);demand(!Object.hasOwn(result,key),'Duplicate key '+key+'.');
   if(tokens[pos]!=='{'){demand(['=',':'].includes(tokens[pos++]),'Expected = after '+key+'.');}
   result[key]=value(depth+1);if(tokens[pos]===',')pos++;
  }
  if(end)pos++;return result;
 }
 const root=tokens[0]==='{'?value(0):object(undefined,0);
 demand(pos===tokens.length,'Unexpected trailing content.');return root;
}
function keys(obj,allowed){
 demand(obj&&typeof obj==='object'&&!Array.isArray(obj),'Expected a HOCON object.');
 for(const key of Object.keys(obj))demand(allowed.includes(key),'Unsupported field '+key+'.');
}
export function compileHocon(source){
 const root=readHocon(source);keys(root,['metadata','tools']);keys(root.metadata,['title','description']);
 const {title,description}=root.metadata;
 demand(typeof title==='string'&&title.trim()&&title.length<=100,'Supply a network title of up to 100 characters.');
 demand(typeof description==='string'&&description.trim()&&description.length<=1200,'Supply a network objective.');
 demand(Array.isArray(root.tools)&&root.tools.length,'Define at least one agent in tools.');
 const agents=root.tools.map(t=>{
  keys(t,['name','function','instructions','tools']);keys(t.function,['description']);
  demand(Array.isArray(t.tools),'Each agent needs a tools list.');
  return {id:t.name,role:t.function.description,instructions:t.instructions,after:t.tools,inputs:['evidence','procedure']};
 });
 const network=networkSpec({version:1,agents});
 demand(network.agents.at(-1).id===agents[0].id,'The first tool must be the final coordinating agent.');
 return {title:title.trim(),description:description.trim(),network};
}

export function emitHocon(title,description,agents){
 const q=JSON.stringify;
 return ['# Agent network · coordinator first','metadata {','  title = '+q(title),'  description = '+q(description),'}','tools = [',
 ...agents.map(a=>['  {','    name = '+q(a.id),'    function { description = '+q(a.role)+' }','    instructions = '+q(a.instructions),'    tools = '+q(a.after),'  }'].join('\n')),']',''].join('\n');
}
