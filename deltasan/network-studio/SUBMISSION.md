# DeltaSAN · Builders submission

**Track:** Build Ambitious, Problem Statement 3. **Reference products:** [Neuro SAN Studio](https://github.com/cognizant-ai-lab/neuro-san-studio), [Multi-Agent Accelerator](https://neuro-san.evolution.ml/multiAgentAccelerator) and [Agentic City](https://agentic-city.decisionai.ml/app/#deploy).

An officer describes a service problem by text or voice. DeltaSAN collects a brief, builds a network after confirmation, and publishes a customer app. A resident can then ask that network a question, get an official source, and return to the conversation. The public demo follows a Telangana resident looking for income certificate guidance.

## Try the working product

- [Public Telangana service desk](https://32.189.49.149:8443/chat/telangana_public_services_cb6baa3c7d45). Ask “Where do I find the official Telangana income certificate service?” A successful directory lookup includes the department and its official source. Refresh the same tab to recover the conversation.
- [Studio builder](https://32.189.49.149/multiAgentAccelerator?network=agent_network_designer). Use the operator credential shared privately by the builder. Start with “hi”, then supply a different goal, audience, inputs, and outcome. Confirm the summary with “build it”. Watch the network architect, connector selector and validator handoffs, open the saved network in [Playground](https://32.189.49.149/playground), then [publish it](https://32.189.49.149/deploy).
- Example fresh input: “Guide Telangana applicants to scholarship services.” Audience: students and guardians. Inputs: the official state service directory. Outcome: return the source and refer exceptions to an officer. After building, try “Add a scholarship document reviewer”, then confirm to save a revision.
- Publish under an organization name to obtain a customer URL and iframe snippet. In customer chat, enable **Human approval** on a message. Review that exact request in Playground. Approval runs the turn and returns the result to its original session. Declining completes it without running the network.
- For voice, allow microphone access and speak in complete turns. Speak during playback to interrupt. Dictation produces an editable draft. The live site uses WebRTC, speech detection and transcription, then runs the selected network and voices its answer. Private Studio and anonymous customer conversations have separate entry points.

## Evidence from the release

| Check | Result |
|---|---|
| Fresh EC2 build | A previously unseen brief for Telangana income certificate guidance produced two connected agents. The trained tool selector assigned the state directory to one agent. No registry entry appeared before confirmation. |
| Fresh browser build | In a new Chrome session on the public Studio, an Andhra Pradesh scholarship brief produced three roles after confirmation. The selector assigned `gov_services` to `ScholarshipInquiryRouter`, and the validator saved the graph. [Build activity screenshot](../screenshots/submission-build-activity.png) |
| Real build activity | Four events reported the actual transfer of the brief, the generated roles, the selected binding, and successful graph validation and storage. They describe components doing work. Agent-to-agent call paths during execution come from Neuro SAN's runtime. |
| Publishing and review | The generated network was registered, published and given its own civic-themed web app. An approved customer message returned the official Telangana service directory link. Reading the same session again returned the saved answer. |
| Tool selection | On 36 held-out, author-written examples balanced across three classes, the trained router got 33 correct (91.7%). A constant “no connector” baseline gets 12/36 (33.3%). The three errors were abstentions. All 12 no-tool cases were correct. [Data and results](decision_model/evaluation.json) |
| Live public sources | The MCP tools returned a Telangana Revenue service entry and current station readings from IMD Amaravati. MoSPI’s keyless MCP returned a live dataset list. The [catalog](government_sources.json) covers 13 Andhra Pradesh and 13 Telangana scenarios. The [government sources](https://www.telangana.gov.in/services/state-services/) remain authoritative for current procedures. |
| Model failover | A test against the EC2 gateway returned `local-qwen` from the healthy primary. A separate isolated test pointed its primary to an unavailable loopback address, and the same question returned a live GPT-4.1 mini response. |
| Speech | Chrome negotiated a real OpenAI audio session and received Hindi and Telugu transcriptions and audio responses. The test injected recordings into a browser microphone track. Speech and model inference were live. On a fresh Studio voice session, the 3.54-second Hindi recording reached spoken playback at 7.04 seconds from input start and the 4.96-second Telugu recording at 7.30 seconds. That is approximately 3.50 and 2.34 seconds after the recordings ended. These are two observations, not a general latency benchmark. In a six-agent customer network, one Hindi turn took 93.45 seconds from input start to substantive playback. The UI streams activity and can acknowledge a long turn while the network works. [Recording attribution](../../apps/web/voice/samples.json) |
| Customer UI | Desktop and mobile browser tests covered typed submission, editable dictation, approval state, and streaming completion. The client resumes from authenticated history when an event stream drops. |

[Live customer desk screenshots, desktop](../screenshots/submission-public-civic.png) and [mobile](../screenshots/submission-public-mobile.png).

## Original work, reuse and limits

The submission combines a conversational brief and revision workflow, a graph compiler, live build activity, a trained civic connector selector, scoped public-data adapters, publication, customer chat, review persistence, context-based themes, voice orchestration and inference failover. Codex assisted with implementation, research and testing.

Neuro SAN and its UI provide the underlying runtime and graph canvas. Qwen via llama.cpp provides primary text inference. OpenAI provides Realtime voice, optional theme selection and standby text inference. MiniLM supplied the pretrained checkpoint for the supervised connector router. The training updated its last encoder block and classifier, then distilled the result into a 44 KB runtime asset. Qwen's weights were not trained for this submission. [Training and reproduction](decision_model/README.md)

The test organizations, requests and approval decisions are synthetic. Public-service tools read public information. They cannot look up private citizen records, submit government applications, or grant benefits. The photos are illustrative. [Image sources and licenses](../accelerator-ui/apps/main/components/customer-scenes/SOURCES.md). The public sources are linked and retrieved for guidance. The service is an independent demo.

The customer app chooses among six implemented visual themes. On publication, the optional OpenAI call selects the theme from the network context. The live text view displays execution activity as it arrives and the answer when the runtime supplies it. Approval is enforced before an individual customer turn runs.

## Configuration and checks

### Conversation and privacy controls

In the builder, try “Show government use cases in Andhra Pradesh”, then “Help a district hospital guide patients to outpatient services”, followed by “what are all the integrattions available?” or “what is the inetgrations cheppu”. Studio reads the configured integration catalog and resumes the pending question. A discovery or privacy question never supplies a required field. For this example, the confirmed brief identifies the patients, outpatient goal and region. Only confirmation starts graph generation.

New Studio UI queries and new published chat inputs mask common email addresses, Indian mobile numbers, PANs, 12-digit ID formats and labelled patient IDs. The customer server applies the mask before persistence, review and execution. Pattern matching can miss names, clinical details and unusual spellings. Use synthetic records. Existing history is retained. Customer requests use HTTPS on EC2. Stored messages and context live in SQLite on an encrypted EBS volume. The application can read authorized history and review requests. This setup provides transport and volume encryption; it does not provide end-to-end encryption between human participants.

In Playground, operators can require human review before every customer turn and restrict new speech connections to local processing per deployment. Review and speech policies persist. Local speech uses DeltaSAN's server for audio. The text inference gateway can still use its configured cloud fallback. The live voice panel offers microphone mute, interruption, captions, local speech, and a sound-reactive indicator with reduced-motion support. Raw audio reaches the selected speech processor before transcript masking.

The Windows checkout reads `%LOCALAPPDATA%/DeltaSAN/config/.env`. On EC2 the AI-enabled services read a private read-only mount selected by `DELTA_AI_ENV`. Use `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_THEME_MODEL`, `OPENAI_FALLBACK_MODEL` and `DELTA_VOICE_SESSIONS_PER_DAY`. The standard provider key stays server-side. The deployment defaults to 24 new cloud voice sessions per UTC day across the installation. The local IndicConformer / Whisper worker provides the alternative speech path.

The local runtime modules are `customer:app`, `city_server:app`, `inference_gateway:app`, and two read-only MCP processes (`python government_mcp.py` and `python government_mcp.py weather`). The EC2 primary listens on loopback port 45185 and the inference gateway on 45212. Point both Studio's `DELTA_QWEN_URL` and the runtime’s OpenAI-compatible base URL at the gateway's `/v1` endpoint for failover. The government MCP services listen on 45210 and 45211. Only the TLS Studio and customer gateways are public.

From the Studio Python environment, run `python -m unittest test_submission test_city_server test_product_flow decision_model.test_router` in this directory. For the customer UI run the two `apps/main/__tests__/pages/Customer*` suites from the accelerator-ui Yarn workspace.
