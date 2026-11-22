// Copyright (c) 2026 DeltaForce. Licensed under the Apache License, Version 2.0.
import {render, screen} from "@testing-library/react"
import {userEvent} from "@testing-library/user-event"
import {afterEach, describe, expect, it, vi} from "vitest"
import {withStrictMocks} from "../../../../__tests__/common/strictMocks"
import CustomerPage from "../../pages/chat/[id]"

vi.mock("next/router", () => ({useRouter: () => ({query: {id: "library"}})}))
vi.mock("../../../../packages/ui-common/components/AgentChat/VoiceChat/LiveVoice", () => ({
    LiveVoice: ({onDictation}: {onDictation: (text: string) => void}) => (
        <button
            type="button"
            onClick={() => onDictation("Renew a book")}
        >
            Dictate
        </button>
    ),
}))

describe("Customer service desk", () => {
    withStrictMocks()
    afterEach(() => vi.unstubAllGlobals())

    it("keeps dictated text editable and waits for the reviewed network answer", async () => {
        let sent: {id: string; message: string; review: boolean} | undefined
        let controller: ReadableStreamDefaultController | undefined
        const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
            if (path.endsWith("/sessions")) return Response.json({token: "visitor"})
            if (path.endsWith("/turns")) {
                expect(new Headers(options?.headers).get("Prefer")).toBe("respond-async")
                sent = JSON.parse(String(options?.body))
                return Response.json({state: "pending"})
            }
            if (path.includes("/events?")) {
                expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer visitor")
                return new Response(
                    new ReadableStream({
                        start(c) {
                            controller = c
                        },
                    }),
                    {
                        headers: {"Content-Type": "text/event-stream"},
                    }
                )
            }
            return Response.json({
                name: "Library Desk",
                organization: "City Library",
                agents: ["Librarian"],
                theme: "library",
                review: false,
            })
        })
        vi.stubGlobal("fetch", fetcher)
        const user = userEvent.setup()
        render(<CustomerPage />)
        await screen.findByRole("heading", {name: "Library Desk"})
        await screen.findByText("Connected", {exact: true})
        await user.click(screen.getByRole("button", {name: "Dictate"}))
        const box = screen.getByRole("textbox", {name: "Message"})
        expect(box).toHaveValue("Renew a book")
        await user.type(box, " online")
        await user.click(screen.getByRole("checkbox", {name: "Human approval"}))
        await user.click(box)
        await user.keyboard("{Enter}")
        await screen.findByText("Waiting for human approval…")
        expect(sent).toMatchObject({message: "Renew a book online", review: true})
        controller?.enqueue(
            new TextEncoder().encode(
                "data: " + JSON.stringify({...sent, state: "answered", answer: "Use the catalogue."}) + "\n\n"
            )
        )
        controller?.close()
        await screen.findByText("Use the catalogue.")
    })
})
