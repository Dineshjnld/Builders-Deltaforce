// Local MCP stdio transport. Only the published aggregate dataset is accessible.
import {createInterface} from 'node:readline';
import {waterContext} from '../services/api/public-context.mjs';
import {searchDistricts,indiaAiCatalog} from '../services/api/gov-data.mjs';
const name='water_context';
const states=['Andhra Pradesh','Telangana'];
const descriptor={name,description:'Read a dated state-level Jal Jeevan Mission household tap coverage snapshot.',inputSchema:{type:'object',properties:{state:{type:'string',enum:states}},required:['state'],additionalProperties:false}};
for await(const line of createInterface({input:process.stdin})){
 let id=null;
 try{
  const msg=JSON.parse(line);id=msg.id;
  if(id===undefined)continue;
  let result;
  switch(msg.method){
   case 'initialize':result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'agent-studio-context',version:'1.1.0'}};break;
   case 'ping':result={};break;
   case 'tools/list':result={tools:[descriptor,{name:'district_search',description:'Search the iGOD district directory',inputSchema:{type:'object',properties:{state:{type:'string',enum:states},query:{type:'string'}},required:['state']}},{name:'indiaai_catalog',description:'Read public AIKosh dataset cards',inputSchema:{type:'object',properties:{}}}]};break;
   case 'tools/call':{
    const tool=msg.params?.name;
    const record=tool==='district_search'?searchDistricts(msg.params.arguments||{}):tool==='indiaai_catalog'?indiaAiCatalog():tool===name&&waterContext(msg.params.arguments?.state);
    result={content:[{type:'text',text:record?JSON.stringify(record):'Unknown tool or state.'}],isError:!record};break;
   }
   default:throw Object.assign(Error('Unknown method'),{code:-32601});
  }
  console.log(JSON.stringify({jsonrpc:'2.0',id,result}));
 }catch(e){console.log(JSON.stringify({jsonrpc:'2.0',id:id??null,error:{code:e.code??-32700,message:e.message}}));}
}
