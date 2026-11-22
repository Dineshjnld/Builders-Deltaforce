import type {NextApiRequest, NextApiResponse} from "next"

export default async function reviews(req: NextApiRequest, res: NextApiResponse) {
    if (!["GET","POST"].includes(req.method || "")) return res.status(405).end()
    if (req.method === "POST" && (req.headers["x-delta-review"] !== "1" ||
        (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))) return res.status(403).end()
    const token = process.env["PUBLISH_BEARER_TOKEN"]
    const endpoint = process.env["DELTA_CUSTOMER_SERVICE"]
    if (!token || !endpoint) return res.status(503).json({error:"Review service is unavailable."})
    res.setHeader("Cache-Control","no-store")
    try {
        const r = await fetch(new URL("/operator/reviews", endpoint), {
            method:req.method, headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
            body:req.method==="POST" ? JSON.stringify(req.body) : undefined, signal:AbortSignal.timeout(155000),
        })
        return res.status(r.status).json(await r.json())
    } catch { return res.status(503).json({error:"Could not reach the review service."}) }
}
