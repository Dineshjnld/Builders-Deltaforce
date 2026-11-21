import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {starterNetwork} from '../services/api/agent-network.mjs';
import {spawn} from 'node:child_process';

const sdk=createRequire(new URL('../services/api/package.json',import.meta.url));
const {Client}=sdk('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=sdk('@modelcontextprotocol/sdk/client/stdio.js');
const base='http://127.0.0.1:8787/api/';
async function api(path,token,body,status=200){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert.equal(response.status,status,value.error);return value;
}
assert((await api('config')).demo,'This verification requires local demo mode.');
const email='network-'+crypto.randomUUID()+'@studio.example',password=crypto.randomUUID();
await api('organizations',null,{email,password,name:'Synthetic network verification',department:'Operations'});
const {token}=await api('login',null,{email,password});
const {token:key}=await api('connectors',token,{scope:'networks',action:'rotate'});
const client=new Client({name:'network-verification',version:'1.0.0'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../services/api/network-mcp.mjs',import.meta.url))],env:{STUDIO_NETWORK_KEY:key}}));
 assert.equal((await client.listTools()).tools.length,2);
 const invoke=async(name,args={})=>client.callTool({name,arguments:args},undefined,{timeout:110000});
 assert.deepEqual(JSON.parse((await invoke('list_networks')).content[0].text),[]);
 const {id:policy}=await api('studio/publish',token,{strategy:'Agent network',agent:'Analyst',title:'Demo network',sop:'Verify the subject and present the record for approval.',fields:'subject',network:starterNetwork});
 const listed=JSON.parse((await invoke('list_networks')).content[0].text);
 assert.deepEqual(listed.map(row=>row.id),[policy]);
 const args={policy,requestId:'sample-001',evidence:'subject = Synthetic workshop'};
 if(process.argv.includes('--agents-sdk')){
  const child=spawn(process.execPath,[fileURLToPath(new URL('../examples/agents-sdk/client.mjs',import.meta.url)),'invoke'],{env:{...process.env,STUDIO_NETWORK_KEY:key},stdio:['pipe','pipe','inherit'],windowsHide:true});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  child.stdin.end(JSON.stringify(args));
  let output='';for await(const chunk of child.stdout)output+=chunk;
  assert.equal(await done,0);assert.equal(JSON.parse(output).state,'Pending');
  console.log('OpenAI Agents SDK submitted the first run through local MCP.');
 }
 const first=JSON.parse((await invoke('invoke_network',args)).content[0].text);
 assert.equal(first.state,'Pending');
 const repeated=JSON.parse((await invoke('invoke_network',args)).content[0].text);
 assert.deepEqual(first,repeated);
 assert((await invoke('invoke_network',{...args,evidence:'changed'})).isError);
 const studio=await api('studio',token);
 assert.equal(studio.runs.length,1);
 assert.equal(JSON.parse(studio.runs[0].result).networkState,'Completed');
 await api('studio/decision',key,{id:first.id,state:'Approved'},403);
 await api('connectors',token,{scope:'networks',action:'revoke'});
 assert((await invoke('list_networks')).isError);
 console.log('MCP discovery, three-agent execution, department isolation, duplicate receipt, conflict, approval denial and revocation passed.');
}finally{await client.close();await api('connectors',token,{scope:'networks',action:'revoke'});await api('logout',token,{});}
