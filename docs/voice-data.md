# Speech evaluation in Agent Studio

Play the two clips in the Studio voice evaluation view. Each reference comes from AI4Bharat's speaker annotation. The evaluation records model output, word edit counts and elapsed time on the same waveform. Both systems receive the known language. This particular experiment measures transcription quality and omits automatic language identification.

## Data and attribution

The Hindi and Telugu WAV files are short, attributed excerpts from the authors' public IndicVoices v4 recordings. The dataset is credited to AI4Bharat at IIT Madras and Javed et al. (2024) under CC BY 4.0. The importer cuts annotated segments and removes non-speech markers from the written reference. The sample manifest identifies each source recording and interval. Voice data stays local during playback and scoring. [Dataset card and official archive links](https://huggingface.co/datasets/ai4bharat/IndicVoices) Â· [Research paper](https://aclanthology.org/2024.findings-acl.639/) Â· [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

IndiaAI's AIKosh separately catalogues IndicVoices-R, a speech synthesis corpus with its own licence listed on the portal. This corpus is a discovery resource in the Studio. The two distributed evaluation recordings come from the original IndicVoices release. [AIKosh entry](https://aikosh.indiaai.gov.in/home/datasets/details/indicvoices_r.html)

## Reproduce

From the repository root, run the following PowerShell commands. The importer fetches only the first 6 MiB of each upstream archive and verifies the pinned prefix hash before reading the selected files.

~~~powershell
py -3.13 scripts/import-indicvoices.py
py -3.13 -m venv var/voice-eval
& var/voice-eval/Scripts/python.exe -m pip install sherpa-onnx==1.12.39 numpy==2.2.6
~~~

The baseline uses the multilingual Whisper Tiny INT8 models in the Android assets directory. The regional comparison uses AI4Bharat IndicConformer weights packaged for sherpa-onnx. The Hindi repackaging is CC BY 4.0 and the Telugu repackaging is MIT-licensed. The bootstrap downloads model.int8.onnx and tokens.txt from each pinned release into var/models/indicconformer-hi and var/models/indicconformer-te respectively. It verifies all four digests and skips existing files that match. The benchmark rechecks the same digests before inference. [Hindi speech pack and credits](https://huggingface.co/ngiftsun/indicconformer-hi-int8-sherpa/tree/7c3806fe01eb9b50784f09fe22cfeabf642c218e) Â· [Telugu speech pack and credits](https://huggingface.co/csndhanasekar/sherpa-onnx-indicconformer-te-int8/tree/638940e6fe0302e50042e865a26d5e45579ebce5)

~~~powershell
py -3.13 scripts/prepare_voice_models.py
& var/voice-eval/Scripts/python.exe scripts/benchmark-indicvoices.py
~~~

The resulting benchmark.json includes desktop CPU decode times after model warm-up. The score uses word-level Levenshtein distance divided by the reference word count. Insertions can make the score exceed 100%. A lower score means fewer edits on that clip. One Hindi and one Telugu recording are enough for a reproducible demonstration. Departmental validation needs independent speakers, realistic devices, accents, mixed language, entity accuracy and longer utterances. The two source segments come from the corpus training split, so generalisation and training overlap remain unmeasured.
