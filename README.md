# DELTAFORCE Agent Studio

Chat-driven command centre for designing, editing and running agent networks. Start with the [command centre guide](docs/command-centre.md) and [sample HOCON definition](data/networks/proposal-review.hocon).

## Run locally

See [Agent networks](docs/agent-networks.md) for the network editor, MCP integration and private pilot deployment.

Node 24 is required. From the repository root in PowerShell:

```powershell
npm ci --prefix services/api --ignore-scripts
$env:DELTA_DEMO='1'
node services/api/server.mjs
```

Open http://127.0.0.1:8787/ and choose **Sign in → Open local demo**. The synthetic users are admin@studio.example, officer@studio.example, supervisor@studio.example and auditor@studio.example. Their local demo password is AgentStudio-demo-2026. Department signup creates an isolated workspace. See the Studio guide for the complete Compose stack and voice model setup.

## Verify

```powershell
node --test packages/evaluation/workflow.test.mjs
node packages/evaluation/benchmark.mjs
```

- [Android and deployment](docs/deployment.md)
- [Architecture and implementation coverage](docs/architecture.md)
- [Two-minute demo](docs/demo.md)
- [Evaluation](docs/evaluation.md)
- [Dependency and model notes](docs/models.md)
- [Security](docs/security.md)
- [WhatsApp Cloud API setup and verification](docs/whatsapp.md)

For the local WhatsApp hackathon workflow, see [Evolution API demo](docs/evolution-demo.md).
