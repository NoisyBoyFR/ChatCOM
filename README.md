# ChatCOM

ChatCOM is a reusable local relay for structured communication between a Work review role and a Codex technical role.

[Version française](README.fr.md)

## Current status

The reusable core has been separated from FitMyLife into its own project. Its configuration, message contract, routing, cleanup, bounded diagnostics, Codex SDK adapter, App Server fallback, and synthetic tests are available.

ChatCOM is not yet declared operational for unattended real use. A successful real end-to-end relay and an independent review are still required.

The extracted standalone baseline currently passes 66 deterministic tests, plus build, typecheck, configuration validation, and package dry-run checks.

## Safety model

- project execution is read-only;
- approvals are disabled;
- the relay stops after three transmissions, before a second Codex mission;
- project, phase, point, mission, and role instructions are configuration values;
- user authority is never inferred;
- terminal diagnostics are bounded and exclude prompts, responses, credentials, server messages, and stacks.

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
```

## Development

```powershell
npm run build
npm run typecheck
npm test
npm run validate-config
```

The diagnostic commands can contact a real Codex runtime. They must not be executed as part of ordinary unit tests or without explicit authorization.

## Origin

ChatCOM was extracted from the generic Work ↔ Codex relay developed inside FitMyLife. FitMyLife product code, PC compatibility rules, web UI, product phases, and historical workflow state are not part of this repository.
