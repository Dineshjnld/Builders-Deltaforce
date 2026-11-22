// Copyright (c) 2026 DeltaForce. Licensed under the Apache License, Version 2.0.
import {describe, expect, it, vi} from "vitest"
import {withStrictMocks} from "../../../../__tests__/common/strictMocks"
import {activeTurn, followTurn, readUpdates, type CustomerTurn} from "../../components/customerConversation"

function streamedText(value: string) {
    const bytes = new TextEncoder().encode(value)
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
            controller.close()
        },
    })
}

describe("Customer conversation updates", () => {
    withStrictMocks()
    it("displays activity and the final answer for this turn in stream order", async () => {
        const running = {id:"a",message:"Hello",state:"running",activity:"Checking the service directory"}
        const final = {...running,state:"answered",answer:"నమస్కారం"}
        const rows = [{...running,id:"another"},running,final]
        const stream = streamedText(": keepalive\r\n\r\n" + rows.map(row=>"data: "+JSON.stringify(row)+"\r\n\r\n").join(""))
        const update = vi.fn<(turn: CustomerTurn) => void>()
        await expect(readUpdates(stream,"a",update)).resolves.toEqual(final)
        expect(update.mock.calls.map(([turn])=>turn)).toEqual([running,final])
    })
    it("recovers the answer from session history when a proxy drops the stream", async () => {
        const final = {id:"a",message:"Hello",state:"answered",answer:"Welcome"}
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null,{status:502}))
            .mockResolvedValueOnce(Response.json([final]))
        vi.stubGlobal("fetch",fetchMock)
        await expect(followTurn("/api/customer/library","session","a",new AbortController().signal,vi.fn())).resolves.toEqual(final)
        expect(fetchMock).toHaveBeenLastCalledWith("/api/customer/library/turns",expect.objectContaining({
            headers:{Authorization:"Bearer session"},
        }))
        vi.unstubAllGlobals()
    })
    it.each([["pending",true],["running",true],["answered",false],["declined",false],["failed",false]])(
        "recognizes the %s turn state", (state, active) => {
            expect(activeTurn({id:"a",message:"Hello",state:String(state)})).toBe(active)
        })
})
