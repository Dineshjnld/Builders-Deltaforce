export type RealtimeAccess = {endpoint:string;token?:string;enabled:boolean}

type Callbacks = {
    status:(text:string)=>void
    heard:(text:string)=>void
    reply:(text:string)=>void
    dictate?:(text:string)=>void
    send:(text:string, language:string)=>Promise<string>
}

export async function startRealtime(access:RealtimeAccess, signal:AbortSignal, callbacks:Callbacks) {
    const peer = new RTCPeerConnection()
    const audio = new Audio()
    audio.autoplay = true
    const channel = peer.createDataChannel("oai-events")
    let mic: MediaStream | undefined
    let generation = 0
    let chain = Promise.resolve()
    const seen = new Set<string>()
    const close = () => {
        generation++
        mic?.getTracks().forEach(t=>t.stop())
        channel.close()
        peer.close()
        audio.pause()
        audio.srcObject = null
    }
    signal.addEventListener("abort",close,{once:true})
    peer.ontrack = ev => {audio.srcObject = ev.streams[0]; void audio.play().catch(()=>callbacks.status("Allow playback to hear the response."))}
    channel.onopen = () => callbacks.status("Listening · live voice")
    channel.onmessage = ev => {
        if (signal.aborted) return
        const event = JSON.parse(ev.data)
        if(event.type==="error"){callbacks.status("Voice connection reported an error. End the session to reconnect.");return}
        if(event.type==="input_audio_buffer.speech_started"){generation++;callbacks.status("Hearing you…");return}
        if(event.type==="output_audio_buffer.stopped"){callbacks.status("Listening · live voice");return}
        if(event.type!=="conversation.item.input_audio_transcription.completed" || seen.has(event.item_id))return
        seen.add(event.item_id)
        const text = String(event.transcript || "").trim()
        if(!text)return
        callbacks.heard(text)
        if(callbacks.dictate){callbacks.dictate(text);return}
        const turn = generation
        chain = chain.then(async()=>{
            if(signal.aborted)return
            callbacks.status("Waiting for the network…")
            const lang = /[\u0c00-\u0c7f]/.test(text)?"Telugu":/[\u0900-\u097f]/.test(text)?"Hindi":"the speaker’s language"
            const answer = await callbacks.send(text,lang)
            if(signal.aborted || generation!==turn)return
            callbacks.reply(answer)
            if(!answer){callbacks.status("Listening · live voice");return}
            channel.send(JSON.stringify({type:"response.create",response:{output_modalities:["audio"],input:[],instructions:
                "Read the following agent answer aloud in the speaker's language; use "+lang+". Omit markdown and URLs. Do not add new information. Answer: "+answer.slice(0,10000)}}))
            callbacks.status("Speaking · interrupt with your voice")
        }).catch(()=>{if(!signal.aborted)callbacks.status("The network could not complete this turn.")})
    }
    try {
        mic = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})
        if(signal.aborted)throw new Error("Session ended.")
        mic.getAudioTracks().forEach(track=>peer.addTrack(track,mic!))
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        const res = await fetch(access.endpoint,{method:"POST",headers:{"Content-Type":"application/sdp","x-deltasan-voice":"1",
            ...(access.token?{Authorization:"Bearer "+access.token}:{})},body:offer.sdp,signal})
        if(!res.ok)throw new Error("Cloud voice unavailable.")
        await peer.setRemoteDescription({type:"answer",sdp:await res.text()})
        await new Promise<void>((resolve,reject)=>{
            if(channel.readyState==="open"){resolve();return}
            const timer=setTimeout(()=>reject(Error("Voice connection timed out.")),10000)
            channel.addEventListener("open",()=>{clearTimeout(timer);resolve()},{once:true})
            signal.addEventListener("abort",()=>{clearTimeout(timer);reject(Error("Session ended."))},{once:true})
        })
    } catch(e){close();signal.removeEventListener("abort",close);throw e}
}
