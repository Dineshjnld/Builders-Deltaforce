// Buffer a short lead-in so onset detection preserves the first syllable.
class VoiceCapture extends AudioWorkletProcessor {
    constructor() {
        super()
        this.enabled = true
        this.reset()
        this.port.onmessage = ({data}) => { this.enabled = data === "listen"; this.reset() }
    }
    reset() {
        this.frames = []
        this.active = false
        this.samples = this.loud = this.quiet = 0
    }
    process(inputs) {
        const input = inputs[0]?.[0]
        if (!input || !this.enabled) return true
        let power = 0
        for (const value of input) power += value * value
        const speaking = power / input.length > 0.00025
        this.loud = speaking ? this.loud + input.length : 0
        this.frames.push(input.slice())
        this.samples += input.length
        if (!this.active) {
            if (this.samples > sampleRate * 0.22) this.samples -= this.frames.shift().length
            if (this.loud < sampleRate * 0.075) return true
            this.active = true
            this.port.postMessage({type: "start"})
        }
        this.quiet = speaking ? 0 : this.quiet + input.length
        if (this.quiet < sampleRate * 0.45 && this.samples < sampleRate * 20) return true
        const pcm = new Float32Array(this.samples)
        let offset = 0
        for (const frame of this.frames) { pcm.set(frame, offset); offset += frame.length }
        this.port.postMessage({type: "turn", pcm}, [pcm.buffer])
        this.enabled = false
        this.reset()
        return true
    }
}
registerProcessor("delta-voice-capture", VoiceCapture)
