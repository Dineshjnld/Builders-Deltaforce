# Command centre

Open the local Studio, sign in and select **New network**. In demo mode, **Open local demo** signs into the synthetic administrator workspace. Describe the desired work and roles. The local model generates a network definition. The server validates and saves its HOCON source and chat history before the frontend draws the graph. Select an agent to inspect its instructions and inputs from other agents.

Use chat to revise the saved network or use the **HOCON** tab to import, edit, validate and download a `.hocon` file. **Test runs** publishes an immutable revision and accepts input for a real local model run. Each run records its source digest, per-agent outputs, timings and final draft. A supervisor can approve or return pending runs. Concurrent edits are checked against the expected draft revision.

## File format and runtime

The coordinator is the first member of the top-level `tools` array. Each agent declares a unique lower-case `name`, a `function.description` role, `instructions` and a list of agents it receives drafts from. Specialists with no incoming dependencies run first. The coordinator combines their drafts. See [the example file](../data/networks/proposal-review.hocon).

The Studio supports a bounded, data-only HOCON profile with objects, arrays, comments, quoted and triple-quoted text, identifiers, equals or colon assignments, and object shorthand. The parser rejects includes, environment substitution, executable tool classes, cycles and unknown references. The HOCON structure follows Neuro-SAN's coordinator and tool conventions. Studio executes the compiled DAG using LangGraph.js and the private llama.cpp model. Arbitrary upstream Neuro-SAN registries can require features outside this profile. [Upstream network example](https://github.com/cognizant-ai-lab/neuro-san-studio/blob/main/registries/basic/music_nerd.hocon)

## Integration

| UI action | Authenticated endpoint | Result |
|---|---|---|
| Generate or revise in chat | POST /api/command/chat | Scoped draft, revision, conversation, source and compiled graph |
| Open a saved network | GET /api/command/{id} | Current source, release and visible runs |
| Save edited HOCON | POST /api/command/save | Validated revision or a parser error |
| Publish | POST /api/command/publish | Immutable HOCON snapshot, SHA-256 digest and policy ID |
| Execute | POST /api/studio/run | Model outputs bound to the published source |
| Approve or return | POST /api/studio/decision | Scoped supervisor decision and audit trail |

The browser and API share one origin. Drafts and releases are stored in the workspace SQLite database. Existing connector records and published policies are preserved. The new command-centre library contains networks authored through the HOCON workflow.
