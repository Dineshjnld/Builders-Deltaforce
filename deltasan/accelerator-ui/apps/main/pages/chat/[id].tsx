// Copyright (c) 2026 DeltaForce. Licensed under the Apache License, Version 2.0.
import Head from "next/head"
import {useRouter} from "next/router"
import {FormEvent, useCallback, useEffect, useRef, useState} from "react"
import ReactMarkdown from "react-markdown"
import {LiveVoice} from "../../../../packages/ui-common/components/AgentChat/VoiceChat/LiveVoice"
import {activeTurn, type CustomerTurn, followTurn} from "../../components/customerConversation"
import styles from "../../components/CustomerChat.module.css"

type Theme = "library" | "health" | "civic" | "general" | "agriculture" | "education"
type Deployment = {
    name: string
    organization: string
    agents: string[]
    description?: string
    review: boolean
    theme?: Theme
    realtime?: boolean
}
const sectors: Record<Theme, string> = {
    library: "Library services",
    health: "Healthcare services",
    civic: "Citizen services",
    general: "Service desk",
    agriculture: "Agriculture services",
    education: "Education services",
}

function Wave({small = false}: {small?: boolean}) {
    return (
        <span
            aria-hidden="true"
            className={small ? styles["smallWave"] : styles["wave"]}
        >
            {[0, 1, 2, 3, 4].map((i) => (
                <i key={i} />
            ))}
        </span>
    )
}

