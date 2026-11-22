// Copyright (c) 2026 DeltaForce. Licensed under the Apache License, Version 2.0.
export type CustomerTurn = {
    id: string
    message: string
    state: string
    answer?: string
    activity?: string
}

export function activeTurn(turn: CustomerTurn): boolean {
    return turn.state === "running" || turn.state === "pending"
}

export async function readUpdates(
    stream: ReadableStream<Uint8Array>,
    turnId: string,
    update: (turn: CustomerTurn) => void,
): Promise<CustomerTurn | undefined> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    try {
        for (;;) {
            const part = await reader.read()
            if (part.done) return undefined
            pending += decoder.decode(part.value, {stream: true})
            const blocks = pending.replaceAll("\r\n", "\n").split("\n\n")
            pending = blocks.pop() || ""
            for (const block of blocks) {
                const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5)).join("\n")
                if (!data.trim()) continue
                const turn: CustomerTurn = JSON.parse(data)
                if (turn.id !== turnId || typeof turn.state !== "string") continue
                update(turn)
                if (!activeTurn(turn)) return turn
            }
        }
    } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
}

/** Resume using authenticated history if a browser or reverse proxy disconnects the event stream. */
export async function followTurn(
    api: string, token: string, turnId: string, signal: AbortSignal, update: (turn: CustomerTurn) => void,
): Promise<CustomerTurn> {
    const headers = {Authorization: "Bearer " + token}
    try {
        const response = await fetch(api + "/events?turn=" + encodeURIComponent(turnId), {
            headers: {...headers, Accept: "text/event-stream"}, signal, cache: "no-store",
        })
        if (response.ok && response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
            const final = await readUpdates(response.body, turnId, update)
            if (final) return final
        }
    } catch {
        signal.throwIfAborted()
    }
    for (;;) {
        signal.throwIfAborted()
        const response = await fetch(api + "/turns", {headers, signal, cache: "no-store"})
        if (!response.ok) throw Error("Conversation disconnected. Refresh to reconnect.")
        const rows: CustomerTurn[] = await response.json()
        const turn = rows.find(item => item.id === turnId)
        if (turn) {
            update(turn)
            if (!activeTurn(turn)) return turn
        }
        await new Promise(resolve => setTimeout(resolve, 1400))
    }
}
