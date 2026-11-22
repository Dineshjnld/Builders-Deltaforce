import {designFromChat} from "../../components/chatDesign"
import type {NextApiRequest,NextApiResponse} from "next"
import {readFile,writeFile,rename} from "node:fs/promises"
import {randomUUID} from "node:crypto"
import {compile,integrations,type Catalog,type Graph} from "../../components/studioGraph"
const root=process.env["DELTA_REGISTRY"] || "/delta-registry"
let queue=Promise.resolve()
async function catalog():Promise<Catalog>{
    try{
        const extra:Catalog=JSON.parse(await readFile(root+"/tools.catalog","utf8"))
        return {...integrations,...extra}
    }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return integrations;throw e}
}
async function publish(graph:Graph){
    const spec=compile(graph,await catalog())
    const id=graph.title.toLowerCase().replace(/[^a-z0-9]+/g,"_").slice(0,48)+"_"+randomUUID().replaceAll("-","").slice(0,12)
    const manifest=root+"/manifest.hocon"
    const entries=JSON.parse(await readFile(manifest,"utf8"))
    await writeFile(root+"/"+id+".hocon",'{\ninclude "config/llm_config.hocon"\n'+JSON.stringify(spec,null,2).slice(1),{flag:"wx"})
    await writeFile(root+"/"+id+".studio",JSON.stringify(graph),{flag:"wx"})
    entries["deltaforce/"+id+".hocon"]=true
    const tmp=manifest+"."+id+".tmp";await writeFile(tmp,JSON.stringify(entries,null,2));await rename(tmp,manifest)
    return "deltaforce/"+id
}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
    res.setHeader("Cache-Control","no-store")
    if(req.method==="GET"){
        if(req.query.catalog==="1")return res.json(await catalog())
        const id=req.query.id
        if(typeof id!=="string"||!/^deltaforce\/[a-z0-9_]+_[a-f0-9]{12}$/.test(id))return res.status(400).end()
        if (req.query.format === "hocon") {
            try {
                const source = await readFile(root + "/" + id.slice("deltaforce/".length) + ".studio", "utf8")
                const definition = compile(JSON.parse(source), await catalog())
                res.setHeader("Content-Disposition", `attachment; filename="${id.slice("deltaforce/".length)}.hocon"`)
                return res.status(200).setHeader("Content-Type", "text/plain; charset=utf-8").send(JSON.stringify(definition, null, 2))
            } catch {
                return res.status(404).json({error: "Network source unavailable."})
            }
        }
        try{return res.json(JSON.parse(await readFile(root+"/"+id.slice('deltaforce/'.length)+".studio","utf8")))}catch{return res.status(404).end()}
    }
    if(req.method!=="POST"||!req.headers["content-type"]?.startsWith("application/json"))return res.status(405).end()
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.status(403).end()
    if(req.query.action==="chat"){
        try{return res.json({graph:await designFromChat(req.body.message,req.body.current,await catalog(),req.body.conversation)})}
        catch(e){return res.status(422).json({error:e instanceof Error?e.message:"Could not generate the network."})}
    }
    try{const job=queue.then(()=>publish(req.body));queue=job.then(()=>{},()=>{});return res.json({network:await job})}
    catch(e){return res.status(422).json({error:e instanceof Error?e.message:"Registration failed."})}
}
