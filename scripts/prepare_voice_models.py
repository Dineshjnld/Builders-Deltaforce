"""Download or verify the two pinned on-device speech packs."""

from pathlib import Path
import hashlib
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODEL_PACKS = {
    "hi": ("Hindi IndicConformer INT8",
           "https://huggingface.co/ngiftsun/indicconformer-hi-int8-sherpa/resolve/7c3806fe01eb9b50784f09fe22cfeabf642c218e/",
           "fc0c7db7c0e0c11d4ed540dc2cddca03a42fcba3568a0e0607c3631d87fa9f8a",
           "ee60967630213f31951817ac8b402b92ec18cce80718a24a49b388e56672dfb2"),
    "te": ("Telugu IndicConformer INT8",
           "https://huggingface.co/csndhanasekar/sherpa-onnx-indicconformer-te-int8/resolve/638940e6fe0302e50042e865a26d5e45579ebce5/",
           "076cce7dfc7103d35776323c29cb13422be914d58018f625c08cbb0471683359",
           "02488cdcc1e893b392b1ba24f47508e7b7c64b117be249a0d09c5d8b65ecdfcb"),
}


def verify_file(path, digest):
    if not path.is_file():
        return False
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == digest


def install_file(path, url, digest):
    if verify_file(path, digest):
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        temporary = Path(temp.name)
    try:
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as dest:
            while chunk := response.read(1024 * 1024):
                dest.write(chunk)
                if dest.tell() > 150_000_000:
                    raise ValueError(f"Oversized model artifact: {path.name}")
        if not verify_file(temporary, digest):
            raise ValueError(f"Downloaded model artifact does not match the pinned checksum: {path}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    for code, (name, base, model_hash, tokens_hash) in MODEL_PACKS.items():
        directory = ROOT / "var/models" / ("indicconformer-" + code)
        directory.mkdir(exist_ok=True, parents=True)
        for filename, checksum in (("model.int8.onnx", model_hash), ("tokens.txt", tokens_hash)):
            install_file(directory / filename, base + filename, checksum)
        print(f"Verified {name} in {directory}")
