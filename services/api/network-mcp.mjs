import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const token=process.env.STUDIO_NETWORK_KEY;
const port=Number(process.env.STUDIO_LOCAL_PORT||8787);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid Studio loopback port.');
if(!/^dgn_[a-f0-9]{64}$/.test(token??''))throw Error('Set STUDIO_NETWORK_KEY to a department network credential.');
const server=new Server({name:'deltaforce-agent-networks',version:'1.0.0'},{capabilities:{tools:{}}});
const list={name:'list_networks',description:'List published department networks and their required fields.',inputSchema:{type:'object',properties:{},additionalProperties:false}};
const invoke={name:'invoke_network',description:'Submit evidence for a published agent network and human review. Reuse requestId when retrying the same submission.',inputSchema:{type:'object',additionalProperties:false,properties:{
 policy:{type:'integer',minimum:1},requestId:{type:'string',maxLength:100},evidence:{type:'string',maxLength:8000},state:{type:'string'},district:{type:'string'}
},required:['policy','requestId','evidence']}};
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[list,invoke]}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
 try{
  if(![list.name,invoke.name].includes(params.name))throw Error('Unknown tool.');
  const run=params.name===invoke.name;
  const response=await fetch('http://127.0.0.1:'+port+'/api/studio/'+(run?'invoke':'networks'),{
   method:run?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(105000),
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:run?JSON.stringify(params.arguments):undefined
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Network request failed.');
  return {content:[{type:'text',text:JSON.stringify(result)}]};
 }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
});
await server.connect(new StdioServerTransport());
