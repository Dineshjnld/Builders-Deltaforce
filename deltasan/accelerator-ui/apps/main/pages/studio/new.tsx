import BuilderChat from "../../components/BuilderChat"
import {useEffect,useState} from "react"
import {Background,Controls,MarkerType,ReactFlow,type Connection} from "@xyflow/react"
import {useRouter} from "next/router"
import {integrations,validate,type Agent,type Graph,type ToolKey} from "../../components/studioGraph"
import css from "../../components/Builder.module.css"

const initial:Graph={title:"",agents:[
    {id:"a0",name:"Coordinator",task:"Route each request to the appropriate specialist and return the result.",tools:[],x:20,y:110},
    {id:"a1",name:"Specialist",task:"Analyze the assigned request and report findings.",tools:[],x:330,y:40},
],routes:[{from:"a0",to:"a1",when:"The request needs specialist analysis"}]}
export default function Builder(){
    const [thinking,setThinking]=useState(false)
    const router=useRouter()
    const [catalog,setCatalog]=useState(integrations)
    useEffect(()=>{fetch("/api/studio?catalog=1").then(r=>r.json()).then(setCatalog).catch(()=>{})},[])
    const [g,set]=useState<Graph>(initial),[selected,select]=useState("a0"),[to,target]=useState(""),[when,condition]=useState("")
    const [status,report]=useState(""),[busy,wait]=useState(false),[published,saved]=useState(""),[loaded,ready]=useState(false)
    const a=g.agents.find(n=>n.id===selected)||g.agents[0]
    useEffect(()=>{
        if(!router.isReady)return
        let current=true
        async function load(){
            try{
                if(typeof router.query.source==="string"){
                    const r=await fetch("/api/studio?id="+encodeURIComponent(router.query.source))
                    if(!r.ok)throw Error("This network has no editable Studio source.")
                    const graph=await r.json();if(current)set({...graph,title:graph.title+" copy"})
                }else{const raw=sessionStorage.getItem("df-studio-graph");if(raw&&current){const draft=JSON.parse(raw);if(draft.agents?.length&&Array.isArray(draft.routes))set(draft)}}
            }catch(e){if(current)report(String(e))}finally{if(current)ready(true)}
        }
        void load();return()=>{current=false}
    },[router.isReady,router.query.source])
    useEffect(()=>{if(loaded)try{sessionStorage.setItem("df-studio-graph",JSON.stringify(g))}catch{}},[g,loaded])
    function update(next:Graph){if(busy)return;set(next);saved("");report("")}
    function patch(changes:Partial<Agent>){update({...g,agents:g.agents.map(n=>n.id===a.id?{...n,...changes}:n)})}
    function link(from:string,dest:string,label:string){
        if(!dest||dest===from||dest===g.agents[0].id||g.routes.some(r=>r.from===from&&r.to===dest)){report("Choose a different destination. Each pair can have one connection.");return}
        const next={...g,routes:[...g.routes,{from,to:dest,when:label}]}
        const loop=(id:string,seen:Set<string>):boolean=>id===from||(!seen.has(id)&&g.routes.filter(r=>r.from===id).some(r=>loop(r.to,new Set([...seen,id]))))
        if(loop(dest,new Set())){report("That connection would create a cycle.");return}update(next);target("");condition("")
    }
    function add(){
        const n=Math.max(...g.agents.map(n=>Number(n.id.slice(1))))+1
        const agent={id:"a"+n,name:"Agent"+n,task:"",x:330+(n%2)*80,y:80+n*90,tools:[]}
        update({...g,agents:[...g.agents,agent]});select(agent.id)
    }
    async function publish(){
        const problem=validate(g,catalog);if(problem){report(problem);return}
        wait(true);report("Registering the network…")
        try{
            let id=published
            if(!id){const r=await fetch("/api/studio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(g)});const data=await r.json();if(!r.ok)throw Error(data.error);id=data.network;saved(id)}
            for(let i=0;i<45;i++){const r=await fetch("/api/v1/list",{cache:"no-store"});if(r.ok&&(await r.json()).agents.some((n:{agent_name:string})=>n.agent_name===id)){sessionStorage.removeItem("df-studio-graph");await router.push("/multiAgentAccelerator?network="+encodeURIComponent(id));return}
                await new Promise(done=>setTimeout(done,1000))}
            report("Saved. The runtime has not loaded it yet. Check again to open it.")
        }catch(e){report(String(e))}finally{wait(false)}
    }
    const attachments=g.agents.flatMap(n=>n.tools.map((t,i)=>({id:n.id+":"+t,position:{x:n.x+160,y:n.y+70+55*i},data:{label:catalog[t]?.label||t},draggable:false,connectable:false,selectable:false,style:{fontSize:11,background:"#e8f0fa",border:"1px dashed #557798",color:"#213d5d"}})))
    return <main className={css.page}><header><div><a href="/multiAgentAccelerator?view=networks">← Agent networks</a><h1>Agent builder</h1></div><button className={css.primary} onClick={publish} disabled={busy||thinking||!loaded||!g.title.trim()}>{busy?"Registering…":published?"Check registration":"Create network"}</button></header>
    <BuilderChat graph={g} catalog={catalog} locked={busy||thinking||!loaded} onThinking={setThinking} onGraph={next=>{set(next);select(next.agents[0].id);saved("");report("")}} onPublish={publish}/>
    <p role="status">{status}</p><details open={router.query.source?true:undefined} inert={thinking||busy}><summary>Visual editor · agents, connections and tools</summary><label>Network name<input value={g.title} onChange={e=>update({...g,title:e.target.value})} placeholder="e.g. Service request routing" maxLength={100}/></label>
    <div className={css.layout}><section className={css.canvas}><div className={css.toolbar}><strong>Network graph</strong><button disabled={busy||g.agents.length>=16} onClick={add}>+ Add agent</button></div>
    <ReactFlow fitView nodes={[...g.agents.map(n=>({id:n.id,position:{x:n.x,y:n.y},data:{label:n.name||"Unnamed agent"},style:{background:n.id===a.id?"#d2f4e9":"white",border:"1px solid #439581",borderRadius:8,color:"#152e2b"},sourcePosition:"right" as any,targetPosition:"left" as any})),...attachments]}
      edges={[...g.routes.map(r=>({id:r.from+"-"+r.to,source:r.from,target:r.to,label:r.when||"Delegate",markerEnd:{type:MarkerType.ArrowClosed},labelStyle:{fontSize:10},style:{stroke:"#177c68",strokeWidth:2}})),...g.agents.flatMap(n=>n.tools.map(t=>({id:"bind:"+n.id+t,source:n.id,target:n.id+":"+t,style:{stroke:"#6685a3",strokeDasharray:"4 3"}})))]}
      onNodeClick={(_,n)=>{if(g.agents.some(agent=>agent.id===n.id)){select(n.id);target("")}}} onNodesChange={changes=>{if(busy)return;const moves=new Map(changes.filter(c=>c.type==="position"&&c.position).map(c=>[c.id,(c as any).position]));if(moves.size)set(prev=>({...prev,agents:prev.agents.map(n=>moves.has(n.id)?{...n,...moves.get(n.id)}:n)}))}}
      onConnect={(c:Connection)=>link(c.source,c.target,"")} deleteKeyCode={null}><Background/><Controls/></ReactFlow></section>
    <fieldset disabled={busy} className={css.inspector}><legend>Agent settings</legend><label>Selected agent<select value={a.id} onChange={e=>{select(e.target.value);target("")}}>{g.agents.map(n=><option key={n.id} value={n.id}>{n.name}{n===g.agents[0]?" · Entry":""}</option>)}</select></label>
    <label>Agent name<input value={a.name} onChange={e=>patch({name:e.target.value})}/></label><label>Assignment<textarea value={a.task} onChange={e=>patch({task:e.target.value})}/></label>
    <h2>Decision connections</h2><p>The agent uses each condition to choose where to delegate.</p>
    {g.routes.filter(r=>r.from===a.id).map(r=><div key={r.to} className={css.route}><label>Route to {g.agents.find(n=>n.id===r.to)?.name}<input aria-label={"Condition for "+r.to} value={r.when} placeholder="When should this agent be called?" onChange={e=>update({...g,routes:g.routes.map(edge=>edge===r?{...r,when:e.target.value}:edge)})}/></label><button onClick={()=>update({...g,routes:g.routes.filter(edge=>edge!==r)})}>Disconnect</button></div>)}
    <label>Destination<select value={to} onChange={e=>target(e.target.value)}><option value="">Choose agent</option>{g.agents.filter(n=>n!==a&&n!==g.agents[0]&&!g.routes.some(r=>r.from===a.id&&r.to===n.id)).map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
    {to&&<label>Delegate when<input value={when} onChange={e=>condition(e.target.value)} placeholder="Condition or purpose"/></label>}
    <button disabled={!to} onClick={()=>link(a.id,to,when)}>Connect agents</button>
    <h2>Tools & MCP servers</h2>{(Object.keys(catalog) as ToolKey[]).map(key=><label className={css.tool} key={key}><input type="checkbox" checked={a.tools.includes(key)} onChange={e=>patch({tools:e.target.checked?[...a.tools,key]:a.tools.filter(t=>t!==key)})}/><span>{catalog[key].label} · {catalog[key].type}<small>{catalog[key].description}</small></span></label>)}
    {a!==g.agents[0]&&<button onClick={()=>{update({...g,agents:g.agents.filter(n=>n!==a),routes:g.routes.filter(r=>r.from!==a.id&&r.to!==a.id)});select(g.agents[0].id)}}>Remove agent</button>}</fieldset></div></details></main>
}

