# ChatCOM

> A supervised, read-only communication bridge between a local WORK review role and Codex.

[![CI](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml/badge.svg)](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NoisyBoyFR/ChatCOM?include_prereleases&label=release)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**English** · [Français](README.fr.md) · [Changelog](CHANGELOG.md)

[![Download ChatCOM Desktop](https://img.shields.io/badge/Download-ChatCOM_Desktop_for_Windows-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe)

**Current local candidate:** `1.0.0-rc.4` · Windows x64 · unsigned pre-release; automatic public updates are disabled until signed artifacts are available

## What is ChatCOM?

ChatCOM coordinates a bounded exchange between two local roles:

```text
WORK_LOCAL ── MISSION ──▶ CODEX_LOCAL
WORK_LOCAL ◀── REPORT ─── CODEX_LOCAL
WORK_LOCAL ─ NEXT_PROMPT ▶ CODEX_LOCAL
```

The user selects a project and mission, watches the exchange, and keeps final authority. Each relay is read-only, contains exactly three validated transmissions, stops before a second Codex mission, and requires confirmed cleanup.

`WORK_LOCAL` is an internal review role. It is not a remote ChatGPT Work session and ChatCOM does not impersonate the user.

## Desktop highlights

- guided project, phase, point, mission, timeout, and cycle configuration;
- visual WORK ↔ Codex timeline with pause, resume, stop, and decision states;
- French, English, Simplified Chinese, and Russian offline translations;
- System, Light, and Dark themes;
- normal, maximized, and fullscreen modes (`F11` / `Escape`);
- text-size, reduced-motion, and timeline auto-scroll preferences;
- settings use a temporary draft: `Save` persists and closes, while `Cancel` discards changes;
- no-model preflight for the runtime, authentication, project, and read-only policy;
- versioned, validated preferences that never store mission or message content;
- bounded diagnostics without prompts, responses, credentials, thread IDs, or stacks.

## Download and install on Windows

The public download links below still point to the last published RC.3. RC.4 is
local validation work only: it must not be published or used for automatic
updates while its Windows artifacts are unsigned. Stable uses Electron's
main-process `autoUpdater` with the official public
`update.electronjs.org/NoisyBoyFR/ChatCOM` source. Preview uses a separate
static Squirrel feed under the controlled GitHub Pages layout
`/preview/win32/x64`; that feed is designed and tested locally but is not
deployed here. The updater checks after the Squirrel first-run window and then
every six hours, downloads in the background, and never forces a restart during
a relay. Settings expose an enabled switch and Stable/Preview channel; a
restart is offered only after confirmed cleanup.

1. Download **[ChatCOM-Desktop-1.0.0-rc.3-Setup.exe](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe)**.
2. Optionally download [SHA256SUMS.txt](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/SHA256SUMS.txt) and verify the installer.
3. Run the installer for the current Windows user.
4. Start **ChatCOM Desktop**, select a trusted local Git project, then complete the guided configuration.

The installer requires no administrator rights, does not change `PATH`, does not configure MCP, and does not start Codex or a relay automatically. It is currently **unsigned**; verify its checksum and continue only if you trust this repository and release.

The complete machine-readable build information is available in [desktop-build-manifest.json](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/desktop-build-manifest.json).

## Requirements

- Windows 10 or Windows 11, x64, for ChatCOM Desktop;
- an authenticated Codex account available to the bundled Codex runtime;
- a trusted local Git project to inspect;
- Node.js 22 or later only for CLI, MCP, or source development workflows.

## Safety model

- inspected projects remain read-only;
- Codex approvals are disabled inside the relay;
- every envelope, route, identifier, date, enum, and UTF-8 limit is validated;
- cleanup must be confirmed before another cycle may start;
- product decisions and side effects return control to the user;
- the Electron renderer is sandboxed with Node integration disabled;
- IPC channels and senders are allowlisted and validated;
- diagnostics expose bounded status metadata only.

The authenticated MCP relay has completed a real three-transmission proof with confirmed cleanup. The RC.4 updater architecture, RC.3 Desktop interface, localization, settings, and installer are covered by 123 deterministic tests and multi-platform CI; a separate real GUI relay proof has not yet been claimed. See [`.ai/PROOF.md`](.ai/PROOF.md).

## Developer quick start

```powershell
npm ci
npm run verify
npm run desktop:dev
```

Build the Windows installer:

```powershell
npm run desktop:make
```

The expected installer is:

```text
out-desktop/make/squirrel.windows/x64/ChatCOM-Desktop-1.0.0-rc.4-Setup.exe
```

`npm run verify` performs the build, core and Desktop typechecks, 123 deterministic tests, example configuration validation, production dependency audit, and npm package dry-run. Diagnostic commands may contact a real Codex runtime and require explicit authorization.

## CLI configuration

Copy `relay.config.example.json` and configure the project route:

```json
{
  "version": "1.0",
  "project_root": ".",
  "phase": "TESTS",
  "point": "FINAL_REVIEW",
  "mission": "Review the current project state without changing files."
}
```

Validate without starting Codex:

```powershell
node .\dist\portable-cli.js validate --config .\relay.config.example.json
```

Run only with explicit user authorization:

```powershell
node .\dist\portable-cli.js run --config .\relay.config.example.json --timeout-ms 600000
```

## MCP bridge

ChatCOM exposes two STDIO MCP tools:

- `chatcom_validate_config` validates configuration without starting Codex;
- `chatcom_run_relay` runs one authorized, bounded relay.

Build ChatCOM, copy [`.codex/config.toml.example`](.codex/config.toml.example) into a trusted Codex configuration, replace the placeholders with absolute paths, and restart the MCP host. Keep the relay tool in prompt-approval mode.

## Project resources

- [French homepage](README.fr.md)
- [Changelog](CHANGELOG.md)
- [Release procedure](RELEASING.md)
- [Operational proof](.ai/PROOF.md)
- [Durable Codex prompt](CODEX-CHATCOM-PROMPT.md)
- [RC.3 pre-release](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)

## Origin

ChatCOM was extracted from the generic WORK ↔ Codex relay developed inside FitMyLife. FitMyLife product code and workflow state are not part of this repository.
