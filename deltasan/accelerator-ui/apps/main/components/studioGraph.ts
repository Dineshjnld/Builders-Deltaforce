export type Catalog=Record<string,{label:string;type:string;target:string;description:string}>
export const integrations:Catalog = {
    clock:{label:"Local clock",type:"MCP",target:"http://127.0.0.1:45186/mcp",description:"Current date and time in an IANA time zone."},
    docs:{label:"DeepWiki",type:"MCP",target:"https://mcp.deepwiki.com/mcp",description:"Read documentation for public repositories."},
    search:{label:"You.com search",type:"MCP",target:"https://api.you.com/mcp?profile=free",description:"Find public web sources."},
    fetch:{label:"Web fetch",type:"Toolbox",target:"web_fetch",description:"Read the text of a supplied web page."},
} as const
export type ToolKey = string
export type Agent = {id:string;name:string;task:string;tools:ToolKey[];x:number;y:number}
export type Route = {from:string;to:string;when:string}
export type Graph = {title:string; agents:Agent[]; routes:Route[]}
export function validate(g:Graph,catalog:Catalog=integrations):string {
    if(!g || typeof g.title!=="string" || !g.title.trim() || g.title.length>100)return "Give the network a name (up to 100 characters)."
    if(!Array.isArray(g.agents)||!g.agents.length||g.agents.length>16)return "Use 1–16 agents."
    if(!Array.isArray(g.routes)||g.routes.length>80)return "Use at most 80 connections."
    const ids=new Set<string>(), names=new Set<string>()
    for(const a of g.agents){
        if(!a||typeof a.id!=="string"||!/^a[0-9]{1,12}$/.test(a.id)||ids.has(a.id))return "Each agent needs a unique ID."
        if(typeof a.name!=="string"||!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(a.name)||names.has(a.name.toLowerCase())||a.name.toLowerCase()==="web_fetch")return "Use unique agent names starting with a letter and containing letters, numbers or underscores."
        if(typeof a.task!=="string"||!a.task.trim()||a.task.length>2000)return "Give each agent an assignment of 1–2,000 characters."
        if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||!Array.isArray(a.tools)||a.tools.some(t=>!Object.hasOwn(catalog,t)))return "Invalid agent position or tool binding."
        ids.add(a.id);names.add(a.name.toLowerCase())
    }
    const links=new Set<string>()
    for(const r of g.routes){
        if(!r||!ids.has(r.from)||!ids.has(r.to)||r.to===g.agents[0].id||typeof r.when!=="string"||r.when.length>500)return "Connections must link existing agents and cannot target the entry agent."
        const key=r.from+":"+r.to
        if(links.has(key))return "Remove duplicate connections."
        links.add(key)
    }
    const seen=new Set<string>(),active=new Set<string>()
    function visit(id:string):boolean{
        if(active.has(id))return false
        if(seen.has(id))return true
        active.add(id);seen.add(id)
        for(const r of g.routes.filter(r=>r.from===id))if(!visit(r.to))return false
        active.delete(id);return true
    }
    if(!visit(g.agents[0].id))return "Remove the circular connection before publishing."
    if(seen.size!==ids.size)return "Connect every agent to a path from the entry agent."
    return ""
}
export function compile(g:Graph,catalog:Catalog=integrations){
    const problem=validate(g,catalog);if(problem)throw Error(problem)
    const tools:object[]=g.agents.map((a,i)=>{
        const outgoing=g.routes.filter(r=>r.from===a.id).map(r=>({name:g.agents.find(n=>n.id===r.to)!.name,when:r.when.trim()}))
        const directions=outgoing.map(r=>"Call "+r.name+" when "+(r.when||"its assignment is relevant")+".").join("\n")
        return {name:a.name,function:{description:a.task,...(i?{parameters:{type:"object",properties:{assignment:{type:"string",description:"Task and supporting context"}},required:["assignment"]}}:{})},
            instructions:[a.task,directions,a.tools.length?"Use the assigned tools when the request needs their information.":""].filter(Boolean).join("\n"),
            tools:[...outgoing.map(r=>r.name),...new Set(a.tools.map(t=>catalog[t].target))]}
    })
    if(g.agents.some(a=>a.tools.includes("fetch")))tools.push({name:"web_fetch",toolbox:"web_fetch"})
    return {metadata:{description:g.title},max_execution_seconds:120,tools}
}
