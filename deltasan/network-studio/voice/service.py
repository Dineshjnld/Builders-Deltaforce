"""Local speech output for devices without an installed Indic system voice."""
import struct
import subprocess
from threading import BoundedSemaphore
from http.server import ThreadingHTTPServer

from asr import Handler, recognizer, language_detector


playback_slots = BoundedSemaphore(2)


class VoiceHandler(Handler):
    def do_POST(self):
        if not self.path.startswith("/speak/"):
            return super().do_POST()
        language = self.path.removeprefix("/speak/")
        if language not in ("hi", "te", "en"):
            return self.reply(400, {"error": "Unsupported voice language."})
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 12000:
            return self.reply(413, {"error": "Speech text is too long."})
        if not playback_slots.acquire(timeout=5):
            return self.reply(429, {"error": "Speech worker is busy."})
        try:
            text = self.rfile.read(length)
            audio = subprocess.run(
                ["espeak-ng", "-v", language, "-s", "165", "--stdout", "--stdin"],
                input=text, capture_output=True, check=True, timeout=8
            ).stdout
            # eSpeak writes a streaming WAV header to stdout. Browsers also need its final size.
            audio = bytearray(audio)
            struct.pack_into("<I", audio, 4, len(audio) - 8)
            data_offset = audio.index(b"data", 12) + 4
            struct.pack_into("<I", audio, data_offset, len(audio) - data_offset - 4)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except subprocess.SubprocessError:
            self.reply(503, {"error": "Voice playback is unavailable."})
        finally:
            playback_slots.release()


if __name__ == "__main__":
    language_detector()
    for language in ("hi", "te", "en"):
        recognizer(language)
    ThreadingHTTPServer(("0.0.0.0", 8091), VoiceHandler).serve_forever()
