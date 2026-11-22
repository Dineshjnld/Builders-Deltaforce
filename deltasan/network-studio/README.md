# Network Studio

Open http://127.0.0.1:45173/ while Studio is running. Select **New** for the Agent Network Designer or select **writing_desk** to try the coordinator and copy editor. Generated networks live under registries/generated.

## Start and switch providers

On Windows, the Studio Python environment uses `truststore` for native certificate validation and `httpx[http2]` for the You.com MCP stream. Install these in the Studio environment when setting up a new machine.

Run one of the following from this folder in PowerShell 7, with the previous Studio process stopped. A fresh start loads the selected provider into networks that include config/llm_config.hocon.

    ./start.ps1 -Provider ollama -Model 'qwen2.5:1.5b'
    ./start.ps1 -Provider openai -Model 'gpt-4.1-mini'
    ./start.ps1 -Provider anthropic -Model 'claude-sonnet-4-5'
    ./start.ps1 -Provider gemini -Model 'gemini-2.5-flash'
    ./start.ps1 -Provider compatible -BaseUrl 'http://127.0.0.1:1234/v1' -Model 'your-loaded-model'

The launcher reads OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY or COMPATIBLE_API_KEY according to the selected provider. When the corresponding variable is absent it prompts with masked input. For compatible servers that accept anonymous calls, enter a placeholder. The selected model must be available to your account or local runtime. Delegating networks use tool calls.

## Validate and export

    $ns = "$env:LOCALAPPDATA/NeuroNetworkStudio/venv/Scripts/ns.exe"
    & $ns validate registries/writing_desk.hocon
    & $ns export writing_desk -o exported-writing-desk.hocon

The environment installed on this machine contains neuro-san-studio 0.4.5 and langchain-ollama 1.1.0. The UI listens on loopback port 45173 and Neuro SAN on port 45184.

## Combined Accelerator and deployment console

Open the Accelerator at `http://127.0.0.1:45174/multiAgentAccelerator`. The plus button opens the network designer in the canvas. Its chat results link to the running network and to the deployment form.

The **Deployments** tab at `/deploy` publishes a saved Studio network or accepts an uploaded portable HOCON file. Local deployments run in the shared DeltaSAN runtime. The map groups them by organization and shows each agent's connections. Start or stop a deployed copy from **Manage deployments**. Registry files and deployment state live in `registries/city`.

`start.ps1` starts the local publishing service on port 45187. Use `./start-city.ps1` to start it separately. The UI container uses `PUBLISH_SERVER_URL=http://127.0.0.1:45187`, `ENABLE_PUBLISHING=true` and `DELTA_LOCAL_CITY=true`. The server-side `PUBLISH_BEARER_TOKEN` comes from the machine-local `NeuroNetworkStudio/city-token` file under Local AppData. For another publisher, configure its URL and its own credential on the server. Model keys entered in Studio use the existing browser-session settings.

