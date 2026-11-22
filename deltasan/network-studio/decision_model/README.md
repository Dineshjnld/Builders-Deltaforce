# Government connector selector

The deployed artifact recommends a read-only connector for an agent assignment. It can select public service guidance, weather forecasts, or no connector. The caller retains control over tool bindings, connector authorization, and human approvals.

| Result | Intended use |
| --- | --- |
| `gov_services` | Discover official government service pages, documents, program information and contact channels. |
| `gov_weather` | Retrieve public weather forecasts. |
| `none` | Continue without either government connector, including when the router abstains. |

## Inference

Copy `__init__.py` and `router.json.gz` together. From the Studio Python environment with `network-studio` on its import path:

```python
from decision_model import predict
route, score = predict("Find MeeSeva guidance for an income certificate")
```

The runtime uses Python's standard library. The returned score measures the winning class's softmax score before abstention. Unknown text can return zero, and an explicit transaction filter returns one for its no-tool decision. Treat this value as a ranking signal. A score below 0.52 abstains.

## Training and verification

The training script updates the last encoder block and classification head of a local MiniLM checkpoint using seven epochs of labeled intent examples. A sparse three-class student learns from the original labels and the teacher's softened predictions. The student uses character fragments, words and word pairs, with 22% weight on the teacher targets. This makes deployment possible without a transformer runtime. The Studio chat model is trained and served separately. The teacher's [model card and Apache 2.0 license](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/c9745ed1d9f207416be6d2e6f8de32d1f16199bf) identify the source checkpoint.

Both tables contain hand-authored synthetic requests. The training set has 167 examples. The 36 independently worded held-out prompts include English, Telugu and Hindi. No citizen records or chat histories were used. On the held-out set the router returned the expected label for 33 of 36 examples. All 12 no-tool examples passed. Three public-source prompts received a no-tool result. The complete confusion matrix and missed prompts are in `evaluation.json`. These results describe this small test set. Broader deployment accuracy and language coverage require evaluation against representative, consented workloads.

To recheck the shipped asset with the Python standard library, run this from the workspace root:

```powershell
py -m unittest discover -s network-studio/decision_model -p test_router.py
```

For a fresh training run, use Python with NumPy, SciPy, scikit-learn, PyTorch and Transformers. The pinned local snapshot revision and random seed are in `train.py`. No network access is needed once that checkpoint is available.

```powershell
py network-studio/decision_model/train.py --snapshot "C:/path/to/local/MiniLM/snapshot"
```

Sensitive requests can be phrased in more ways than this training set covers. Keep connectors read-only and enforce action authorization at the tool boundary. The selector can return at most one candidate per assignment. Score separate specialist assignments when a network needs both services.
