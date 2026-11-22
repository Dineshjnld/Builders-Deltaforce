import Link from "next/link"
import {useRouter} from "next/router"
import {useEffect,useState,type ReactNode} from "react"
import {AccountTreeOutlined,AssignmentOutlined,ScienceOutlined,MenuBookOutlined,ChevronRight,HubOutlined,Menu,Close} from "@mui/icons-material"
import ui from "./Operations.module.css"

const sections=[
    {href:"/multiAgentAccelerator",title:"Build with chat",Icon:AssignmentOutlined},
    {href:"/multiAgentAccelerator?view=networks",title:"Agent networks",Icon:AccountTreeOutlined},
]
export function networkLabel(id:string){
    const label=id.split("/").pop()?.replace(/_[a-f0-9]{12}$/,"").replace(/_/g," ")||id
    return label.charAt(0).toUpperCase()+label.slice(1)
}
export default function OperationsShell({children}:{children:ReactNode}){
    const {pathname,query,asPath}=useRouter()
    const [open,toggle]=useState(false),[health,setHealth]=useState("Checking runtime")
    useEffect(()=>{
        const controller=new AbortController()
        const check=async()=>{try{const r=await fetch("/api/v1/list",{signal:controller.signal,cache:"no-store"});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.agents))throw Error();setHealth("Runtime online")}catch{if(!controller.signal.aborted)setHealth("Runtime unavailable")}}
        void check();const timer=setInterval(check,60000);return()=>{controller.abort();clearInterval(timer)}
    },[])
    useEffect(()=>{toggle(false)},[asPath])
    useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape")toggle(false)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[])
    const active=pathname==="/multiAgentAccelerator" && Object.keys(query).length>0 ? sections[1] : sections[0]
    return <div className={ui.frame}><a className={ui.skip} href="#workspace">Skip to workspace</a>
    {open&&<button className={ui.scrim} aria-label="Close navigation" onClick={()=>toggle(false)}/>}
    <aside id="workspace-navigation" className={ui.rail+" "+(open?ui.expanded:"")}>
      <Link href="/multiAgentAccelerator" className={ui.brand}><span className={ui.mark}>Δ</span>DeltaForce</Link>
      <div className={ui.groupLabel}>WORKSPACE</div>
      <nav aria-label="Workspace">{sections.map(({href,title,Icon})=><Link aria-current={active.href===href?"page":undefined} href={href} key={href}><Icon fontSize="small"/>{title}</Link>)}</nav>
      <div className={ui.railFoot}><div><HubOutlined fontSize="small"/>Local deployment</div></div>
    </aside><div className={ui.stage}><header className={ui.bar}><button className={ui.menu} onClick={()=>toggle(!open)} aria-expanded={open} aria-controls="workspace-navigation" aria-label="Toggle navigation">{open?<Close/>:<Menu/>}</button><span>Workspace</span><ChevronRight fontSize="small"/><strong>{active?.title||"DeltaSAN"}</strong><span className={ui.health} data-ready={health==="Runtime online"}>{health}</span></header>
    <div id="workspace" tabIndex={-1} className={ui.body} data-studio={active===sections[1]}>{children}</div></div></div>
}
