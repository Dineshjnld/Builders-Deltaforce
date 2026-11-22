import {useEffect,useRef,useState} from "react"
import type {Graph,Catalog} from "./studioGraph"
import css from "./Builder.module.css"

type Props={graph:Graph;catalog:Catalog;locked:boolean;onGraph:(g:Graph)=>void;onPublish:()=>Promise<void>;onThinking:(v:boolean)=>void}
type Turn={who:string;text:string}
export default function BuilderChat({graph,catalog,locked,onGraph,onPublish,onThinking}:Props){
    const [turns,setTurns]=useState<Turn[]>([]),[input,type]=useState(""),[thinking,think]=useState(false),[error,report]=useState("")
    const bottom=useRef<HTMLDivElement>(null),sending=useRef(false)
    useEffect(()=>{if(turns.length)bottom.current?.scrollIntoView({block:"nearest"})},[turns])
    async function send(){
        const message=input.trim()
        if(!message||locked||sending.current)return
        if(graph.title&&/^(?:create|publish|deploy|register|launch)(?: (?:it|this|the network|this network))?[.!]?$/i.test(message)){type("");await onPublish();return}
        sending.current=true;think(true);onThinking(true);report("");type("")
        setTurns(t=>[...t,{who:"You",text:message}])
        try{
            const r=await fetch("/api/studio?action=chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,current:graph,conversation:turns.slice(-8)})})
            const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to design the network.")
            const next:Graph=data.graph;onGraph(next)
            const names=Object.fromEntries(next.agents.map(a=>[a.id,a.name]))
            const assignments=next.agents.map(a=>a.name+" — "+a.task+(a.tools.length?" ["+a.tools.map(k=>catalog[k]?.label||k).join(", ")+"]":""))
            const routes=next.routes.map(r=>names[r.from]+" → "+names[r.to]+": "+r.when)
            setTurns(t=>[...t,{who:"Agent builder",text:next.title+"\n\n"+assignments.join("\n")+"\n\n"+routes.join("\n")}])
        }catch(e){report(e instanceof Error?e.message:String(e));type(message)}
        finally{sending.current=false;think(false);onThinking(false)}
    }
    return <section className={css.chat}><h2>Build with chat</h2><p>Describe the job, the agents you need, and any tools they should use. You can refine the design before creating it.</p>
    <div className={css.messages} role="log">{turns.map((t,i)=><div key={i} data-who={t.who}><strong>{t.who}</strong><div>{t.text}</div></div>)}<div ref={bottom}/></div>
    <form onSubmit={e=>{e.preventDefault();void send()}}><label htmlFor="builder-message">Message the agent builder</label><textarea id="builder-message" value={input} maxLength={4000} onChange={e=>type(e.target.value)} placeholder="Build a service desk network with a coordinator and two specialists…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
    <div className={css.chatActions}><span role="status">{thinking?"Designing your network…":error}</span><button className={css.primary} disabled={!input.trim()||locked||thinking}>Send</button></div></form>
    {graph.title&&<div className={css.chatActions}><span>Current draft · {graph.title} · {graph.agents.length} agents</span><button onClick={onPublish} disabled={locked||thinking}>Create this network →</button></div>}</section>
}
