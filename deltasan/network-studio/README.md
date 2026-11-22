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

Choose **New agent** in Studio to open the chat builder. Describe the goal, the people who will use it, the inputs or tools available, and the expected outcome. Review the brief, change a field if needed, then say **build it**. The builder returns a Playground link when it saves the network. Playground waits for the runtime to register it and then opens its chat and graph.

The **Deployments** tab at `/deploy` publishes a saved Studio network or accepts an uploaded portable HOCON file. Local deployments run in the shared DeltaSAN runtime. The map groups them by organization and shows each agent's connections. Start or stop a deployed copy from **Manage deployments**. Registry files and deployment state live in `registries/city`.

`start.ps1` starts the local publishing service on port 45187. Use `./start-city.ps1` to start it separately. The UI container uses `PUBLISH_SERVER_URL=http://127.0.0.1:45187`, `ENABLE_PUBLISHING=true` and `DELTA_LOCAL_CITY=true`. The server-side `PUBLISH_BEARER_TOKEN` comes from the machine-local `NeuroNetworkStudio/city-token` file under Local AppData. For another publisher, configure its URL and its own credential on the server. Model keys entered in Studio use the existing browser-session settings.

## EC2 deployment

The saved release at commit `000218d911a217210e8e210ed846b45a2e041ca7` runs on `i-0fe03ef291324de92` in `us-west-2`. Open [the public HTTPS Studio](https://32.189.49.149/multiAgentAccelerator?network=agent_network_designer) and sign in with the Studio credentials. The model, publisher and runtime services remain behind the HTTPS gateway. For access over a private tunnel from a Windows client with AWS CLI, Session Manager plugin, authorized profile and available local ports, run `./connect-ec2.ps1 Studio` and `./connect-ec2.ps1 Publisher` in separate terminals. Open the Accelerator at `http://127.0.0.1:45174/multiAgentAccelerator`. Use `CommandCentre` to access the companion app on 8787 or `NSFlow` for the native studio on 45173. Files and generated registries live on the instance's encrypted EBS volume.

## Live voice and customer chat

Choose **Start voice** in Studio or in a deployed customer chat and grant microphone access. The worker identifies English, Hindi, or Telugu on each spoken turn. After a pause the turn goes to the active network, and its reply plays aloud. Speak during playback to interrupt it. **End session** releases the microphone. Capture requires HTTPS or loopback.

The worker uses multilingual Whisper Tiny for language identification and English transcription, INT8 IndicConformer for Hindi and Telugu, and system voices or eSpeak NG for playback. Set `DELTA_VOICE_URL` on the UI to the private worker and mount the verified IndicConformer model folders at `/hi` and `/te` and Whisper assets at `/asr` with read access for its container user (UID/GID 1000).

After publishing a network, open **Deployments → Network list** for its customer chat link and the **Embed chatbot** iframe snippet. Each deployment has its own URL and agent roster. Customer conversations keep their own history. In **Playground**, operators can require approval before every customer turn for a deployment. Customers can also request review of an individual turn. Approving runs the waiting message and returns its answer to the customer. Declining closes that turn. This gate operates before a turn, at the point where the message would be sent to the network.

In the EC2 installation, Studio uses HTTPS port 443. Customer web apps use the same IP on HTTPS port 8443 and can be opened without Studio credentials. The publisher uses `DELTA_CUSTOMER_ORIGIN` for these links. The customer gateway uses `DELTA_STUDIO_URL`, `DELTA_RUNTIME_URL`, `DELTA_CONVERSATIONS_DB`, and the same private `DELTA_CITY_TOKEN` as the publisher. The UI reaches the customer gateway through `DELTA_CUSTOMER_SERVICE`. For embedded voice, grant microphone access to the iframe using the generated snippet.
