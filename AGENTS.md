# DeltaSAN judge runbook
Public customer demo: https://32.189.49.149:8443/chat/telangana_public_services_cb6baa3c7d45
Hosted operator Studio: https://32.189.49.149/multiAgentAccelerator?network=agent_network_designer (private operator credentials). The local operator journey below requires no account. Watch DEMO.mp4 and read SHORTLIST.pdf.

## Start from this directory
Use a clean Linux x86-64 machine with Docker Engine, Compose v2, Python 3.10+ and outbound HTTPS to PyPI, npm, Docker/GHCR and Hugging Face. Allocate approximately 8 CPU cores, 16 GB RAM and 30 GB free space for the first build. Windows with Docker Desktop in Linux-container mode can run the same commands; use py in place of python3. The containers install Python 3.13, Neuro SAN Studio 0.4.5, Neuro SAN 0.7.27, NSFlow 0.7.5, Node 26.12.1 and Yarn 4.12.0. SQLite is embedded. Keep the extracted directory writable.

    python3 prepare_judge.py
    docker compose -f compose.judge.yaml up --build -d
    docker compose -f compose.judge.yaml ps
    docker compose -f compose.judge.yaml logs --tail 40 runtime ui model

Preparation verifies the pinned Linux Python wheels against their PyPI hashes and installs the public Qwen GGUF and Indic speech weights under var/models, copies the local environment and points runtime inference at the gateway. It can be rerun. Existing sample networks and public service sources are included. New registries are written to deltasan/network-studio/registries; sessions, policies and approvals are saved in the conversations Docker volume. Startup requires time for dependency installation, model loading and graph registration. Verify readiness:

    curl -f http://127.0.0.1:45220/api/v1/list
    curl -f http://127.0.0.1:45221/api/customer/document_review_128eef84463a

Studio: http://127.0.0.1:45220/multiAgentAccelerator?network=agent_network_designer
Playground and operator reviews: http://127.0.0.1:45220/playground
Publisher: http://127.0.0.1:45220/deploy
Customers: use the unique URL returned after publishing, on port 45221. For a remote Linux host, forward all three loopback ports with ssh -L 45220:127.0.0.1:45220 -L 45221:127.0.0.1:45221 -L 45222:127.0.0.1:45222 user@host and browse localhost. Microphone capture requires localhost or HTTPS.

## Credentials and environment
Local Studio operator and reviewer share the loopback-only Studio and require no password. Public customer sessions receive random bearer tokens, scoped to their network. No customer account or fixture password is required. Keep the operator port private. Never put a live provider key or hosted operator password into the submission.

All configurable defaults are in .env.example and compose.judge.yaml. To change a user setting, copy .env.example to .env, edit it, rerun prepare_judge.py, then run docker compose -f compose.judge.yaml up -d --force-recreate. OPENAI_API_KEY may stay empty. Qwen handles text and graph generation, local speech handles audio, and themes have deterministic defaults. An optional server-side OpenAI key enables cloud Realtime, standby text inference and model-assisted theme selection. Browser permission is required for the microphone.

DELTA_CITY_TOKEN is the demo operator/publisher credential. PUBLISH_BEARER_TOKEN is wired to the same value. OPENAI_REALTIME_MODEL, OPENAI_FALLBACK_MODEL and OPENAI_THEME_MODEL select optional cloud models. DELTA_VOICE_SESSIONS_PER_DAY limits new cloud sessions. See the example for service addresses. The Compose defaults are loopback URLs inside a shared container network namespace. Changing an internal port requires updating its associated service command, consumers and the UI build-time rewrite.

## Judge journey
1. Open Studio and send “hi”. Ask “Show government use cases in Andhra Pradesh”, then “Help a district hospital guide patients to outpatient services”. Ask “what are all the integrattions available?” The catalog answer preserves the brief. Send “Use the public services directory” and “List outpatient departments and route exceptions to an officer”. Check the region, audience and source. Confirm with “build it”.
2. Watch the activity log move from architecture to tool selection and registration. Follow Open Playground to inspect the saved roles. If registration is still in progress, refresh after the runtime lists the new network.
3. Open Deployments, select the saved network and enter a synthetic organization name. Publish and open the resulting customer link. A separate fast verification journey uses a Telangana income certificate desk: ask for the official service directory, then reload to recover the conversation. Use a fresh browser profile to see a separate customer session.
4. Check Human approval on a new customer message. In operator Playground, approve or decline that exact request. Verify the result in the same customer session. Try a synthetic email or labelled patient ID and inspect the review queue. Known identifier patterns are masked before new customer messages are saved.
5. Choose Start voice, choose cloud or local speech as available, then Start microphone. Speak in Hindi or Telugu, interrupt a reply, mute and end the session. Dictate creates an editable draft. Operators can require local speech for new customer sessions.
6. Run the backend regression suite inside the installed runtime:

    docker compose -f compose.judge.yaml exec -T runtime python -m unittest test_submission test_city_server test_product_flow decision_model.test_router

For an automated real integration check run python3 judge_smoke.py from the root after readiness. It creates one uniquely named synthetic deployment and verifies approval and persistence. This check requires the curl command on the host.

Stop while preserving records: docker compose -f compose.judge.yaml down

## Other included touch points
The separate FieldOS command centre at the repository root runs with docker compose -f compose.yaml up --build -d on http://127.0.0.1:8787. It seeds synthetic users automatically in demo mode. Choose Open local demo or use admin@studio.example, officer@studio.example, supervisor@studio.example or auditor@studio.example with AgentStudio-demo-2026. See README.md and docs/command-centre.md for draft, run, review and audit journeys. The Android, WhatsApp/Evolution and private pilot clients have separate setup, device and account prerequisites in docs/deployment.md, docs/evolution-demo.md and docs/whatsapp.md. They are optional for the DeltaSAN journey above.

## Original work, reuse and limits
The conversational builder, evidence timeline, civic tool selector, public-source adapters, publisher/customer workflow, approval and privacy controls, voice orchestration and failover are integrated project work with AI coding assistance. Neuro SAN supplies the agent runtime and canvas. Qwen supplies local text inference. The trained connector router scored 33/36 on a small author-written holdout versus 12/36 for a constant baseline. See deltasan/network-studio/SUBMISSION.md for detailed evidence and attribution.

The organizations and test requests are synthetic. Government tools read public sources. Hospital records, appointment booking and benefit decisions need separately authorized systems. Cloud audio is processed before text masking. Names and medical free text can pass through. Local storage protection depends on the judge host; the hosted EC2 disk uses EBS encryption. Local speech uses turn detection; full-duplex cloud WebRTC requires a provider key and quota. Multi-agent response times vary. No real patient records or production credentials are included.

## Verified in the clean-checkout run
All ten Linux Compose services started with OPENAI_API_KEY blank. The local Qwen generated a new income certificate network. The test exported and published it, approved a new customer request, retrieved the official Telangana link and read back the persisted answer. A separate Chrome test selected the saved graph in Deployments, published a second organization, opened its public customer URL, sent a question and verified the answer after reload. A Telugu recording sent through the local speech endpoint returned a Telugu transcript. All twelve Python regression tests passed in the freshly built runtime. Dependency downloads during this test used the host's trusted CA for the frontend build. For an organization with TLS inspection, supply its approved public CA as the optional Docker build secret named judge_ca for the UI; keep certificate verification enabled.
