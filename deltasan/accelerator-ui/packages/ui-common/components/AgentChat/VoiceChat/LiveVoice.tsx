import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import {useEffect, useId, useRef, useState} from "react"
import ReactMarkdown from "react-markdown"
import {startRealtime,type RealtimeAccess} from "./realtime"
import styles from "./LiveVoice.module.css"

const languages = {te: "తెలుగు · Telugu", hi: "हिन्दी · Hindi", en: "English"} as const
type Language = keyof typeof languages
const names = {te: "Telugu", hi: "Hindi", en: "English"}
type Props = {
    network: string
    busy: boolean
    realtime?: RealtimeAccess
    send: (text: string, language: string) => Promise<string>
    onDictation: (text: string) => void
}

function wav(samples: Float32Array, rate: number) {
    const data = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(data)
    const label = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    label(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); label(8, "WAVE"); label(12, "fmt ")
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true)
    view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, samples.length * 2, true)
    samples.forEach((sample, i) => view.setInt16(44 + 2 * i, Math.max(-1, Math.min(1, sample)) * 32767, true))
    return data
}

export function LiveVoice({network, busy, send, onDictation, realtime}: Props) {
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(false)
    const [detected, setDetected] = useState<Language | null>(null)
    const [status, setStatus] = useState("")
    const [heard, setHeard] = useState("")
    const [reply, setReply] = useState("")
    const [dictating, setDictating] = useState(false)
    const [localSpeech, setLocalSpeech] = useState(false)
    const [muted, setMuted] = useState(false)
    const titleId = useId()
    const orb = useRef<HTMLDivElement>(null)
    const microphone = useRef<MediaStream | null>(null)
    const mutedRef = useRef(false)
    const session = useRef<AbortController | null>(null)
    const latestSend = useRef(send)
    latestSend.current = send
    useEffect(() => () => session.current?.abort(), [])
    function close() {
        session.current?.abort()
        setActive(false)
        setOpen(false)
    }
    function openVoice(dictate: boolean) {
        setDictating(dictate)
        setHeard("")
        setReply("")
        setStatus("")
        setDetected(null)
        setMuted(false)
        mutedRef.current = false
        setOpen(true)
    }
    function toggleMute() {
        mutedRef.current = !mutedRef.current
        microphone.current?.getAudioTracks().forEach(track => { track.enabled = !mutedRef.current })
        setMuted(mutedRef.current)
    }
    async function start(dictate: boolean) {
        if (session.current || busy) return
        const controller = new AbortController()
        session.current = controller
        const {signal} = controller
        let meter: AudioContext | undefined
        let frame = 0
        const meters: AnalyserNode[] = []
        const samples = new Uint8Array(256)
        const animate = () => {
            let peak = 0
            for (const analyser of meters) {
                analyser.getByteTimeDomainData(samples)
                for (const value of samples) peak = Math.max(peak, Math.abs(value - 128) / 128)
            }
            orb.current?.style.setProperty("--voice-scale", String(1 + Math.min(0.22, peak * 0.45)))
            frame = requestAnimationFrame(animate)
        }
        const watchAudio = (media: MediaStream, input: boolean) => {
            if (signal.aborted) return
            if (input) {
                microphone.current = media
                media.getAudioTracks().forEach(track => { track.enabled = !mutedRef.current })
            }
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
            try {
                meter ??= new AudioContext()
                void meter.resume().catch((): void => {})
                const node = meter.createAnalyser()
                node.fftSize = samples.length
                meter.createMediaStreamSource(media).connect(node)
                meters.push(node)
                if (!frame) animate()
            } catch { /* Speech can continue without audio visualization. */ }
        }
        const synth = window.speechSynthesis
        let ctx: AudioContext | undefined
        let stream: MediaStream | undefined
        let output: AudioBufferSourceNode | undefined
        let generation = 0
        const cancelPlayback = () => {
            generation++
            if (synth?.speaking) synth.cancel()
            output?.stop()
            output = undefined
        }
        signal.addEventListener("abort", () => {
            cancelPlayback()
            stream?.getTracks().forEach(track => track.stop())
            if (ctx && ctx.state !== "closed") void ctx.close()
            if (frame) cancelAnimationFrame(frame)
            if (meter && meter.state !== "closed") void meter.close()
            microphone.current = null
            session.current = null
        }, {once: true})
        setActive(true)
        setStatus("Opening microphone…")
        async function request(action: string, body: BodyInit, lang: Language | "auto" = "auto") {
            const r = await fetch(`/api/voice/${action}?lang=${lang}`, {
                method: "POST", headers: {"x-deltasan-voice": "1"}, body, signal,
            })
            if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "Speech service is unavailable.")
            return r
        }
        try {
            const endpoint = realtime?.endpoint ?? "/api/voice/realtime"
            const enabled = !localSpeech && (realtime ? realtime.enabled : await fetch(endpoint,{signal}).then(async r=>r.ok && (await r.json() as {enabled?:boolean}).enabled===true).catch(()=>false))
            if(enabled){
                try{
                    await startRealtime({endpoint,enabled,token:realtime?.token},signal,{
                        status:setStatus,heard:text=>{
                            setHeard(text)
                            setDetected(/[ఀ-౿]/.test(text) ? "te" : /[ऀ-ॿ]/.test(text) ? "hi" : null)
                        },reply:setReply,send:(text,language)=>latestSend.current(text,language),
                        inputStream:media=>watchAudio(media,true),outputStream:media=>watchAudio(media,false),
                        dictate:dictate ? text=>{onDictation(text);close()} : undefined
                    })
                    return
                }catch{
                    if(signal.aborted)return
                    setStatus("Connecting local voice…")
                }
            }
            if(signal.aborted)return
            stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, channelCount: 1}})
            if (signal.aborted) { stream.getTracks().forEach(t => t.stop()); return }
            watchAudio(stream,true)
            const audio = new AudioContext({sampleRate: 16000})
            ctx = audio
            await audio.resume()
            await audio.audioWorklet.addModule("/voice-capture.js")
            if (signal.aborted) return
            const capture = new AudioWorkletNode(audio, "delta-voice-capture")
            audio.createMediaStreamSource(stream).connect(capture)
            capture.connect(audio.destination) // The worklet outputs silence.
            synth?.getVoices()
            setStatus("Listening")
            capture.port.onmessage = async ({data}) => {
                if (signal.aborted) return
                if (data.type === "start") {
                    cancelPlayback()
                    setStatus("Hearing you…")
                    return
                }
                const turn = generation
                const current = () => !signal.aborted && generation === turn
                try {
                    setStatus("Transcribing…")
                    const response = await request("transcribe", wav(data.pcm, audio.sampleRate))
                    const {transcript, language: lang}: {transcript: string; language: Language} = await response.json()
                    if (!current()) return
                    setDetected(lang)
                    if (!transcript?.trim()) { setStatus("No words detected. Listening."); return }
                    if (dictate) {
                        onDictation(transcript)
                        close()
                        return
                    }
                    setHeard(transcript)
                    setReply("")
                    setStatus("Waiting for the network…")
                    const answer = await latestSend.current(transcript, names[lang])
                    if (!current()) return
                    setReply(answer)
                    capture.port.postMessage("listen")
                    const text = answer.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*#`]/g, "").trim()
                    if (!text) { setStatus("No spoken reply. Check the chat for details."); return }
                    const voice = synth?.getVoices().find(v => v.localService && v.lang.split(/[-_]/)[0] === lang)
                    const done = () => { if (current()) setStatus("Listening") }
                    if (voice) {
                        const line = new SpeechSynthesisUtterance(text)
                        line.voice = voice; line.lang = voice.lang; line.onend = done
                        line.onerror = () => { if (current()) setStatus("Playback failed. Your reply is shown below.") }
                        synth.speak(line)
                    } else {
                        const spoken = await request("speak", text.slice(0, 3500), lang)
                        const buffer = await audio.decodeAudioData(await spoken.arrayBuffer())
                        if (!current()) return
                        output = audio.createBufferSource()
                        output.buffer = buffer; output.connect(audio.destination); output.onended = done; output.start()
                    }
                    setStatus("Speaking · interrupt with your voice")
                } catch (error) {
                    if (current()) setStatus(error instanceof Error ? error.message : "Voice turn failed.")
                } finally {
                    if (current()) capture.port.postMessage("listen")
                }
            }
        } catch (error) {
            if (signal.aborted) return
            controller.abort()
            setActive(false)
            setStatus(error instanceof Error ? error.message : "Microphone unavailable.")
        }
    }
    const phase = !active ? "idle" : muted ? "muted" : /Speaking/.test(status) ? "speaking" :
        /Waiting|Transcribing|Opening|Connecting/.test(status) ? "working" : "listening"
    return <>
        <Button size="small" disabled={busy} onClick={() => openVoice(false)}>Start voice</Button>
        <Button size="small" disabled={busy} onClick={() => openVoice(true)}>Dictate</Button>
        <Dialog open={open} onClose={close} fullWidth maxWidth="xs" aria-labelledby={titleId}
            slotProps={{paper:{className:styles["paper"]}}}>
            <section className={styles["panel"]} data-phase={phase}>
                <header className={styles["header"]}>
                    <div><p>{network}</p><h2 id={titleId}>{dictating ? "Voice dictation" : "Live voice"}</h2></div>
                    <button type="button" className={styles["close"]} onClick={close} aria-label="Close voice">×</button>
                </header>
                <div className={styles["stage"]} aria-hidden="true">
                    <div className={styles["orb"]} ref={orb}><i/><i/><i/></div>
                </div>
                <p role="status" className={styles["status"]}>{muted && active ? "Microphone muted" : status || (dictating ? "Dictate an editable message" : "Ready when you are")}</p>
                <p className={styles["languages"]}>{detected ? languages[detected] : "English · हिन्दी · తెలుగు"}</p>
                {active && (heard || reply) && <div className={styles["transcript"]} aria-label="Current exchange">
                    {heard && <p><strong>You</strong>{heard}</p>}
                    {reply && <div className={styles["answer"]}><strong>{network}</strong>
                        <ReactMarkdown skipHtml unwrapDisallowed allowedElements={["p","strong","em","code","ul","ol","li","br"]}>{reply}</ReactMarkdown>
                    </div>}
                </div>}
                {!active && <div className={styles["privacy"]}>
                    <label><input type="checkbox" checked={localSpeech || realtime?.enabled === false} disabled={realtime?.enabled === false} onChange={e=>setLocalSpeech(e.target.checked)}/> Use local speech processing</label>
                    <p>{localSpeech || realtime?.enabled === false ? "DeltaSAN processes audio on its speech server." : "Live audio goes to OpenAI for speech processing."} Keep personal identifiers out of recordings.</p>
                </div>}
                <footer className={styles["controls"]}>
                    {active ? <>
                        <button type="button" aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
                        <button type="button" className={styles["end"]} onClick={close}>End session</button>
                    </> : <button type="button" className={styles["start"]} disabled={busy} onClick={()=>void start(dictating)}>Start microphone</button>}
                </footer>
            </section>
        </Dialog>
    </>
}
