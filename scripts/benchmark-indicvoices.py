"""Score base and language-specific ASR on the same two attributable local clips."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
from statistics import median
from time import perf_counter
import unicodedata
import wave

import numpy as np
import sherpa_onnx

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps/android/app/src/main/assets/asr"
VOICE = ROOT / "apps/web/voice"
THREADS = 2



from prepare_voice_models import MODEL_PACKS


def words(text):
    text = unicodedata.normalize("NFC", text.casefold())
    return "".join(" " if unicodedata.category(c).startswith("P") else c for c in text).split()


def word_errors(reference, candidate):
    ref, hyp = words(reference), words(candidate)
    previous = list(range(len(hyp) + 1))
    for i, word in enumerate(ref, 1):
        current = [i]
        for j, guess in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[-1] + 1,
                               previous[j - 1] + (word != guess)))
        previous = current
    return previous[-1], len(ref)


def recognizer(code, variant):
    if variant == "regional":
        label, url, model_sha, tokens_sha = MODEL_PACKS[code]
        directory = ROOT / "var/models" / ("indicconformer-" + code)
        checks = {"model.int8.onnx": model_sha, "tokens.txt": tokens_sha}
        for name, digest in checks.items():
            if not (directory / name).exists():
                raise FileNotFoundError(f"Place {url}{name} in {directory}")
            with (directory / name).open("rb") as f:
                if hashlib.file_digest(f, "sha256").hexdigest() != digest:
                    raise ValueError(f"{code} speech pack digest mismatch")
        return label, sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(directory / "model.int8.onnx"), tokens=str(directory / "tokens.txt"), num_threads=THREADS)
    tuned = variant == "telugu-whisper"
    prefix = str(ASSETS / "telugu") + os.sep if tuned else str(ASSETS / "tiny-")
    model = "Telugu Whisper Tiny INT8" if tuned else "Whisper Tiny multilingual INT8"
    return model, sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=prefix + "encoder.int8.onnx", decoder=prefix + "decoder.int8.onnx",
        tokens=prefix + "tokens.txt", language=code, num_threads=THREADS)


def score(code, reference, waveform, routed):
    label, model = recognizer(code, routed)
    timings = []
    for i in range(4):
        started = perf_counter()
        stream = model.create_stream()
        stream.accept_waveform(16000, waveform)
        model.decode_stream(stream)
        candidate = stream.result.text.strip()
        elapsed = (perf_counter() - started) * 1000
        if i:
            timings.append(elapsed)
    errors, word_count = word_errors(reference, candidate)
    return {"model": label, "hypothesis": candidate, "wer": errors / word_count,
            "wordErrors": errors, "referenceWords": word_count, "elapsedMs": round(median(timings), 1)}


def main():
    results = []
    dataset = json.loads((VOICE / "samples.json").read_text(encoding="utf-8"))
    for sample in dataset["samples"]:
        code = sample["id"]
        path = VOICE / (code + ".wav")
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample["sha256"]:
            raise ValueError("Sample digest mismatch")
        with wave.open(str(path)) as clip:
            if (clip.getframerate(), clip.getsampwidth(), clip.getnchannels()) != (8000, 2, 1):
                raise ValueError("Expected 8 kHz mono PCM-16")
            raw = np.frombuffer(clip.readframes(clip.getnframes()), dtype="<i2").astype(np.float32) / 32768
        samples = np.interp(np.arange(len(raw) * 2) * 0.5, np.arange(len(raw)), raw).astype(np.float32)
        reference = sample["transcript"]
        result = {"id": code, "language": sample["language"], "reference": reference,
                  "baseline": score(code, reference, samples, "base"),
                  "routed": score(code, reference, samples, "regional")}
        if code == "te":
            result["androidWhisper"] = score(code, reference, samples, "telugu-whisper")
        results.append(result)
    report = {"engine": "sherpa-onnx " + sherpa_onnx.__version__,
              "environment": f"{platform.system()} {platform.machine()} CPU, {THREADS} inference threads",
              "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "method": "One excerpt per language. Both systems get the reference language and identical 16 kHz audio. Timings are median warm decode times over three repetitions after one warm-up. Model initialization is excluded. WER uses NFC, case folding, punctuation removal and whitespace tokenization.",
              "samples": results}
    output = VOICE / "benchmark.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(output)
    for sample in results:
        print(sample["language"], "baseline WER", sample["baseline"]["wer"],
              "routed WER", sample["routed"]["wer"], "routed ms", sample["routed"]["elapsedMs"])


if __name__ == "__main__":
    main()
