import assert from 'node:assert/strict';
import {test} from 'node:test';
import {converseRequest} from '../../services/api/inference.mjs';
test('Bedrock uses a regional application profile and bounded structured inference',()=>{
 const arn='arn:aws:bedrock:us-west-2:123456789012:application-inference-profile/example';
 const args={system:'Design',user:'Synthetic example',maxTokens:220,temperature:0.15,schema:{type:'object'}};
 const request=converseRequest(arn,args);
 assert.equal(request.modelId,arn);assert.equal(request.inferenceConfig.maxTokens,220);
 assert.equal(request.toolConfig.toolChoice.tool.name,'design');
 assert.throws(()=>converseRequest('amazon.nova-lite-v1:0',args));
 assert.throws(()=>converseRequest(arn.replace('us-west-2','us-east-1'),args));
});
