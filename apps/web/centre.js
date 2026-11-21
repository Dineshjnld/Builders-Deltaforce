'use strict';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let user=null,doc=null,view='topology',selected='',sourceBuffer='',busy=false,afterLogin=null,runText='';
const templates=['Build a procurement network with a cost analyst, a policy reviewer and a briefing editor.','Create a research network that checks sources and prepares an executive summary.'];
async function api(path,input){
 const res=await fetch('/api/'+path,input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed.');return data;
}
function note(text){$('status').textContent=text;}
function dirty(){return sourceBuffer!==(doc?.source||'');}
function discard(){return !dirty()||confirm('Discard unsaved HOCON edits?');}
async function action(fn,progress){
 if(busy)return;busy=true;document.querySelector('.shell').inert=true;note(progress||'');
 try{await fn();}catch(e){note(e.message);}finally{busy=false;document.querySelector('.shell').inert=false;}
}
function button(label,fn,primary=false){const n=el('button',label,primary?'primary':'');n.type='button';n.onclick=()=>action(fn);return n;}
function authorize(fn){if(!user){afterLogin=fn;$('loginError').textContent='';$('login').showModal();return;}return fn();}
async function list(){
 const lib=$('library');lib.replaceChildren();if(!user)return;
 const rows=await api('command');for(const row of rows){const n=button(row.title,async()=>{if(!discard())return;runText='';$('prompt').value='';accept(await api('command/'+row.id));});n.dataset.id=row.id;n.setAttribute('aria-current',String(doc?.id===row.id));lib.append(n);}
}
function accept(d){doc=d;sourceBuffer=d?.source||'';selected=d?.graph.agents.at(-1).id||'';render();for(const n of $('library').children)n.setAttribute('aria-current',String(n.dataset.id===d?.id));}
function render(){
 $('title').textContent=doc?.title||'Network command centre';
 $('revision').textContent=doc?(doc.release?'Published':'Draft')+' · r'+doc.revision:'New draft';
 $('crumb').textContent=(user?.department||'Workspace')+' / Networks';
 $('identity').textContent=user?user.email:'';$('auth').textContent=user?'Sign out':'Sign in';
 $('generate').textContent=doc?'Revise network':'Generate network';$('generate').disabled=!!user&&user.role!=='admin';
 const m=$('messages');m.replaceChildren();
 if(doc?.messages.length){for(const msg of doc.messages){const item=el('div',undefined,'message');item.append(el('b',msg.role==='user'?'You':'Network designer'),el('p',msg.text));m.append(item);}m.scrollTop=m.scrollHeight;}
 else{m.append(el('h2','What should your agents accomplish?','empty-chat'),el('p','Describe the outcome, the specialists and who brings their work together.','muted'));for(const prompt of templates)m.append(button(prompt,()=>{$('prompt').value=prompt;$('prompt').focus();}));}
 draw();
}
function draw(){
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
 const v=$('view');v.replaceChildren();
 if(view==='source')return editor(v);
 if(view==='runs')return runs(v);
 if(!doc){const empty=el('div',undefined,'empty-graph graph-scroll');const content=el('div');content.append(el('span','◇ ─ ◇','diagram-icon'),el('b','Your network topology'),el('p','Generate a network in chat or import a .hocon definition.','hint'));empty.append(content);v.append(empty,button('Import HOCON',()=>{view='source';draw();}));return;}
 const rows=doc.graph.agents,levels=new Map(),positions=new Map();
 for(const node of rows){levels.set(node.id,node.after.length?1+Math.max(...node.after.map(id=>levels.get(id))):0);}
 const groups=[];for(const n of rows)(groups[levels.get(n.id)]||=[]).push(n);
 const height=Math.max(225,Math.max(...groups.map(g=>g.length))*94+32),width=groups.length*190+6;
 const scroll=el('div',undefined,'graph-scroll'),g=el('div',undefined,'graph');g.style.width=width+'px';g.style.height=height+'px';scroll.append(g);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');g.append(svg);
 groups.forEach((group,col)=>group.forEach((n,row)=>positions.set(n.id,{x:18+col*190,y:(height-group.length*94)/2+row*94+12})));
 for(const n of rows){const end=positions.get(n.id);for(const id of n.after){const start=positions.get(id),path=document.createElementNS(svg.namespaceURI,'path');const a=start.x+154,b=end.x,m=(a+b)/2;path.setAttribute('d','M'+a+' '+(start.y+30)+' C'+m+' '+(start.y+30)+' '+m+' '+(end.y+30)+' '+b+' '+(end.y+30));path.setAttribute('stroke','#a396c7');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.append(path);}}
 for(const n of rows){const p=positions.get(n.id),b=button(n.role,()=>{selected=n.id;draw();});b.className='agent'+(selected===n.id?' selected':'');b.style.left=p.x+'px';b.style.top=p.y+'px';b.append(el('small',n.id));g.append(b);}
 const n=rows.find(x=>x.id===selected)||rows.at(-1),detail=el('div',undefined,'pad');detail.append(el('span',n.id===rows.at(-1).id?'Coordinator':'Specialist','tag'),el('h3',n.role),el('p',n.instructions),el('p','Receives drafts from '+(n.after.join(', ')||'network input')+'.','hint'));v.append(scroll,detail);
}
function editor(v){
 const box=el('div',undefined,'pad'),code=el('textarea',undefined,'source');code.id='hocon';code.setAttribute('aria-label','HOCON source');code.spellcheck=false;code.value=sourceBuffer;code.readOnly=!!user&&user.role!=='admin';code.placeholder='Import a .hocon file or generate a network in chat.';
 code.oninput=()=>{sourceBuffer=code.value;$('revision').textContent=dirty()?'Unsaved HOCON':doc?'Revision '+doc.revision:'New draft';};const actions=el('div',undefined,'actions');
 const upload=el('input');upload.type='file';upload.accept='.hocon,.conf,text/plain';upload.hidden=true;upload.onchange=()=>action(async()=>{const file=upload.files[0];if(!file)return;if(file.size>24000)throw Error('File exceeds 24 KB.');if(!discard())return;sourceBuffer=await file.text();draw();note('Imported into editor. Save to validate and update topology.');});
 if(!user||user.role==='admin')actions.append(button('Import file',()=>upload.click()),button('Validate and save',()=>authorize(async()=>{const d=await api('command/save',{id:doc?.id,revision:doc?.revision,source:sourceBuffer});accept(d);await list();note('HOCON saved and topology updated.');}),true));
 actions.append(button('Download .hocon',()=>{if(!sourceBuffer)throw Error('No source to download.');const url=URL.createObjectURL(new Blob([sourceBuffer],{type:'text/plain'})),a=el('a');a.href=url;a.download=(doc?.title||'network').replace(/[^a-z0-9_-]+/gi,'-')+'.hocon';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
 box.append(el('h3','Network definition'),code,actions,upload);v.append(box);
}
function runs(v){
 const box=el('div',undefined,'pad');v.append(box);if(!doc){box.append(el('p','Create a network to publish a version and test it.'));return;}
 if(!doc.release){box.append(el('p','Publish revision '+doc.revision+' to test this exact HOCON definition.'));if(user?.role==='admin')box.append(button('Publish revision',async()=>{if(dirty())throw Error('Save HOCON changes before publishing.');accept(await api('command/publish',{id:doc.id,revision:doc.revision}));note('Published revision '+doc.revision+'.');},true));}
 else if(user?.role!=='auditor'){
 const form=el('form'),label=el('label','Test input'),input=el('textarea');input.id='testInput';input.required=true;input.maxLength=8000;input.value=runText;input.oninput=()=>{runText=input.value;};label.append(input);const submit=el('button','Run network','primary');form.append(label,submit);
 form.onsubmit=e=>{e.preventDefault();action(async()=>{if(dirty())throw Error('Save and publish source changes before testing.');await api('studio/run',{policy:doc.release.policy,evidence:runText});accept(await api('command/'+doc.id));note('Run saved. Outputs are available in Test runs.');},'Running the published network…');};box.append(form);
 }
 for(const r of doc.runs){const item=el('details',undefined,'log');item.append(el('summary','r'+r.revision+' · '+(r.result.networkState||r.result.engine)+' · '+r.state+' · '+r.result.ms+' ms'));item.append(el('small','Input'),el('p',r.result.evidence),el('small','Final output'),el('p',r.result.summary||r.result.action));if(r.result.sourceDigest)item.append(el('small','HOCON SHA-256 · '+r.result.sourceDigest.slice(0,16)));for(const a of r.result.specialists||[])item.append(el('strong',a.role+' · '+a.status),el('p',a.output||'No output.'),el('small',a.ms+' ms'));if(user.role==='supervisor'&&r.state==='Pending'&&r.actor!==user.email)for(const state of ['Approved','Returned'])item.append(button(state,async()=>{await api('studio/decision',{id:r.id,state});accept(await api('command/'+doc.id));}));box.append(item);}
}
$('compose').onsubmit=e=>{e.preventDefault();action(()=>authorize(async()=>{if(dirty())throw Error('Save your HOCON edits before revising through chat.');note('Designing the network…');const result=await api('command/chat',{id:doc?.id,revision:doc?.revision,prompt:$('prompt').value});$('prompt').value='';view='topology';accept(result);await list();note('Network generated and HOCON validated.');}));};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;draw();};
$('new').onclick=()=>{if(!discard())return;view='topology';runText='';$('prompt').value='';accept(null);note('');};
$('auth').onclick=()=>action(async()=>{if(!user)return authorize(()=>{});if(!discard())return;await api('logout',{});user=null;runText='';$('prompt').value='';accept(null);await list();note('Signed out.');});
async function login(data){try{await api('login',data);user=await api('me');$('credentials').reset();$('login').close();render();await list();const next=afterLogin;afterLogin=null;if(next)await action(next);}catch(e){$('loginError').textContent=e.message;note(e.message);}}
$('credentials').onsubmit=e=>{e.preventDefault();login(Object.fromEntries(new FormData(e.target)));};
$('demo').onclick=()=>login({email:'admin@studio.example',password:'AgentStudio-demo-2026'});
$('cancel').onclick=()=>{$('login').close();afterLogin=null;};
(async()=>{try{$('demo').hidden=!(await api('config')).demo;try{user=await api('me');}catch{}render();await list();}catch(e){note(e.message);}})();
