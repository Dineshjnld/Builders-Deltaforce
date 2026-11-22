"""Prepare public model weights and local settings. Run once from the archive root."""
import hashlib, shutil, urllib.request, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(__file__).resolve().parent
weights = root / 'var/models'
studio = root / 'deltasan/network-studio'
def fetch(url, path, digest=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temp = path.with_suffix(path.suffix+'.part')
        with urllib.request.urlopen(url,timeout=180) as src, temp.open('wb') as dest:
            shutil.copyfileobj(src,dest)
        if digest and hashlib.sha256(temp.read_bytes()).hexdigest()!=digest: raise ValueError('Checksum failure: '+path.name)
        temp.replace(path)
    elif digest and hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
        raise ValueError('Existing model checksum failed: '+str(path))
fetch('https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',weights/'qwen.gguf','74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db')
for lang, repo, rev in [('hi','ngiftsun/indicconformer-hi-int8-sherpa','7c3806fe01eb9b50784f09fe22cfeabf642c218e'),('te','csndhanasekar/sherpa-onnx-indicconformer-te-int8','638940e6fe0302e50042e865a26d5e45579ebce5')]:
    for name in ['model.int8.onnx','tokens.txt']:
        fetch(f'https://huggingface.co/{repo}/resolve/{rev}/{name}',weights/lang/name)
# Fetch the exact Linux wheels on the host so Docker builds need no PyPI credentials or network access.
def dependency(record):
    fetch(record['url'], root/'judge-deps/wheels'/record['file'], record['sha256'])
with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(dependency, {item['file']:item for manifest in ('manifest.json','speech-manifest.json') for item in json.loads((root/'judge-deps'/manifest).read_text())}.values()))
env = root/'.env'
if not env.exists(): shutil.copyfile(root/'.env.example',env)
shutil.copyfile(env,studio/'.judge.env')
cfg=studio/'config/llm_config.hocon'
cfg.write_text(cfg.read_text().replace('127.0.0.1:45185/v1','127.0.0.1:45212/v1'))
print('Ready. Run docker compose -f compose.judge.yaml up --build -d')
