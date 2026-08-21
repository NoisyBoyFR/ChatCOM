# ChatCOM

ChatCOM is a reusable local relay for structured communication between a Work review role and a Codex technical role.

[Version française](README.fr.md)

## Current status

The reusable core has been separated from FitMyLife into its own project. Its configuration, message contract, routing, cleanup, bounded diagnostics, Codex SDK adapter, App Server fallback, and synthetic tests are available.

ChatCOM `1.0.0-rc.1` is the release candidate for the bounded local relay. It
adds a strict shared TypeScript/MCP message contract, propagated and bounded
host cancellation, validated relay-session coherence, and a multi-platform CI
matrix to the v0.3.0 STDIO MCP bridge.

The candidate completed a real authenticated MCP STDIO → ChatCOM → Codex → Work
relay with exactly three transmissions and confirmed cleanup. The bounded proof
and earlier runtime evidence are recorded in [`.ai/PROOF.md`](.ai/PROOF.md).

The candidate passes 83 deterministic tests, build, typecheck, configuration
validation, package dry-run, and a production dependency audit. CI validates
the same gate on Ubuntu, Windows, and macOS.

## Safety model

- project execution is read-only;
- approvals are disabled;
- the relay stops after three transmissions, before a second Codex mission;
- project, phase, point, mission, and role instructions are configuration values;
- user authority is never inferred;
- terminal diagnostics are bounded and exclude prompts, responses, credentials, server messages, and stacks.

The TypeScript API returns the three validated message envelopes to its caller.
The CLI intentionally prints status metadata only.

The MCP bridge returns full envelopes as structured tool content. Its ordinary
text result remains bounded. `chatcom_run_relay` is annotated as an external,
non-idempotent action so the host can require explicit per-call approval even
though the inspected project remains read-only.

## Requirements

- Node.js 22 or later;
- an authenticated Codex installation usable by the official Codex SDK;
- a local Git project to review.

## Install

```powershell
npm install
npm run build
```

## Configure

Copy `relay.config.example.json` and set the project root and routing fields:

```json
{
  "version": "1.0",
  "project_root": ".",
  "phase": "PHASE-1",
  "point": "POINT-1",
  "mission": "Review the current project state without changing files."
}
```

Validate without starting Codex:

```powershell
node .\dist\portable-cli.js validate --config .\relay.config.example.json
```

Run the relay only after validation and explicit authorization:

```powershell
node .\dist\portable-cli.js run --config .\relay.config.example.json --timeout-ms 600000
```

## TypeScript API

```ts
import { loadRelayConfig, runPortableRelay } from "chatcom";

const config = await loadRelayConfig("./relay.config.json");
const result = await runPortableRelay(config, { timeoutMs: 600_000 });

const [mission, report, nextPrompt] = result.relay.messages;
// Consume validated content programmatically; do not print it in bounded diagnostics.

const cancellation = new AbortController();
const cancellable = runPortableRelay(config, { signal: cancellation.signal });
// Call cancellation.abort() from the host when the mission must stop.
```

## MCP bridge

Build ChatCOM, then copy [`.codex/config.toml.example`](.codex/config.toml.example)
into a trusted Codex configuration and replace the path placeholders. Restart
the Codex host after changing MCP configuration.

The server exposes exactly two tools:

- `chatcom_validate_config`: validates configuration without starting Codex;
- `chatcom_run_relay`: runs one authorized three-transmission relay and returns
  `MISSION`, `REPORT`, and `NEXT_PROMPT` as structured content.

Keep `chatcom_run_relay` in `prompt` approval mode. MCP protocol output is the
intended private Work-facing transport; it must not be copied into terminal
diagnostics.
If the MCP host cancels a request, the cancellation signal is propagated to the
Codex stream and cleanup is still required before the call can complete.

Start the STDIO server directly when needed:

```powershell
npm run build
npm run mcp
```

## Development

```powershell
npm run build
npm run typecheck
npm test
npm run validate-config
npm run audit
npm run verify
```

`npm run verify` also runs the production dependency audit and package dry-run.
The diagnostic commands can contact a real Codex runtime. They must not be executed as part of ordinary unit tests or without explicit authorization.

`1.0.0-rc.1` is not a formal release. Creating a tag, GitHub Release, or npm
publication requires separate explicit authorization. See
[`RELEASING.md`](RELEASING.md) for the gated release procedure.

## Visual Studio Code workflow

Use [`CODEX-CHATCOM-PROMPT.md`](CODEX-CHATCOM-PROMPT.md) as the single durable
prompt for the Codex IDE extension. It drives one autonomous mission through
inspection, implementation, verification, correction, closure, and one final
report to Work.

## Origin

ChatCOM was extracted from the generic Work ↔ Codex relay developed inside FitMyLife. FitMyLife product code, PC compatibility rules, web UI, product phases, and historical workflow state are not part of this repository.
