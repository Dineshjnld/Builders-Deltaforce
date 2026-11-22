import {useEffect, useState} from "react"
import {useRouter} from "next/router"
import Studio from "./multiAgentAccelerator"
import styles from "../components/Deployments.module.css"

type Review = {id:string;message:string;network:string}
export default function Playground() {
    const router=useRouter()
    const [networks,setNetworks]=useState<string[]>([]),[pending,setPending]=useState<Review[]>([])
    const [required,setRequired]=useState<string[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false)
    async function refresh(){
        const r=await fetch("/api/reviews")
        if(!r.ok)throw Error("The review queue is unavailable.")
        const data=await r.json();setPending(data.pending);setRequired(data.required)
    }
    useEffect(()=>{
        let live=true
        const list=()=>fetch("/api/v1/list").then(r=>r.json()).then(data=>{if(live)setNetworks(data.agents.map((x:{agent_name:string})=>x.agent_name).filter((n:string)=>/^(deltaforce|city|generated)\//.test(n)).sort())}).catch(()=>{if(live)setError("The network directory is unavailable.")})
        void list()
        const load=()=>{refresh().catch(e=>{if(live)setError(e.message)})}
        load();const timer=setInterval(()=>{load();void list()},6000)
        return ()=>{live=false;clearInterval(timer)}
    },[])
    async function act(id:string,action:string){
        setBusy(true);setError("")
        try{
            const r=await fetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json","x-delta-review":"1"},body:JSON.stringify({id,action})})
            if(!r.ok)throw Error((await r.json()).detail || "Could not save the decision.")
            await refresh()
        }catch(e){setError(e instanceof Error?e.message:"Request failed.")}finally{setBusy(false)}
    }
    if(typeof router.query["network"]==="string" && networks.includes(router.query["network"]))return <Studio/>
    return <main className={styles["page"]}><header><div><h1>Playground</h1><span>Test a saved network or review a customer request.</span></div>
        <a href="/multiAgentAccelerator?network=agent_network_designer">New agent</a></header>
        {error&&<p role="alert">{error}</p>}
        {router.query["network"] && <p role="status">Waiting for the selected network to appear in the runtime…</p>}
        <section><h2>Human approvals</h2>{!pending.length&&<p>No requests waiting for review.</p>}
            {pending.map(r=><div key={r.id}><strong>{r.network}</strong><p>{r.message}</p>
                <button disabled={busy} onClick={()=>act(r.id,"approve")}>Approve and run</button>{" "}
                <button disabled={busy} onClick={()=>act(r.id,"decline")}>Decline</button></div>)}</section>
        <section><h2>Networks</h2>{networks.map(n=>{
            const key=n.slice(5), deployed=n.startsWith("city/")
            return <div key={n} style={{display:"flex",gap:16,alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #425064",flexWrap:"wrap"}}>
                <a href={"/playground?network="+encodeURIComponent(n)}>{n.replace(/_[a-f0-9]{12}(?=_|$)/g,"").replaceAll("_"," ")}</a>
                {deployed&&<label><input type="checkbox" checked={required.includes(key)} disabled={busy}
                    onChange={e=>act(key,e.target.checked?"require":"optional")}/> Require approval before every customer turn</label>}</div>
        })}</section></main>
}