function Chat({id}: {id: string}) {
    const api = "/api/customer/" + encodeURIComponent(id)
    const [info, setInfo] = useState<Deployment>()
    const [turns, setTurns] = useState<CustomerTurn[]>([])
    const [draft, write] = useState("")
    const [review, setReview] = useState(false)
    const [error, report] = useState("")
    const [busy, setBusy] = useState(false)
    const [ready, setReady] = useState(false)
    const lock = useRef(false)
    const token = useRef("")
    const session = useRef<AbortController | null>(null)
    const history = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLTextAreaElement>(null)
    const stickToEnd = useRef(true)
    const waiting = turns.some(activeTurn)
    const theme = info?.theme && Object.hasOwn(sectors, info.theme) ? info.theme : "general"
    const name = info?.name.replaceAll("_", " ") || "Service desk"
    const update = useCallback((turn: CustomerTurn) => {
        setTurns((rows) =>
            rows.some((row) => row.id === turn.id)
                ? rows.map((row) => (row.id === turn.id ? {...row, ...turn} : row))
                : [...rows, turn]
        )
    }, [])
    useEffect(() => {
        const abort = new AbortController()
        session.current = abort
        async function open() {
            const r = await fetch(api, {signal: abort.signal})
            if (!r.ok) throw Error("This network is unavailable.")
            setInfo(await r.json())
            const key = "delta-chat/" + id
            let saved: string | null = null
            try {
                saved = sessionStorage.getItem(key)
            } catch {
                /* Embedded storage may be disabled. */
            }
            if (saved) {
                const response = await fetch(api + "/turns", {
                    headers: {Authorization: "Bearer " + saved},
                    signal: abort.signal,
                    cache: "no-store",
                })
                if (response.ok) {
                    token.current = saved
                    const rows: CustomerTurn[] = await response.json()
                    setTurns(rows)
                    setReady(true)
                    const current = rows.find(activeTurn)
                    if (current) await followTurn(api, saved, current.id, abort.signal, update)
                    return
                }
                if (response.status !== 401) throw Error("Unable to reconnect. Refresh to try again.")
            }
            const response = await fetch(api + "/sessions", {method: "POST", signal: abort.signal})
            if (!response.ok) throw Error("Could not start a conversation. Refresh to try again.")
            token.current = (await response.json()).token
            try {
                sessionStorage.setItem(key, token.current)
            } catch {
                /* The current page keeps its session in memory. */
            }
            setReady(true)
        }
        open().catch((cause) => {
            if (!abort.signal.aborted) report(cause.message)
        })
        return () => abort.abort()
    }, [api, id, update])
    useEffect(() => {
        if (stickToEnd.current && history.current) history.current.scrollTop = history.current.scrollHeight
    }, [turns])
    async function send(message: string, language = "") {
        const signal = session.current?.signal
        if (!signal || lock.current || waiting || !ready || !message.trim()) return ""
        const turnId = crypto.randomUUID()
        const pending = review || !!info?.review
        lock.current = true
        setBusy(true)
        report("")
        stickToEnd.current = true
        update({id: turnId, message, state: pending ? "pending" : "running"})
        try {
            const response = await fetch(api + "/turns", {
                method: "POST",
                signal,
                headers: {
                    Authorization: "Bearer " + token.current,
                    "Content-Type": "application/json",
                    Prefer: "respond-async",
                },
                body: JSON.stringify({id: turnId, message, language, review}),
            })
            if (!response.ok) throw Error((await response.json()).detail || "Message could not be sent.")
            const accepted = await response.json()
            setReview(false)
            const result = followTurn(api, token.current, turnId, signal, update)
            if (accepted.state === "pending") {
                void result.catch((cause) => {
                    if (!signal.aborted) report(cause.message)
                })
                return "Your request is waiting for a human reviewer."
            }
            return (await result).answer || ""
        } catch (cause) {
            if (!signal.aborted) {
                report(cause instanceof Error ? cause.message : "Message could not be sent.")
                // A failed response may follow a successful write. Recover that turn before allowing another.
                try {
                    const r = await fetch(api + "/turns", {
                        headers: {Authorization: "Bearer " + token.current},
                        signal,
                        cache: "no-store",
                    })
                    if (!r.ok) throw Error()
                    const rows: CustomerTurn[] = await r.json()
                    setTurns(rows)
                    const current = rows.find(activeTurn)
                    if (current) return (await followTurn(api, token.current, current.id, signal, update)).answer || ""
                    if (!rows.some((row) => row.id === turnId)) write((value) => value || message)
                } catch {
                    if (!signal.aborted) report("Conversation disconnected. Refresh to reconnect.")
                }
            }
            return ""
        } finally {
            lock.current = false
            if (!signal.aborted) setBusy(false)
        }
    }
    function submit(e: FormEvent) {
        e.preventDefault()
        if (ready && !waiting && !busy && draft.trim()) {
            void send(draft.trim())
            write("")
        }
    }
    return (
        <main
            className={styles["page"]}
            data-theme={theme}
        >
            <Head>
                <title>{name} · DeltaForce</title>
            </Head>
            <header className={styles["masthead"]}>
                <div className={styles["brand"]}>
                    <img
                        src="/deltaforce-logo.svg"
                        alt="DeltaForce"
                    />
                    <span>Agent services</span>
                </div>
                <span className={styles["org"]}>{info?.organization}</span>
            </header>
            <div className={styles["workspace"]}>
                <aside className={styles["intro"]}>
                    <div className={styles["introContent"]}>
                        <span className={styles["sector"]}>
                            <i />
                            {sectors[theme]}
                        </span>
                        <h1>{name}</h1>
                        {info?.description && <p>{info.description.replace(/[.!?]?$/, ".")}</p>}
                    </div>
                    <div className={styles["introFooter"]}>
                        <span
                            className={styles["networkMark"]}
                            aria-hidden="true"
                        >
                            ❖
                        </span>{" "}
                        {info?.organization || "DeltaForce"}
                    </div>
                </aside>
                <article
                    className={styles["chat"]}
                    aria-label="Live conversation"
                >
                    <header className={styles["chatHeader"]}>
                        <div className={styles["chatTitle"]}>
                            <Wave small />
                            <h2>Conversation</h2>
                        </div>
                        <span
                            className={styles["connection"]}
                            data-ready={ready}
                        >
                            <i />
                            {ready ? "Connected" : error ? "Unavailable" : "Connecting"}
                        </span>
                    </header>
                    <div
                        className={styles["history"]}
                        role="log"
                        aria-label="Conversation history"
                        ref={history}
                        onScroll={(e) => {
                            const el = e.currentTarget
                            stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                        }}
                    >
                        {!turns.length && (
                            <div className={styles["welcome"]}>
                                <Wave />
                                <h3>How can I help?</h3>
                                <p>Type your question below or start a voice conversation with {name}.</p>
                            </div>
                        )}
                        {turns.map((turn) => (
                            <section
                                className={styles["turn"]}
                                key={turn.id}
                            >
                                <div className={styles["userLine"]}>
                                    <span>You</span>
                                    <p>{turn.message}</p>
                                </div>
                                <div className={styles["assistantLine"]}>
                                    <span>
                                        <Wave small />
                                        {name}
                                    </span>
                                    {turn.answer ? (
                                        <div className={styles["answer"]}>
                                            <ReactMarkdown
                                                components={{
                                                    a: ({href, children}) => (
                                                        <a
                                                            href={href}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                        >
                                                            {children}
                                                        </a>
                                                    ),
                                                }}
                                            >
                                                {turn.answer}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p
                                            role="status"
                                            className={styles["activity"]}
                                        >
                                            {turn.activity ||
                                                (turn.state === "pending"
                                                    ? "Waiting for human approval…"
                                                    : "The network is working…")}
                                        </p>
                                    )}
                                </div>
                            </section>
                        ))}
                    </div>
                    {error && (
                        <p
                            role="alert"
                            className={styles["error"]}
                        >
                            {error}
                        </p>
                    )}
                    <form
                        className={styles["composer"]}
                        onSubmit={submit}
                    >
                        <textarea
                            ref={input}
                            aria-label="Message"
                            placeholder="Write a message…"
                            maxLength={4000}
                            value={draft}
                            onChange={(e) => write(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault()
                                    e.currentTarget.form?.requestSubmit()
                                }
                            }}
                        />
                        <div className={styles["controls"]}>
                            <div className={styles["voiceControls"]}>
                                <LiveVoice
                                    network={name}
                                    busy={!ready || busy || waiting}
                                    send={send}
                                    realtime={{
                                        endpoint: api + "/voice",
                                        token: token.current,
                                        enabled: !!info?.realtime,
                                    }}
                                    onDictation={(s) => {
                                        write((value) => [value, s].filter(Boolean).join(" "))
                                        input.current?.focus()
                                    }}
                                />
                            </div>
                            <button
                                className={styles["send"]}
                                type="submit"
                                aria-label="Send"
                                disabled={!ready || busy || waiting || !draft.trim()}
                            >
                                Send <span aria-hidden="true">↗</span>
                            </button>
                        </div>
                    </form>
                    <footer className={styles["chatFooter"]}>
                        <label>
                            <input
                                type="checkbox"
                                checked={!!info?.review || review}
                                disabled={!!info?.review || busy || waiting}
                                onChange={(e) => setReview(e.target.checked)}
                            />{" "}
                            Human approval
                        </label>
                        {!!info?.agents.length && (
                            <details className={styles["team"]}>
                                <summary>
                                    {info.agents.length} {info.agents.length === 1 ? "agent" : "agents"}{" "}
                                    <span aria-hidden="true">⌃</span>
                                </summary>
                                <div>
                                    <strong>Network team</strong>
                                    <ul>
                                        {info.agents.map((agent) => (
                                            <li key={agent}>
                                                {agent.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replaceAll("_", " ")}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </details>
                        )}
                    </footer>
                </article>
            </div>
        </main>
    )
}
export default function CustomerPage() {
    const {query} = useRouter()
    return typeof query["id"] === "string" ? (
        <Chat
            key={query["id"]}
            id={query["id"]}
        />
    ) : null
}
