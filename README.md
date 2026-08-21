# ChatCOM

ChatCOM is a reusable local relay for structured communication between a Work review role and a Codex technical role.

[Version française](README.fr.md)

## Current status

The reusable core has been separated from FitMyLife into its own project. Its configuration, message contract, routing, cleanup, bounded diagnostics, Codex SDK adapter, App Server fallback, and synthetic tests are available.

ChatCOM `1.0.0-rc.3` is the release candidate for the bounded local relay. It
adds a strict shared TypeScript/MCP message contract, propagated and bounded
host cancellation, validated relay-session coherence, and a multi-platform CI
matrix to the v0.3.0 STDIO MCP bridge.

The candidate completed a real authenticated MCP STDIO → ChatCOM → Codex → Work
relay with exactly three transmissions and confirmed cleanup. The bounded proof
and earlier runtime evidence are recorded in [`.ai/PROOF.md`](.ai/PROOF.md).

The candidate passes 83 deterministic tests, build, typecheck, configuration
validation, package dry-run, and a production dependency audit. CI validates
the same gate on Ubuntu, Windows, and macOS.

## ChatCOM Desktop 1.0.0-rc.3

The Windows desktop candidate is a local supervised GUI for the `WORK_LOCAL`
to `CODEX_LOCAL` read-only workflow. It guides project selection and the phase,
point, mission, and cycle limit, then displays the bounded timeline
`MISSION -> REPORT -> NEXT_PROMPT` for each cycle. Pause, resume, stop, bounded
diagnostics, and JSON report export are available from the window.

The unsigned `ChatCOM Setup.exe` is produced by the Windows CI artifact. It
does not require administrator rights, change PATH, or add MCP configuration to
Codex. Preferences are stored only in Electron user data; reset them from the
GUI or uninstall the application through Windows. The supervised project is
never written by the desktop relay, and the renderer cannot run arbitrary
commands. A real Codex proof is not implied by the installer or by synthetic
tests.

Developer commands:

```powershell
npm run desktop:dev
npm run desktop:typecheck
npm run desktop:make
```

`desktop:make` creates the Windows Squirrel installer in `out-desktop`. The
bundled native Codex runtime is included in the Windows package; an authenticated
Codex account is still required to run a relay. The CLI and MCP bridge remain
available separately for hosts that do not use the desktop GUI.

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

### Simple Windows installer

From the repository root or a prepared archive (`dist` must already be built),
install ChatCOM for the current user:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -AddToUserPath
```

The installer uses `%LOCALAPPDATA%\ChatCOM`, requires no administrator
privileges, does not run dependency npm scripts, and starts neither Codex nor
the relay. An Internet connection may be required to fetch dependencies. The
installation provides `chatcom` and `chatcom-mcp`, but does not automatically
add MCP configuration to Codex. Open a new terminal after updating PATH, then
validate the install:

```powershell
chatcom validate --config .\relay.config.example.json
```

Preview the operation without changing anything with `-WhatIf`.

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

`1.0.0-rc.3` is not a formal release. Creating a tag, GitHub Release, or npm
publication requires separate explicit authorization. See
[`RELEASING.md`](RELEASING.md) for the gated release procedure.

## Desktop 1.0.0-rc.3

The Desktop app provides static, offline translations for `fr-FR`, `en-US`,
`zh-CN` (Simplified Chinese), and `ru-RU` (Russian). The first launch follows
the Windows locale when supported; otherwise it uses French. The language can
be changed immediately in Settings and is stored in the versioned Electron
preferences file.

Settings include System/Light/Dark themes, normal/maximized/fullscreen window
mode, Small/Normal/Large text, reduced motion, automatic timeline scrolling,
and safe reset. `F11` toggles fullscreen and `Escape` leaves it. Preferences
contain no mission, message content, diagnostics, tokens, thread IDs, or user
responses. RC.2 preferences are migrated and invalid values return to safe
defaults.

Every configuration field explains whether it is Required, Recommended, or
Optional, gives a beginner-friendly explanation and example, and reports
validation errors next to the field. Start remains disabled until the form and
the read-only no-model preflight are valid.

The Windows installer is `ChatCOM-Desktop-1.0.0-rc.3-Setup.exe`. It is an
unsigned user install, does not modify PATH, does not configure MCP, and does
not start a relay automatically. Download only the GitHub Actions artifact
named `chatcom-desktop-1.0.0-rc.3-windows-x64`; it contains the installer,
`SHA256SUMS.txt`, and `desktop-build-manifest.json`. This is a synthetic build
and packaging result, not a real WORK ↔ Codex proof.

### zh-CN user notes

Select 简体中文 in Settings. Labels, beginner help, validation messages,
preflight, timeline, decisions, reset and export feedback update immediately.
The technical route names and safety code `READ_ONLY` remain unchanged.

### ru-RU user notes

Select Русский in Settings. The same guided fields, explanations, validation,
preflight, timeline, decision, reset and export flows are available in Russian.
The technical route names and safety code `READ_ONLY` remain unchanged.

## Visual Studio Code workflow

Use [`CODEX-CHATCOM-PROMPT.md`](CODEX-CHATCOM-PROMPT.md) as the single durable
prompt for the Codex IDE extension. It drives one autonomous mission through
inspection, implementation, verification, correction, closure, and one final
report to Work.

## Origin

ChatCOM was extracted from the generic Work ↔ Codex relay developed inside FitMyLife. FitMyLife product code, PC compatibility rules, web UI, product phases, and historical workflow state are not part of this repository.
