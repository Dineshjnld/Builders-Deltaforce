import type {NextApiRequest, NextApiResponse} from "next"

export const config = {api: {bodyParser: false}}

export default async function voice(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "no-store")
    const {action, lang} = req.query
    if (action==="realtime") {
        if(!["GET","POST"].includes(req.method || ""))return res.status(405).end()
        if(req.method==="POST" && (req.headers["x-deltasan-voice"]!=="1" || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)))return res.status(403).end()
        const endpoint=process.env["DELTA_CUSTOMER_SERVICE"], token=process.env["PUBLISH_BEARER_TOKEN"]
        if(!endpoint||!token)return res.status(503).end()
        const chunks:Buffer[]=[]
        let size=0
        for await(const part of req){size+=part.length;if(size>65536)return res.status(413).end();chunks.push(Buffer.from(part))}
        try{
            const r=await fetch(new URL("/operator/realtime",endpoint),{method:req.method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/sdp"},body:req.method==="POST"?new Uint8Array(Buffer.concat(chunks)):undefined,signal:AbortSignal.timeout(20000)})
            return res.status(r.status).setHeader("Content-Type",r.headers.get("Content-Type")??"application/json").send(await r.text())
        }catch{return res.status(503).json({enabled:false})}
    }
    if (req.method !== "POST" || !["speak", "transcribe"].includes(String(action))) return res.status(405).end()
    if (typeof lang !== "string" || !(action === "transcribe" ? ["auto","en","hi","te"] : ["en","hi","te"]).includes(lang)) return res.status(400).end()
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).end()
    // Require a same-origin JS request even when a browser omits Origin.
    if (req.headers["x-deltasan-voice"] !== "1") return res.status(403).end()
    const endpoint = process.env["DELTA_VOICE_URL"]
    if (!endpoint) return res.status(503).json({error: "Live voice is unavailable on this server."})
    const limit = action === "speak" ? 12000 : 1000000
    const chunks: Buffer[] = []
    let size = 0
    try {
        for await (const chunk of req) {
            size += chunk.length
            if (size > limit) return res.status(413).end()
            chunks.push(Buffer.from(chunk))
        }
        if (!size) return res.status(400).end()
        const upstream = await fetch(new URL(`/${action}/${lang}`, endpoint), {
            method: "POST", body: new Uint8Array(Buffer.concat(chunks)), signal: AbortSignal.timeout(20000),
        })
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream")
        res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()))
    } catch {
        res.status(503).json({error: "The local speech worker could not complete this turn."})
    }
}
