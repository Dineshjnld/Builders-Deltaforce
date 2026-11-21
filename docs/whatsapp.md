# WhatsApp Cloud API

The FastAPI service receives Meta callbacks at `/webhooks/whatsapp`. The FieldOS dashboard reads the same SQLite database and shows the latest 100 cases for the signed-in user's organization and department under **Cases**. One configured Meta phone number ID routes to one organization and department. Each inbound message ID can create one case. Text bodies are stored verbatim and rendered as plain text. Other message types create a case with the message type. Attachment retrieval is outside this intake flow.

## Run the two services

Use Node 24 and Python 3.13. From the repository root on Windows, start the dashboard first so it applies the SQLite migrations. For a synthetic workspace, use an isolated database in the dashboard shell.

```powershell
$env:DB_PATH = Join-Path $PWD 'var/whatsapp-demo.sqlite'
$env:DELTA_DEMO = '1'
node services/api/server.mjs
```

In another PowerShell session at the repository root, use the same absolute database path and supply the webhook environment variables through your shell or deployment secret manager.

| Variable | Value |
| --- | --- |
| `DB_PATH` | Same SQLite file as the dashboard. SQLite needs a local filesystem shared by the two processes. |
| `WHATSAPP_APP_SECRET` | App Secret from Meta App Dashboard → App settings → Basic. |
| `WHATSAPP_VERIFY_TOKEN` | A random value you generate. Use the same value in Meta's callback settings. |
| `WHATSAPP_PHONE_NUMBER_ID` | The test Phone Number ID in Meta API Setup. |
| `WHATSAPP_CASE_ORG` | Destination organization ID. Use `demo` for the isolated example. |
| `WHATSAPP_CASE_DEPARTMENT` | Exact department name. Use `Sanitation` for the isolated example. |
| `WHATSAPP_GRAPH_API_VERSION` | A supported Graph API version for outbound calls, such as `v27.0`. |
| `WHATSAPP_ACCESS_TOKEN` | Access token for outbound calls with `whatsapp_business_messaging` and access to the sender asset. |

The final two variables are needed by the outbound client. Keep secrets out of source control and chat. Configure proxy logging to omit query strings for the verification endpoint, because Meta sends the verify token in the query string.

```powershell
$env:DB_PATH = Join-Path $PWD 'var/whatsapp-demo.sqlite'
py -3.13 -m venv var/whatsapp-venv
& var/whatsapp-venv/Scripts/python.exe -m pip install -r services/whatsapp/requirements.txt
& var/whatsapp-venv/Scripts/python.exe -m uvicorn services.whatsapp.app:create_app --factory --host 127.0.0.1 --port 8788 --no-access-log
```

## Connect Meta's MCP

Add this server to `~/.codex/config.toml`, restart Codex, and complete Meta OAuth when prompted using an account authorized for the app and business. Meta's integration skill also uses the optional `devtools` server at `https://mcp.facebook.com/devtools`. The webhook and outbound client use Cloud API independently of MCP. [Meta's Codex setup](https://github.com/meta/agentic-tools#codex)

```toml
[mcp_servers.whatsapp_business_tools]
url = "https://mcp.facebook.com/whatsapp_business_tools"
```

## Complete the Meta test

1. **Infrastructure authorization.** Approve a public HTTPS deployment or tunnel that routes `/webhooks/whatsapp` to port 8788. Keep the dashboard on its authenticated route. If using the demo workspace, keep its dashboard local.
2. **Meta app access.** An authorized app administrator supplies the App Secret to the runtime and copies the test Phone Number ID from **Use cases → Customize → API Setup**. Add and verify your personal WhatsApp number as a test recipient if it is not already listed. [Meta Cloud API Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
3. **Meta configuration authorization.** Under **Use cases → Customize → Configuration**, save the HTTPS callback URL with the matching verify token and subscribe to the `messages` field. Confirm the app is subscribed to the test WhatsApp Business Account. If a separate account subscription is needed, use the `/{WABA_ID}/subscribed_apps` operation with authorized account access. [Meta webhook setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint) · [Meta account subscription reference](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/)
4. **Personal WhatsApp action.** Send a uniquely identifiable synthetic grievance from your personal WhatsApp to the Meta test number. If you need to establish the test chat first, authorize sending the `hello_world` template from API Setup and reply with your synthetic grievance. In the dashboard, sign into the configured organization and department, open **Cases**, and refresh. Record success when exactly one case appears with the matching text. [Meta Cloud API Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
5. **Optional outbound test authorization.** Generate an access token for the app and sender asset, then authorize the exact message and recipient. Use `WhatsAppCloudAPI.send_text` during the 24-hour customer service window or `send_template` with an approved template as applicable. Graph acceptance and delivery are separate outcomes. [Meta sending guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)

## Local verification

```powershell
& var/whatsapp-venv/Scripts/python.exe -m unittest services.whatsapp.test_whatsapp -v
node --test packages/evaluation/workflow.test.mjs
```

The WhatsApp tests use synthetic signatures, an isolated SQLite database, the real Node dashboard API, and a mocked Graph transport. Live Meta verification and delivery require the authorized setup above.
