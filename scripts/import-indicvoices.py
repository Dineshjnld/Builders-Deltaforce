"""Rebuild the two local IndicVoices samples using only the Python standard library."""

import hashlib
import io
import json
import re
import tarfile
import urllib.request
import wave
from pathlib import Path

DESTINATION = Path(__file__).resolve().parents[1] / "apps/web/voice"
PREFIX_SIZE = 6 * 1024 * 1024
SOURCE = "https://huggingface.co/datasets/ai4bharat/IndicVoices"
SEGMENTS = [
    ("hi", "Hindi", "00290928-7790-4a7f-9d56-adeb3d7c3427_0", 9,
     "62f075d3a4f428048f9a6d83690fedc6cefb1a6647fdc53ee86700fe649cdda7"),
    ("te", "Telugu", "00740be7-2bd8-4039-a4f7-7269753c8ecd_0", 14,
     "27ff996e1ee6a0e42ab80e046a71aa3029ea4d41232132a1ce0fd875674bd12e"),
]


def prepare(code, language, recording, segment, digest):
    archive_url = f"https://iv-release.objectstore.e2enetworks.net/dmu_release/v4_{language}_train.tgz"
    request = urllib.request.Request(archive_url, headers={"Range": f"bytes=0-{PREFIX_SIZE - 1}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 206:
            raise ValueError("The upstream source must support partial downloads")
        prefix = response.read(PREFIX_SIZE + 1)
    if hashlib.sha256(prefix).hexdigest() != digest:
        raise ValueError(f"Upstream {language} archive changed. Recheck its source and annotations.")

    path = f"{language}/v4/train/{recording}"
    members = {}
    with tarfile.open(fileobj=io.BytesIO(prefix), mode="r|gz") as archive:
        for member in archive:
            if member.name in (path + ".json", path + ".wav") and member.isfile():
                members[member.name] = archive.extractfile(member).read()
            if len(members) == 2:
                break
    annotation = json.loads(members[path + ".json"])["verbatim"][segment]
    with wave.open(io.BytesIO(members[path + ".wav"])) as audio:
        rate = audio.getframerate()
        start, end = [round(annotation[key] * rate) for key in ("start", "end")]
        if not 0 <= start < end <= audio.getnframes():
            raise ValueError("Time annotation lies outside recording")
        audio.setpos(start)
        frames = audio.readframes(end - start)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as clip:
            clip.setparams(audio.getparams())
            clip.writeframes(frames)
    content = buffer.getvalue()
    transcript = " ".join(re.sub(r"\[[^\]]*\]|<[^>]*>", " ", annotation["text"]).split())
    return content, {
        "id": code, "language": language, "locale": code + "-IN",
        "audio": f"/voice/{code}.wav", "transcript": transcript,
        "durationSeconds": round((end - start) / rate, 3),
        "sha256": hashlib.sha256(content).hexdigest(),
        "recording": recording, "segment": segment, "archive": archive_url,
        "startSeconds": annotation["start"], "endSeconds": annotation["end"],
    }


def main():
    manifest = {
        "dataset": "AI4Bharat IndicVoices", "source": SOURCE,
        "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "AI4Bharat, IIT Madras. Javed et al., IndicVoices (2024).",
        "modifications": "Each clip is a timestamped excerpt of an original recording. Non-speech tags and repeated whitespace were removed from the verbatim reference.",
        "samples": [],
    }
    prepared = [prepare(*entry) for entry in SEGMENTS]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for content, sample in prepared:
        (DESTINATION / f"{sample['id']}.wav").write_bytes(content)
        manifest["samples"].append(sample)
    (DESTINATION / "samples.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
