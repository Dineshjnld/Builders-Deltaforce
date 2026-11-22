import {validate,type Graph,type Catalog} from "./studioGraph"

type Member={name:string;task:string;tools:string[];parents:{index:number;when:string}[]}
const str=(maxLength:number)=>({type:"string",minLength:1,maxLength})
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false})

export async function designFromChat(message:string,current:Graph|undefined,catalog:Catalog,conversation:unknown){
    if(typeof message!=="string"||!message.trim()||message.length>4000)throw Error("Enter a request of up to 4,000 characters.")
    const keys=Object.keys(catalog)
    const schema=object({title:str(80),agents:{type:"array",minItems:1,maxItems:10,items:object({
        name:str(40),task:str(500),tools:{type:"array",maxItems:4,items:{type:"string",enum:keys}},
        parents:{type:"array",maxItems:4,items:object({index:{type:"integer",minimum:0,maximum:9},when:str(180)})}
    })}})
    const prompt="You design organizational agent networks. Return the complete updated network. Answer the request directly with a usable design. First agent is the coordinator at index 0. For every subsequent agent, provide its parent index (zero based, earlier in array) and a short delegation condition. Use descriptive PascalCase names. Attach tools only when relevant. For edits keep the previous roles, connections and tool assignments unless the request changes them. Tool catalog: "+JSON.stringify(Object.fromEntries(keys.map(k=>[k,catalog[k].label])))
    const r=await fetch("http://host.docker.internal:45185/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(120000),body:JSON.stringify({model:"local-qwen",temperature:0.1,max_tokens:2400,response_format:{type:"json_schema",json_schema:{name:"studio_design",strict:true,schema}},messages:[{role:"system",content:prompt},{role:"user",content:JSON.stringify({previousMessages:Array.isArray(conversation)?conversation.slice(-6).map(t=>({speaker:String(t?.who).slice(0,40),text:String(t?.text).slice(0,1200)})):[],current:current?.title?current:null,request:message})}]})})
    if(!r.ok)throw Error("The local model could not generate a design. Please retry.")
    const result=JSON.parse((await r.json()).choices[0].message.content) as {title:string;agents:Member[]}
    const names=new Set<string>()
    const graph:Graph={title:result.title,agents:[],routes:[]}
    for(const [i,m] of result.agents.entries()){
        let name=m.name.replace(/[^a-zA-Z0-9_]/g,"")
        if(!/^[a-zA-Z]/.test(name)||name.toLowerCase()==="web_fetch")name="Agent"+i
        while(names.has(name.toLowerCase()))name+="_"+i
        names.add(name.toLowerCase())
        graph.agents.push({id:"a"+i,name,task:m.task,tools:[...new Set(m.tools)],x:i?320:20,y:i?(i-1)*105:95})
        if(!i)continue
        const parents=m.parents.filter((p,j)=>p.index<i&&m.parents.findIndex(o=>o.index===p.index)===j)
        for(const p of parents.length?parents:[{index:0,when:m.task}])graph.routes.push({from:"a"+p.index,to:"a"+i,when:p.when})
    }
    const error=validate(graph,catalog);if(error)throw Error(error)
    return graph
}
