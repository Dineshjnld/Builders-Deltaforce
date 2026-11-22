"""Run the keyless public-service journey on the locally running judge stack."""
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode, unquote
from urllib.request import Request, urlopen
from uuid import uuid4

ui = 'http://127.0.0.1:45220'
city = 'http://127.0.0.1:45222'
customer = 'http://127.0.0.1:45221'

def request(url, data=None, headers=None):
    raw = json.dumps(data).encode() if data is not None else None
    return urlopen(Request(url, data=raw, headers={'Content-Type':'application/json', **(headers or {})}), timeout=180)

def call(url, data=None, headers=None):
    with request(url, data, headers) as response:
        return json.load(response)

context = None
for message in ('hi','Goal: Guide Telangana residents to income certificate services; Audience: Residents; Inputs: Official state service directory; Outcome: Return the official service link and route exceptions to an officer','build it'):
    payload = {'user_message':{'type':'HUMAN','text':message}, 'chat_filter':{'chat_filter_type':'MAXIMAL'}}
    if context:
        payload['chat_context'] = context
    answer = ''
    with request(ui+'/api/v1/agent_network_designer/streaming_chat',payload) as response:
        for line in response:
            if not line.strip(): continue
            frame = json.loads(line).get('response', {})
            context = frame.get('chat_context') or context
            if frame.get('type')=='AGENT_FRAMEWORK':
                answer = frame.get('text') or answer
    print(message[:16], answer[:160], flush=True)
    if message!='build it': assert '/playground?network=' not in answer
match = re.search(r'/playground\?network=(deltaforce(?:%2F|/)[a-z0-9_]+)', answer, re.I)
assert match, 'Graph registration failed: '+answer
network = unquote(match.group(1))
with tempfile.TemporaryDirectory() as tmp:
    spec = Path(tmp)/'network.hocon'
    spec.write_bytes(request(ui+'/api/studio?'+urlencode({'id':network,'format':'hocon'})).read())
    result = subprocess.check_output(['curl','-fsS','-H','Origin: '+city,'-F','file=@'+str(spec),'-F','org_name=Builders local check','-F','name=Telangana services '+uuid4().hex[:8],city+'/deployments'])
deployment = json.loads(result)
api = customer+'/api/customer/'+deployment['id']
auth = {'Authorization':'Bearer '+call(api+'/sessions',{})['token']}
turn = str(uuid4())
assert call(api+'/turns',{'id':turn,'message':'Where is the official Telangana income certificate directory?','review':True},auth)['state']=='pending'
call(ui+'/api/reviews',{'id':turn,'action':'approve'},{'x-delta-review':'1'})
row = call(api+'/turns', headers=auth)[-1]
assert row['state']=='answered' and 'telangana.gov.in' in row['answer'].lower(), row
assert call(api+'/turns', headers=auth)[-1]['answer']==row['answer']
print('PASS: fresh graph, publication, review, official source and persistent answer.',deployment['url'])
