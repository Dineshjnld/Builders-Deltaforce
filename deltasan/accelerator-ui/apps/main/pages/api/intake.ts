import type {NextApiRequest, NextApiResponse} from "next"
export default function retired(_req:NextApiRequest,res:NextApiResponse){return res.status(410).json({error:"Use the Agent Studio network builder."})}
