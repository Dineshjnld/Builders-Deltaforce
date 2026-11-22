import {useEffect,useRef,useState} from "react"
import {AssignmentOutlined,MicNone,AccountTreeOutlined,ShieldOutlined,ArrowForward,HubOutlined,ChevronRight} from "@mui/icons-material"
import ui from "./Operations.module.css"
import {networkLabel} from "./OperationsShell"

type Plan={title:string; outcome:string; agents:{name:string;task:string}[]}
type Recognition={lang:string; onresult:(event:any)=>void; onerror:(event:any)=>void; onend:()=>void; start:()=>void; stop:()=>void}
export default function DeltaIntake(){
    const [text,setText]=useState(""),[history,setHistory]=useState<string[]>([]),[plan,setPlan]=useState<Plan|null>(null)
    const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[listening,setListening]=useState(false),[network,setNetwork]=useState("")
    const [draftReady,setDraftReady]=useState(false)
    useEffect(()=>{
        try {
            const raw=sessionStorage.getItem("deltaforce-intake-draft")
            if(raw){
                const draft=JSON.parse(raw)
                if(typeof draft.text==="string")setText(draft.text)
                if(Array.isArray(draft.history))setHistory(draft.history.filter((turn:unknown)=>typeof turn==="string"))
                if(draft.plan && Array.isArray(draft.plan.agents))setPlan(draft.plan)
                if(typeof draft.network==="string")setNetwork(draft.network)
            }
        }catch{/* Unavailable storage still allows intake. */}
        setDraftReady(true)
    },[])
    useEffect(()=>{
        if(!draftReady)return
        try{sessionStorage.setItem("deltaforce-intake-draft",JSON.stringify({text,history,plan,network}))}catch{/* Storage is optional. */}
    },[draftReady,text,history,plan,network])
    function newBrief(){
        setText("");setHistory([]);setPlan(null);setNetwork("");setMessage("")
    }
    const mic=useRef<Recognition|null>(null)
    useEffect(()=>()=>mic.current?.stop(),[])
    function dictate(){
        if(listening){mic.current?.stop();return}
        const api=window as any
        const Engine=api.SpeechRecognition||api.webkitSpeechRecognition
        if(!Engine){setMessage("Voice input requires a browser with speech recognition, such as Edge or Chrome.");return}
        const rec:Recognition=new Engine();mic.current=rec;rec.lang=navigator.language
        rec.onresult=e=>setText(s=>(s+" "+e.results[0][0].transcript).trim().slice(0,4000))
        rec.onerror=e=>setMessage("Voice input: "+e.error);rec.onend=()=>setListening(false)
        try{rec.start();setListening(true)}catch{setMessage("Microphone access is unavailable.")}
    }
    async function request(body:object){
        const r=await fetch("/api/intake",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
        const data=await r.json();if(!r.ok)throw Error(data.error||"Request failed");return data
    }
    async function design(){
        const turns=[...history,text.trim()]
        if(turns.join("\nRefinement: ").length>4000){setMessage("Keep the combined brief under 4,000 characters.");return}
        setBusy(true);setMessage("Designing with the local model…")
        try{const data=await request({action:"design",brief:turns.join("\nRefinement: ")});setPlan(data.plan);setHistory(turns);setText("");setMessage("")}
        catch(e){setMessage(String(e))}finally{setBusy(false)}
    }
    async function launch(){
        setBusy(true);setMessage("Checking network registration…")
        try{
            const id=network||(await request({action:"deploy",plan})).network;setNetwork(id)
            for(let i=0;i<45;i++){const r=await fetch("/api/v1/list",{cache:"no-store"})
                if(r.ok&&(await r.json()).agents.some((a:{agent_name:string})=>a.agent_name===id)){try{sessionStorage.removeItem("deltaforce-intake-draft")}catch{};location.assign("/multiAgentAccelerator?network="+encodeURIComponent(id));return}
                await new Promise(done=>setTimeout(done,1000))}
            setMessage("Network saved. Check registration again in a moment.")
        }catch(e){setMessage(String(e))}finally{setBusy(false)}
    }
    const [catalog,setCatalog]=useState<{agent_name:string;description?:string}[]>([])
    const [catalogState,setCatalogState]=useState("Loading networks…"),[filter,setFilter]=useState("")
    useEffect(()=>{
        const abort=new AbortController()
        fetch("/api/v1/list",{signal:abort.signal}).then(async r=>{
            if(!r.ok) throw Error()
            const data=await r.json()
            setCatalog(data.agents);setCatalogState("")
        }).catch(()=>{if(!abort.signal.aborted)setCatalogState("Network registry unavailable.")})
        return ()=>abort.abort()
    },[])
    const remaining=Math.max(0,4000-history.join("\nRefinement: ").length-(history.length?13:0))
    const samples=[
        ["Inspection handover","Summarize facilities inspection notes for the office manager. Identify each defect, its owner, and any missing evidence."],
        ["Service triage","Review incoming service requests, group them by urgency, and prepare a queue summary for the service desk lead."],
        ["Report review","Compare weekly team reports and prepare a brief listing progress, inconsistencies, and items requiring review."],
    ]
    const matches=catalog.filter(n=>(networkLabel(n.agent_name)+" "+(n.description||"")).toLowerCase().includes(filter.toLowerCase()))
    return <main className={ui.page}><header className={ui.head}><div className={ui.kicker}>WORKFLOW OPERATIONS</div><h1>Workflow intake</h1><p>Turn an operational brief into a reviewed, runnable agent network.</p></header>
    <div className={ui.steps} aria-label="Workflow progress"><b>{plan?"✓":"●"} Define brief</b><span>›</span>{plan?<b>● Review design</b>:<span>Review design</span>}<span>›</span><span>Launch network</span></div>
    <div className={ui.grid}><div className={ui.stack}><section className={ui.card}>
    <div className={ui.cardHead}><span className={ui.icon}><AssignmentOutlined/></span><h2>{plan?"Refine the brief":"Problem statement"}</h2></div>
    <div className={ui.pad}>{plan&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm("Start a new brief and clear this draft?"))newBrief()}}>New brief</button>}{history.length>0&&<details><summary>Submitted brief · {history.length} {history.length===1?"message":"messages"}</summary>{history.map((turn,i)=><blockquote key={i} className={ui.history}>{turn}</blockquote>)}</details>}
    <label className={ui.field} htmlFor="brief">{plan?"What should change?":"Describe the workflow"}</label>
    <textarea id="brief" maxLength={remaining} value={text} disabled={busy||!!network} onChange={e=>setText(e.target.value)} placeholder={plan?"Specify the assignment, constraint, or deliverable to revise.":"What information comes in, who uses it, and what should the team receive?"}/>
    <div className={ui.tools}><button disabled={busy||!!network} aria-pressed={listening} onClick={dictate}><MicNone fontSize="small"/>{listening?"Stop recording":"Dictate"}</button><span className={ui.meta}>{text.length.toLocaleString()} / {remaining.toLocaleString()}</span></div>
    {!plan&&<div className={ui.sample}><p className={ui.meta}>Start with an example</p><div className={ui.row}>{samples.map(([label,value])=><button key={label} disabled={busy} onClick={()=>setText(value)}>{label}</button>)}</div></div>}
    <div className={ui.actions}><span className={ui.meta}>Local model · {plan?"Refinement":"Network design"}</span><button className={ui.primary} disabled={busy||!!network||(!plan&&text.trim().length<15)||!text.trim()} onClick={design}>{busy&&!network?"Working…":plan?"Update design":"Design network"} <ArrowForward fontSize="small"/></button></div>
    <div className={ui.status} role="status">{message}</div></div></section>
    <section className={ui.card}><div className={ui.cardHead}><ShieldOutlined fontSize="small"/><h2>Run controls</h2></div><div className={ui.pad}><dl className={ui.controls}><dt>Specialist permissions</dt><dd>Text output only</dd><dt>Execution limit</dt><dd>120 seconds</dd><dt>Registration</dt><dd>Operator approval</dd></dl></div></section></div>
    <section className={ui.card}><div className={ui.cardHead}><span className={ui.icon}><AccountTreeOutlined/></span><h2>Network preview</h2></div><div className={ui.graph}><small>{plan?"Proposed topology":"Example topology"}</small><span className={ui.node}>Coordinator</span><div className={ui.branch}>{(plan?.agents.map(a=>a.name)||["Specialist","Reviewer"]).map(v=><span key={v} className={ui.node}>{v}</span>)}</div></div>
    <div className={ui.pad}><h2>{plan?.title||"Awaiting your brief"}</h2><p>{plan?.outcome||"Submit a statement to see the proposed outcome and each specialist’s assignment."}</p>{plan?.agents.map(a=><div className={ui.agent} key={a.name}><strong>{a.name}</strong><p>{a.task}</p></div>)}
    {plan&&<div className={ui.actions}><button className={ui.primary} disabled={busy||!!text.trim()} onClick={launch}>{network?"Open registered network":"Approve & open DeltaSAN"} <ArrowForward fontSize="small"/></button></div>}</div></section></div>
    <section className={ui.card+" "+ui.listing}><div className={ui.cardHead}><HubOutlined fontSize="small"/><h2>Registered networks</h2><span className={ui.meta}>{catalog.length}</span></div><div className={ui.pad}><input type="search" aria-label="Filter registered networks" placeholder="Filter networks…" value={filter} onChange={e=>setFilter(e.target.value)}/>{matches.slice(0,filter?50:4).map(n=><a className={ui.line} key={n.agent_name} href={"/multiAgentAccelerator?network="+encodeURIComponent(n.agent_name)}><span>{networkLabel(n.agent_name)}</span><ChevronRight fontSize="small"/></a>)}{!matches.length&&<p>{catalogState||"No matching networks."}</p>}</div></section></main>
}
