# WhatsApp hackathon demo

DELTAFORCE Resolve uses Evolution API in Baileys mode for the local demo. The Cloud API adapter remains available separately. The dashboard identifies the use of Evolution API in **Cases**. The pinned release uses Apache 2.0 terms with additional branding and usage-notification conditions. Preserve upstream branding if using its frontend, and review the tagged license before commercial distribution or deployment. [Release v2.3.7](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7) · [Tagged license](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/LICENSE)

## Start and pair

Run these commands from the repository root in PowerShell 7 with Docker Desktop running in Linux-container mode.

```powershell
./scripts/evolution-demo.ps1 Start
./scripts/evolution-demo.ps1 Pair
```

Start generates four independent 256-bit secrets in the ignored `var/evolution.env`, starts the isolated `deltaforce-wa` Compose project, waits for service health, and provisions the `deltaforce-demo` Baileys instance and authenticated webhooks. Dashboard and Evolution administration bind to loopback on ports 8787 and 8080. FastAPI, Postgres and Redis have no host port mappings. The Docker build normally fetches Python dependencies from PyPI. If Docker cannot reach PyPI but the Windows host can, download compatible Linux AMD64 wheels locally and add the build context setting to the existing env file once.

```powershell
py -3.13 -m pip download --only-binary=:all: --platform manylinux2014_x86_64 --dest var/wheels -r services/whatsapp/requirements.txt
'EVOLUTION_WHEEL_CONTEXT=./var/wheels' | Add-Content var/evolution.env
./scripts/evolution-demo.ps1 Start
```

Scan the local QR from WhatsApp **Linked devices** on the dedicated test account. Run **Pair** again if the QR has expired. Treat the QR image and session volume as credentials. Send a uniquely identifiable fictional complaint from a second test number to the paired number, for example “SYNTHETIC: Please review the fictional district workshop request.” Use only test accounts, fictional text, staged images and synthetic voice clips.

Open [the dashboard](http://127.0.0.1:8787), sign in as `supervisor@studio.example` with password `AgentStudio-demo-2026`, and open **Inbox**. Refresh after each test. Text, image captions and voice events create cases in the Program operations inbox. Image and audio bytes are stored when Evolution supplies them, and the dashboard shows whether the attachment was stored. The webhook accepts up to 12 MiB per request, including base64 encoding. SQLite commits the case, attachment metadata and audit entry together and suppresses repeats by instance and provider message ID.

## Verify and recover

```powershell
./scripts/evolution-demo.ps1 Status
docker exec deltaforce-wa-whatsapp-1 python -m services.whatsapp.smoke_evolution
```

Status shows the current provider state, container health and recent audit records. The smoke check injects synthetic fixtures into the actual FastAPI webhook and checks the authenticated dashboard API. It creates three persistent demo cases per run. Fixture cases cannot send replies. A live pass requires an independent test phone to send a message through the paired account and the matching case to appear exactly once.

Baileys attempts reconnects on transient disconnects. For a test session that stays disconnected, run `./scripts/evolution-demo.ps1 Reconnect` and check **Status**. For an unlinked session use **Pair** and scan again. Connection updates and outbound approval outcomes are audited in SQLite. For eligible cases, a supervisor can type a response and click **Approve and send**. The connector records the attempt before contacting Evolution and prevents duplicate sends on repeated approval. An accepted response has a provider message ID. To verify delivery, check the receiving test phone. For a send left in `sending` or marked `uncertain`, reconcile against the test phone before taking any further action. The connector deliberately limits the demo to one attempt per case. Sender IDs that supply only a WhatsApp LID cannot currently receive dashboard replies.

Baileys relies on WhatsApp Web behavior. Changes to WhatsApp can interrupt pairing, disconnect sessions, or disrupt delivery even while the containers are healthy. WhatsApp may restrict or suspend accounts using unofficial automation. Evolution may log inbound message details, including media, so keep the local logs and volumes private and use synthetic content. The outbound connector implements the same text-sending interface as the Cloud API client. The Evolution-specific webhook parser sits at the provider boundary. [Upstream webhook guide](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md) · [Tagged Compose configuration](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/docker-compose.yaml)
