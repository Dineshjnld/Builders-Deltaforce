"""Run from any directory with a local all-MiniLM-L6-v2 snapshot. No downloads."""
import argparse
import csv
import gzip
import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np
from scipy.optimize import minimize
from scipy.special import softmax, logsumexp
from sklearn.feature_extraction import DictVectorizer
import torch
from torch import nn
from transformers import AutoTokenizer, AutoModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decision_model import ROOT, ROUTES, features, predict, _model

SEED = 431


def rows(split):
    with (ROOT / (split + ".tsv")).open(encoding="utf-8-sig") as f:
        values = list(csv.reader(f, delimiter="\t"))
    return [q for label, q in values], np.array([ROUTES.index(label) for label, q in values])


def teacher(texts, labels, snapshot):
    torch.manual_seed(SEED)
    torch.set_num_threads(2)
    tok = AutoTokenizer.from_pretrained(snapshot, local_files_only=True)
    model = AutoModel.from_pretrained(snapshot, local_files_only=True)
    model.requires_grad_(False)
    model.encoder.layer[-1].requires_grad_(True)
    head = nn.Linear(model.config.hidden_size, len(ROUTES))
    optimizer = torch.optim.AdamW([
        {"params": model.encoder.layer[-1].parameters(), "lr": 0.00008},
        {"params": head.parameters(), "lr": 0.004},
    ])
    tokens = tok(texts, padding=True, truncation=True, max_length=64, return_tensors="pt")
    targets = torch.from_numpy(labels).long()

    def forward(indices):
        ids = {k: v[indices] for k, v in tokens.items()}
        hidden = model(**ids).last_hidden_state
        mask = ids["attention_mask"].unsqueeze(-1)
        pooled = (hidden * mask).sum(1) / mask.sum(1)
        return head(nn.functional.normalize(pooled) * 12.0)

    for _ in range(7):
        model.train()
        for batch in torch.randperm(len(texts)).split(16):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(forward(batch), targets[batch])
            loss.backward()
            optimizer.step()
    model.eval()
    with torch.no_grad():
        logits = torch.cat([forward(idx) for idx in torch.arange(len(texts)).split(16)])
    return torch.softmax(logits / 1.7, dim=1).numpy(), sum(p.numel() for p in list(model.parameters())+list(head.parameters()) if p.requires_grad)


def train(snapshot):
    texts, y = rows("train")
    heldout, heldout_y = rows("heldout")
    assert len({q.casefold() for q in texts + heldout}) == len(texts) + len(heldout)
    soft, trainable = teacher(texts, y, snapshot)
    truth = np.eye(len(ROUTES))[y]
    targets = 0.78 * truth + 0.22 * soft
    vectorizer = DictVectorizer()
    x = vectorizer.fit_transform([features(q) for q in texts])
    shape = x.shape[1] + 1, len(ROUTES)
    penalty = 0.10

    def objective(flat):
        w = flat.reshape(shape)
        logits = x @ w[:-1] + w[-1]
        loss = np.sum(logsumexp(logits, axis=1)) - np.sum(logits * targets) + penalty * np.sum(w[:-1]**2) / 2
        delta = softmax(logits, axis=1) - targets
        gradient = np.vstack([x.T @ delta + penalty * w[:-1], delta.sum(axis=0)])
        return loss, gradient.ravel()

    result = minimize(objective, np.zeros(np.prod(shape)), method="L-BFGS-B", jac=True, options={"maxiter":300})
    if not result.success:
        raise RuntimeError(result.message)
    weights = result.x.reshape(shape).round(5)
    model = {"bias":weights[-1].tolist(), "weights":dict(zip(vectorizer.get_feature_names_out(), weights[:-1].tolist()))}
    encoded = json.dumps(model, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    asset = ROOT / "router.json.gz"
    asset.write_bytes(gzip.compress(encoded, mtime=0))
    _model.cache_clear()
    start = perf_counter()
    pred = [predict(q)[0] for q in heldout]
    elapsed = perf_counter() - start
    matrix = [[0]*len(ROUTES) for _ in ROUTES]
    errors = []
    for q, actual, chosen in zip(heldout, heldout_y, pred):
        matrix[actual][ROUTES.index(chosen)] += 1
        if chosen != ROUTES[actual]:
            errors.append({"query":q, "expected":ROUTES[actual], "predicted":chosen})
    metrics = {"base":"sentence-transformers/all-MiniLM-L6-v2","revision":snapshot.name,
               "seed":SEED,"teacher_trainable_parameters":trainable,"training_examples":len(y),
               "held_out_examples":len(heldout),"routes":ROUTES,"confusion_rows_true_columns_predicted":matrix,
               "held_out_correct":len(heldout)-len(errors),"errors":errors,"runtime_bytes":asset.stat().st_size}
    (ROOT / "evaluation.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False)+"\n",encoding="utf8")
    print(json.dumps(metrics, ensure_ascii=True), flush=True)
    print(f"Held-out CPU evaluation including loading took {elapsed:.3f}s",flush=True)


if __name__ == "__main__":
    default = Path.home()/".cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot",default=default,type=Path)
    train(parser.parse_args().snapshot)
