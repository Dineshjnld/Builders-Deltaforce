// Run against a local DeltaSAN network. Exit 1 on an API, timeout or output assertion failure.
import {performance} from "node:perf_hooks"
const [network, prompt, expected] = process.argv.slice(2)
if (!network || !prompt || !expected) {
    console.error('Usage: node scripts/run-harness.mjs NETWORK "sample input" "expected text"')
    process.exit(2)
}
const base = process.env.DELTASAN_URL || "http://127.0.0.1:45174"
const started = performance.now()
try {
    const path = network.split("/").map(encodeURIComponent).join("/")
    const route = base + "/api/v1/" + path
    const graph = await fetch(route + "/connectivity",{signal:AbortSignal.timeout(10000)})
    if (!graph.ok) throw Error("Connectivity check failed: " + graph.status)
    const topology=await graph.json()
    if (!Object.keys(topology).length) throw Error("Runtime returned an empty graph")
    const run = await fetch(route + "/streaming_chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({user_message:{type:"HUMAN",text:prompt},chat_filter:{chat_filter_type:"MAXIMAL"}}),
        signal:AbortSignal.timeout(135000)
    })
    if (!run.ok) throw Error("Chat failed: " + run.status)
    const frames=(await run.text()).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line).response).filter(Boolean)
    const answer=frames.filter(f=>f.type==="AGENT_FRAMEWORK" && f.text).at(-1)?.text || ""
    if (!answer.toLowerCase().includes(expected.toLowerCase())) throw Error("Expected text missing from the final answer: "+answer.slice(0,300))
    console.log(JSON.stringify({network,passed:true,frames:frames.length,elapsedMs:Math.round(performance.now()-started),answer},null,2))
} catch(error) { console.error(JSON.stringify({network,passed:false,error:error.message}));process.exitCode=1 }

