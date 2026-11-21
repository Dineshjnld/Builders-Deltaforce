import {BedrockRuntimeClient,ConverseCommand} from '@aws-sdk/client-bedrock-runtime';

export const usingBedrock=()=>process.env.STUDIO_INFERENCE_PROVIDER==='bedrock';
export const modelEnabled=()=>usingBedrock()||Boolean(process.env.STUDIO_MODEL_URL);
let runtime;

export function converseRequest(profile,{system,user,maxTokens,temperature,schema}){
 if(!/^arn:aws:bedrock:us-west-2:\d{12}:application-inference-profile\/[a-zA-Z0-9-]+$/.test(profile||''))
  throw Error('A project application inference profile in us-west-2 is required.');
 const input={modelId:profile,system:[{text:system}],messages:[{role:'user',content:[{text:user}]}],
  inferenceConfig:{maxTokens,temperature}};
 if(schema)input.toolConfig={tools:[{toolSpec:{name:'design',description:'Return the requested design as structured data.',inputSchema:{json:schema}}}],toolChoice:{tool:{name:'design'}}};
 return input;
}
export async function complete({system,user,maxTokens,temperature,schema,timeout}){
 const signal=AbortSignal.timeout(timeout);
 if(usingBedrock()){
  const input=converseRequest(process.env.STUDIO_BEDROCK_PROFILE_ARN,{system,user,maxTokens,temperature,schema});
  runtime??=new BedrockRuntimeClient({region:'us-west-2',maxAttempts:1});
  const result=await runtime.send(new ConverseCommand(input),{abortSignal:signal});
  const blocks=result.output?.message?.content||[];
  if(schema){const tool=blocks.find(b=>b.toolUse?.name==='design');if(!tool)throw Error('Missing structured result.');return JSON.stringify(tool.toolUse.input);}
  return blocks.map(b=>b.text||'').join('').trim();
 }
 const response=await fetch(process.env.STUDIO_MODEL_URL+'/v1/chat/completions',{
  method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({
   model:'local',temperature,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}],
   ...(schema?{seed:42,response_format:{type:'json_schema',json_schema:{name:'design',schema}}}:{})
  })});
 if(!response.ok)throw Error('Inference unavailable.');
 return (await response.json()).choices?.[0]?.message?.content?.trim();
}
