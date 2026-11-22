import {useEffect,useState} from "react"
import {ScienceOutlined,FactCheckOutlined,PlayArrow} from "@mui/icons-material"
import ui from "../components/Operations.module.css"
import {networkLabel} from "../components/OperationsShell"
export default function Harness(){
    const [names,setNames]=useState<string[]>([]),[network,select]=useState(""),[input,setInput]=useState(""),[expected,expect]=useState("")
    const [busy,setBusy]=useState(false),[result,report]=useState("")
    useEffect(()=>{fetch("/api/v1/list").then(r=>r.json()).then(x=>{setNames(x.agents.map((a:{agent_name:string})=>a.agent_name));select(x.agents[0]?.agent_name||"")}).catch(()=>report("Network registry unavailable."))},[])
    async function run(){
        setBusy(true);report("Running test…");const start=performance.now()
        try{
            const target="/api/v1/"+network.split("/").map(encodeURIComponent).join("/")
            const graph=await fetch(target+"/connectivity");if(!graph.ok)throw Error("Network connectivity check failed.")
            const res=await fetch(target+"/streaming_chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_message:{type:"HUMAN",text:input},chat_filter:{chat_filter_type:"MAXIMAL"}}),signal:AbortSignal.timeout(135000)})
            if(!res.ok)throw Error("Runtime returned HTTP "+res.status)
            const frames=(await res.text()).trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x).response)
            const final=frames.filter(f=>f?.type==="AGENT_FRAMEWORK"&&f.text).at(-1)?.text||""
            const pass=final.toLowerCase().includes(expected.trim().toLowerCase())
            report((pass?"Passed":"Failed")+" · "+frames.length+" events · "+Math.round((performance.now()-start)/1000)+"s\n\n"+(final||"No final answer returned."))
        }catch(e){report(String(e))}finally{setBusy(false)}
    }
    const [summary,...paragraphs]=result.split("\n\n")
    const answer=paragraphs.join("\n\n")
    return <main className={ui.page}><header className={ui.head}><div className={ui.kicker}>NETWORK VALIDATION</div><h1>Run harness</h1><p>Test a registered network against an expected answer before using it in a workflow.</p></header>
    <div className={ui.grid}><section className={ui.card}><div className={ui.cardHead}><span className={ui.icon}><ScienceOutlined/></span><h2>Test configuration</h2></div>
    <form className={ui.pad} onSubmit={e=>{e.preventDefault();if(!busy)void run()}}><div className={ui.fields}><div><label className={ui.field} htmlFor="target">Target network</label><select id="target" disabled={busy} value={network} onChange={e=>select(e.target.value)}>{names.map(n=><option key={n} value={n}>{networkLabel(n)}</option>)}</select></div>
    <div><label className={ui.field} htmlFor="sample">Test input</label><textarea id="sample" required disabled={busy} placeholder="Enter a representative request for this network." value={input} onChange={e=>setInput(e.target.value)}/></div>
    <div><label className={ui.field} htmlFor="assertion">Expected text</label><input id="assertion" required disabled={busy} placeholder="Text the final answer should contain" value={expected} onChange={e=>expect(e.target.value)}/><p className={ui.meta}>The assertion ignores letter case.</p></div></div>
    <div className={ui.actions}><span className={ui.meta}>Runs against the live network</span><button className={ui.primary} disabled={busy||!network||!input.trim()||!expected.trim()}><PlayArrow fontSize="small"/>{busy?"Running test…":"Run test"}</button></div></form></section>
    <section className={ui.result} aria-live="polite"><div className={ui.cardHead}><FactCheckOutlined/><h2>Test result</h2></div><div className={ui.pad}><h3>{summary||"Awaiting test run"}</h3>{answer?<pre>{answer}</pre>:<p>{busy?"Collecting the streamed response…":result?"":"After a run, inspect the assertion result, elapsed time, and final response here."}</p>}</div></section></div></main>
}
