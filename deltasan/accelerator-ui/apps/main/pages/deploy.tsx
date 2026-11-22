import {useEffect, useState} from "react"
import {useEnvironmentStore} from "../../../packages/ui-common/state/Environment"
import {useSettingsStore} from "../../../packages/ui-common/state/Settings"
import {isPublishNameTaken, publishNetwork} from "../../../packages/ui-common/controller/publish/Publish"
import styles from "../components/Deployments.module.css"

const views = {deploy: "New deployment", map: "Map", networks: "Network list", directory: "Manage deployments"}
type View = keyof typeof views
const defaultServer = "https://agentic-city.decisionai.ml"

function cityAddress(server: string, view: View) {
    try {
        const url = new URL(server)
        if (typeof window !== "undefined" && window.location.protocol === "https:" && url.hostname === "127.0.0.1")
            return new URL("/city/app/#" + view, window.location.origin).href
        if (url.username || url.password || (url.protocol !== "https:" &&
            !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return ""
        if (typeof window !== "undefined" && url.origin === window.location.origin) return ""
        return new URL("app/#" + view, url.href.replace(/\/?$/, "/")).href
    } catch { return "" }
}

export default function Deployments() {
    const publishing = useSettingsStore(s => s.settings.publish)
    const configuredServer = useEnvironmentStore(s => s.publishServerUrl)
    const enabled = useEnvironmentStore(s => s.enablePublishing)
    const updateSettings = useSettingsStore(s => s.updateSettings)
    const server = publishing.serverUrl || configuredServer || defaultServer
    const [view, setView] = useState<View>("deploy")
    const [sources, setSources] = useState<string[]>([])
    const [selected, select] = useState("")
    const [status, setStatus] = useState("")
    const [working, setWorking] = useState(false)
    const cityUrl = cityAddress(server, view)
    const city = cityUrl && server.startsWith("http://127.0.0.1:") && publishing.orgName
        ? cityUrl.replace("/app/#", "/app/?org=" + encodeURIComponent(publishing.orgName) + "#") : cityUrl
    const canPublish = enabled && server.replace(/\/$/, "") === configuredServer?.replace(/\/$/, "")
    const download = "/api/studio?format=hocon&id=" + encodeURIComponent(selected)

    useEffect(() => {
        const controller = new AbortController()
        fetch("/api/v1/list", {signal: controller.signal}).then(async r => {
            if (!r.ok) throw Error("Could not load the local network registry.")
            const body = await r.json()
            const names: string[] = body.agents.map((a: {agent_name: string}) => a.agent_name)
                .filter((id: string) => /^deltaforce\/[a-z0-9_]+_[a-f0-9]{12}$/.test(id)).sort()
            setSources(names)
            const requested = new URLSearchParams(window.location.search).get("network")
            select(names.includes(requested || "") ? requested! : names[0] || "")
        }).catch(e => {if (!controller.signal.aborted) setStatus(e.message)})
        const onHash = () => {
            const hash = window.location.hash.slice(1)
            setView(Object.hasOwn(views, hash) ? hash as View : "deploy")
        }
        onHash()
        window.addEventListener("hashchange", onHash)
        return () => {controller.abort(); window.removeEventListener("hashchange", onHash)}
    }, [])

    async function publish() {
        if (!selected || !publishing.orgName || working) return
        setWorking(true)
        try {
            const networkName = selected.split("/")[1]
            if (await isPublishNameTaken(server, publishing.orgName, networkName)) {
                throw Error("This organization already has a deployment with that name. Open Manage deployments to inspect it.")
            }
            const response = await fetch(download)
            if (!response.ok) throw Error("The saved network could not be exported.")
            setStatus("Uploading the network…")
            const result = await publishNetwork({serverUrl: server, orgName: publishing.orgName,
                networkName, hocon: await response.text(), onAccepted: () => setStatus("Deployment accepted. Waiting for the server…")})
            setStatus("Deployment ready: " + result.url)
            window.location.hash = "networks"
        } catch (e) { setStatus(e instanceof Error ? e.message : "Deployment failed.") }
        finally { setWorking(false) }
    }

    return <main className={styles.page}>
        <header><div><h1>Deployments</h1><span>{server}</span></div>
            <a href="/multiAgentAccelerator?network=agent_network_designer">Design a network</a></header>
        <nav aria-label="Deployment views">{Object.entries(views).map(([key, label]) =>
            <a key={key} href={"#" + key} aria-current={view === key ? "page" : undefined}>{label}</a>)}</nav>
        {view === "deploy" && <section className={styles.transfer}>
            <label>Studio network<select value={selected} disabled={working || !sources.length}
                onChange={e => {select(e.target.value); setStatus("")}}>
                {!sources.length && <option value="">No saved Studio networks</option>}
                {sources.map(id => <option key={id} value={id}>{id.slice(11)}</option>)}
            </select></label>
            {selected && <a href={download} download>Download HOCON</a>}
            {canPublish && <label>Organization<input value={publishing.orgName || ""} maxLength={40} placeholder="Organization name"
                onChange={e => updateSettings({publish: {...publishing, orgName: e.target.value}})}/></label>}
            {canPublish && <button disabled={!selected || !publishing.orgName?.trim() || working} onClick={publish}>
                {working ? "Deploying…" : "Publish to " + (publishing.orgName || "organization")}
            </button>}
            <small>{canPublish ? "Publishing creates a runnable copy and adds it to the deployment map." :
                "Download a Studio network, then upload its HOCON in the deployment console below."}</small>
        </section>}
        {status && <p role="status">{status}</p>}
        {city ? <>
            <div className={styles.frameTitle}><strong>{views[view]}</strong>
                <a href={city} target="_blank" rel="noreferrer">Open console in new tab ↗</a></div>
            <iframe title="Agentic City deployment console" src={city} referrerPolicy="no-referrer"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"/>
        </> : <p>Enter an HTTPS publishing server or a localhost server in Settings → External Services.</p>}
    </main>
}
