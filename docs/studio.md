# DELTAFORCE Agent Studio

## Five-minute demonstration

Open http://127.0.0.1:8787 and select **Open demo workspace**. In Overview, select **Department briefing**. Choose an execution strategy, enter a department procedure, assign a supervisor, evaluate the workflow and publish its version. The builder can replay required fields against recent runs.

In **Data library**, search the Andhra Pradesh or Telangana district directory. Play the licensed AI4Bharat recordings and run local transcription. Review and edit the transcript before sending it to the workflow builder. Recorded comparisons use the same audio on the baseline and language-specific model. Model outputs may require substantial correction. [Speech evaluation and model setup](voice-data.md)

Sign in as officer, choose the workflow, select a district and enter the following synthetic evidence or import it as a text file.

    subject = District workshop
    Prepare a briefing on a proposed training venue.

Run the workflow. Expand the result to inspect required fields, district provenance, agent drafts and timing. Switch to the designated supervisor, open Reviews and approve or return it. The audit log records the decision. The separate Inbox action authorizes an outbound WhatsApp message.

The admin can issue or revoke an intake key under Connections. Supply it as a Bearer credential on POST /api/intake with JSON containing id and text. Repeated identical events return the original case ID. Reusing an ID with different text returns HTTP 409. The credential binds organization and department on the server. Never include keys in URLs.

## Local deployment

Prepare Evolution using the existing [connector runbook](evolution-demo.md). Place the official qwen2.5-0.5b-instruct-q4_k_m.gguf in var/models/qwen.gguf. Check SHA-256 74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db. Add the following image pin to the private var/evolution.env file. [Qwen model repository](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF)

    STUDIO_MODEL_IMAGE=ghcr.io/ggml-org/llama.cpp@sha256:ae28f5c2046de51dfd00c9116a36fe44b5e8703ef730d0aea69082781eecb1f7

Prepare Hindi and Telugu weights using scripts/prepare_voice_models.py and the English Whisper assets described in docs/voice-data.md. From the repository root run the following commands. The verification script creates a synthetic workflow and approved run in the demo tenant.

    docker compose --env-file var/evolution.env -p deltaforce-wa -f compose.yaml -f compose.evolution.yaml -f compose.studio.yaml up -d --build --wait
    node --test packages/evaluation/workflow.test.mjs
    node scripts/verify-studio.mjs

## Execution and privacy

FastAPI handles the WhatsApp connector. The existing Node service runs Studio policy checks, persists versioned runs in SQLite and calls llama.cpp over an internal network. Rules independently determine missing fields and the human review route. Two local inference calls run concurrently. The configured caseworker receives a bounded evidence excerpt after common identifier patterns are removed. The procedure reviewer receives the SOP and missing-field names. Both return advisory text and independently record timing and errors. The draft is untrusted. Selected instruction-like phrases skip model inference and flag the evidence for review. These pattern checks have limited language and identifier coverage. Authorized users still see the original evidence. A model timeout falls back to rules. A supervisor cannot sign off their own submission.

The Studio language selector translates primary controls. Transcript script detection identifies Telugu, Devanagari and Latin runs. See the [Android model notes](models.md) for speech pathways and their model downloads. Text-script detection alone cannot distinguish Hindi from other Devanagari languages or resolve Romanized Telugu. WhatsApp voice events with stored WAV or Ogg audio up to 30 seconds can be transcribed in Inbox. Select the spoken language and review the text before using it in the builder. Images require a caption for text-based analysis. The workflow does not infer medical, police or revenue decisions.

The local MCP stdio tool shares the Studio's state lookup and exposes only the two public water coverage records. Configure an MCP client with command node and the absolute path to scripts/context-mcp.mjs as its argument. The tool water_context accepts a state of Andhra Pradesh or Telangana. Records are snapshots. The native Studio invokes the lookup directly.

## Government pilot readiness

A department admin can create a workspace, add staff, name the approving supervisor and publish a local procedure. The templates are editable demonstration procedures. Department owners must validate the operative SOP and delegation of authority. A pilot readiness review should cover procurement, identity federation, retention and erasure, backup restoration, incident response, accessibility testing, language quality and applicable sector restrictions. The local Compose files enable demo accounts. Use synthetic data and a dedicated test account.

MeitY publishes phased commencement for the DPDP Act and Rules. Map obligations to the deployment date, processing purpose and responsible department. CERT-In publishes directions on incident reporting and logging. The government accessibility and quality framework includes GIGW 3.0 and a separate assessment process. This repository carries no government certification. [DPDP commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) · [DPDP Rules](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa) · [CERT-In directions](https://www.cert-in.org.in/Directions70B.jsp) · [GIGW](https://guidelines.india.gov.in/)