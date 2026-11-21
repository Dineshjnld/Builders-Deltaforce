# Agent networks

In Workflow builder choose **Agent network** as the execution strategy. The starter has two specialists working in parallel. The final editor receives both drafts. Expand a specialist to edit its instructions, direct context fields and predecessor IDs. Select a previous published network to start from that definition. Export and import use Studio's version 1 JSON schema. Each publication creates a new immutable workflow version. The export contains the specialist network only. The department sets its own SOP, required fields and approver when publishing.

The server validates identifiers, dependencies, permitted direct inputs, cycles and the final handoff. Each network supports up to six specialists. The pinned LangGraph.js runtime schedules independent work and joins dependent branches. A failed branch skips its dependents. Each model request targets the private inference service. The workflow records intermediate drafts, selected direct inputs, dependencies, outcomes, and timing. An agent may receive information indirectly in a predecessor's draft. Department administrators should review the full dependency path before publishing.

## MCP host configuration

In Connections, issue a credential under **Agent networks · MCP**. Only a department administrator can issue or revoke it. It expires after 30 days. Install the locked Node dependencies in services/api. Configure a local MCP host with command `node` and the absolute path to `services/api/network-mcp.mjs` as its argument. Supply the credential as `STUDIO_NETWORK_KEY` through the host's secret store. `STUDIO_LOCAL_PORT` defaults to 8787. Use 8790 for the pilot stack.

Call `list_networks` for published version IDs and required fields. Call `invoke_network` with a policy ID, a stable request ID and evidence. Optional district context also requires a state. The response contains the run ID, policy ID and officer review status. Replaying a completed request returns the same receipt. A concurrent duplicate can return a conflict while work is running. Changing the evidence or policy under a previously committed ID returns a conflict. The connector has no capability to approve, publish, read raw run histories or send messages.

The local model runtime admits two concurrent network runs per department, eight per Studio process and up to three scheduled nodes per graph at once. Database commits persist completed runs and review decisions. An interrupted process can require inference to run again before a receipt exists. Hosting multiple application replicas requires shared admission control and production storage design.

## Framework selection

| Reference | Design choice |
|---|---|
| Cognizant Neuro-SAN Studio and the Open Agentic Web Challenge | Reusable, declarative networks informed the builder and external discovery interface. The import/export format is Studio JSON. [Neuro-SAN guide](https://github.com/cognizant-ai-lab/neuro-san-studio/blob/main/docs/user_guide.md) · [Challenge brief](https://cognizant-agenticweb.devpost.com/) |
| LangGraph.js | Installed as the execution engine for published networks. Its graph API maps specialist dependencies and joins to executable nodes and edges. [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) |
| OpenAI Agents SDK | The optional JavaScript example uses the official SDK's stdio MCP client to discover or invoke local networks. Studio owns inference and the approval record. [Official SDK](https://github.com/openai/openai-agents-js) |
| Google ADK and Strands | Evaluated as possible hosts for departments using Gemini or Amazon Bedrock. Cloud model access and department data egress require separate deployment decisions. [Google ADK](https://github.com/google/adk-python) · [Strands](https://github.com/strands-agents/harness-sdk) |

## Private pilot deployment

Use the standalone `compose.pilot.yaml` with its own project and data volume. It runs the core Studio and private local model. Demo credentials, open signup and the unofficial WhatsApp demo are excluded. Provision a bootstrap JSON file outside source control with organization, department, email and a random password of at least 16 characters. Restrict the file to deployment administrators. Set `STUDIO_BOOTSTRAP_PATH` to its path and `STUDIO_MODEL_IMAGE` to the tested digest from the [Studio guide](studio.md). Place the verified GGUF model at the documented path.

    docker compose -f compose.pilot.yaml up -d --build --wait

Terminate HTTPS in the department's reverse proxy and forward to 127.0.0.1:8790. The API uses secure session cookies. Protect and back up the persistent data volume. For release qualification run the documented [governance review](governance.md), restore a backup, load-test the department's expected concurrency, evaluate actual SOPs and languages, and validate identity and incident-response integrations.

## Verification

    node --test packages/evaluation/*.test.mjs
    node scripts/verify-studio.mjs --network
    node scripts/verify-network-mcp.mjs

To exercise the optional OpenAI Agents SDK client, install its separate locked dependencies and run the following verification. The verification creates a synthetic department, issues a temporary credential and submits its first network run through the SDK. For normal use, the example lists networks by default and accepts invocation JSON on standard input when given the argument `invoke`.

    npm ci --prefix examples/agents-sdk --ignore-scripts
    node scripts/verify-network-mcp.mjs --agents-sdk

The latter two commands exercise the local synthetic demo, creating records. The MCP check provisions its own department and revokes its temporary credential.
