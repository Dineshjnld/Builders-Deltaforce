import {MCPServerStdio} from '@openai/agents';
import {fileURLToPath} from 'node:url';

// Set STUDIO_NETWORK_KEY in the local process environment. No hosted model is required.
const key=process.env.STUDIO_NETWORK_KEY;
if(!key)throw Error('Set a department network credential first.');
const server=new MCPServerStdio({
 name:'Department Agent Studio',command:process.execPath,
 args:[fileURLToPath(new URL('../../services/api/network-mcp.mjs',import.meta.url))],
 env:{STUDIO_NETWORK_KEY:key,STUDIO_LOCAL_PORT:process.env.STUDIO_LOCAL_PORT||'8787'},timeout:110000
});
try{
 await server.connect();
 const invoke=process.argv[2]==='invoke';
 let input='';
 if(invoke)for await(const chunk of process.stdin){
  input+=chunk;if(input.length>12000)throw Error('Input exceeds 12 KB.');
 }
 const result=await server.callToolResult(invoke?'invoke_network':'list_networks',invoke?JSON.parse(input):{});
 if(result.isError)throw Error(result.content[0]?.text||'Studio invocation failed.');
 console.log(result.content[0].text);
}finally{await server.close();}
