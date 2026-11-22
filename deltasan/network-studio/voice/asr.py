"""Private CPU transcription worker. Audio stays in memory."""
import json
import io
import wave
import subprocess
import threading
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from time import perf_counter

import imageio_ffmpeg
import numpy as np
import sherpa_onnx

slot = threading.Lock()
MAX_BYTES = 3_000_000
MAX_SECONDS = 30

@lru_cache(maxsize=1)
def language_detector():
    whisper = sherpa_onnx.SpokenLanguageIdentificationWhisperConfig(
        "/asr/tiny-encoder.int8.onnx", "/asr/tiny-decoder.int8.onnx")
    return sherpa_onnx.SpokenLanguageIdentification(
        sherpa_onnx.SpokenLanguageIdentificationConfig(whisper, num_threads=2))

@lru_cache(maxsize=3)
def recognizer(language):
    if language in ('hi','te'):
        return sherpa_onnx.OfflineRecognizer.from_nemo_ctc(model='/'+language+'/model.int8.onnx', tokens='/'+language+'/tokens.txt', num_threads=2)
    prefix = '/asr/tiny-'
    return sherpa_onnx.OfflineRecognizer.from_whisper(encoder=prefix+'encoder.int8.onnx', decoder=prefix+'decoder.int8.onnx', tokens=prefix+'tokens.txt', language=language, num_threads=2)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self,status,data):
        payload=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.reply(200 if self.path=='/health' else 404,{'ready':self.path=='/health'})

    def do_POST(self):
        language=self.path.removeprefix('/transcribe/')
        if language not in ('auto','en','hi','te') or not self.path.startswith('/transcribe/'):
            return self.reply(404,{'error':'Unknown language.'})
        length=int(self.headers.get('Content-Length','0'))
        if not 0<length<=MAX_BYTES:
            return self.reply(413,{'error':'Audio exceeds the input limit.'})
        if not slot.acquire(timeout=8):
            return self.reply(429,{'error':'Speech worker busy. Try again shortly.'})
        try:
            started=perf_counter()
            data=self.rfile.read(length)
            fmt='ogg' if data.startswith(b'OggS') else 'wav' if data[:4]==b'RIFF' and data[8:12]==b'WAVE' else None
            if not fmt:
                return self.reply(422,{'error':'Use PCM WAV or Ogg audio.'})
            args=[imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-nostdin','-protocol_whitelist','pipe','-f',fmt,'-i','pipe:0','-vn','-t',str(MAX_SECONDS+1),'-ac','1','-ar','16000','-f','s16le','pipe:1']
            raw = None
            if fmt == 'wav':
                with wave.open(io.BytesIO(data)) as source:
                    if (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (16000, 1, 2):
                        raw = source.readframes(16000 * (MAX_SECONDS + 1))
            if raw is None:
                raw = subprocess.run(args,input=data,capture_output=True,timeout=6,check=True).stdout
            if not raw or len(raw)>32000*MAX_SECONDS:
                return self.reply(422,{'error':'Provide up to 30 seconds of audible content.'})
            samples=np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768
            if language == "auto":
                detector = language_detector()
                clip = detector.create_stream()
                clip.accept_waveform(16000, samples)
                language = detector.compute(clip)
                if language not in ("en", "hi", "te"):
                    return self.reply(422, {"error": "I couldn't identify English, Hindi or Telugu. Please repeat a full sentence."})
            model=recognizer(language)
            stream=model.create_stream()
            stream.accept_waveform(16000,samples)
            model.decode_stream(stream)
            self.reply(200,{'transcript':stream.result.text.strip(),'language':language,'ms':round((perf_counter()-started)*1000)})
        except (subprocess.SubprocessError, ValueError, EOFError, wave.Error):
            self.reply(422,{'error':'Audio could not be decoded.'})
        except Exception:
            self.reply(503,{'error':'Speech model unavailable.'})
        finally:
            slot.release()

if __name__=='__main__':
    ThreadingHTTPServer(('0.0.0.0',8091),Handler).serve_forever()

