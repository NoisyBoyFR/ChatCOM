# ChatCOM

> A supervised, read-only communication bridge between a local WORK review role and Codex.

[![CI](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml/badge.svg)](https://github.com/NoisyBoyFR/ChatCOM/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NoisyBoyFR/ChatCOM?include_prereleases&label=release)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11)](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**English** · [Français](README.fr.md) · [Changelog](CHANGELOG.md)

[![Download ChatCOM Desktop](https://img.shields.io/badge/Download-ChatCOM_Desktop_for_Windows-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe)

**Current source candidate:** `1.0.0-rc.6` · Windows x64 · the protected Artifact Signing workflow is ready, but public updates remain disabled until the external identity and certificate profile are configured

## RC.6 publication and signing gate

RC.6 is a source candidate, not a public release. Windows publication is
blocked until the owner completes the SignPath Foundation Open Source Code
Signing application and the protected workflow produces a `SIGNED` manifest.
The workflow is manual, runs only from `main`, cannot create tags or Releases,
and never runs `npm publish`. See [WINDOWS-SIGNING.md](WINDOWS-SIGNING.md),
[CODE-SIGNING-POLICY.md](CODE-SIGNING-POLICY.md), and the
[SignPath application dossier](SIGNPATH-APPLICATION.md).

ChatCOM is distributed under the MIT License with copyright
`Copyright (c) 2026 Alexandre Balladelli`; see [LICENSE](LICENSE),
[PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## What is ChatCOM?

ChatCOM coordinates a bounded exchange between two local roles:

```text
WORK_LOCAL ── MISSION ──▶ CODEX_LOCAL
WORK_LOCAL ◀── REPORT ─── CODEX_LOCAL
WORK_LOCAL ─ NEXT_PROMPT ▶ CODEX_LOCAL

WORK_HOST ── MISSION ──▶ CODEX_LOCAL
WORK_HOST ◀── REPORT ─── CODEX_LOCAL
WORK_HOST ─ NEXT_PROMPT ──▶ CODEX_LOCAL
```

The user selects a project and mission, watches the exchange, and keeps final authority. Each relay is read-only, contains exactly three validated transmissions, stops before a second Codex mission, and requires confirmed cleanup.

`WORK_LOCAL` is an internal review role. It is not a remote ChatGPT Work session and ChatCOM does not impersonate the user.

The `WORK_HOST` route is the only route eligible for a real WORK ↔ Codex proof. The MCP host manages WORK authentication; ChatCOM never reads cookies, tokens, API keys, or browser profiles. The legacy `WORK_LOCAL` route is `LOCAL_SIMULATION` and is never reported as a real host proof.

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
- Desktop communication status distinguishes `WORK_HOST`, `CODEX_LOCAL`, `USER`, `REAL_WORK_HOST`, and `LOCAL_SIMULATION`.
- RC.6 supports an explicit temporary conversation or an exact local Codex binding; bound conversations are resumed by UUID and preserved after cleanup. See [persistent bindings](PERSISTENT-BINDINGS.md).

## Download and install on Windows

The public download links below still point to the last published RC.3. RC.6 is
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

The manual SignPath Foundation Windows signing workflow and its one-time
GitHub owner setup are documented in [WINDOWS-SIGNING.md](WINDOWS-SIGNING.md).
It creates only a temporary signed validation artifact and cannot publish a
tag or Release.

The product name is `ChatCOM`; the Authenticode publisher is the exact subject
assigned later by SignPath and is never guessed or hard-coded. During a future
signed build, `SIGNPATH_PUBLISHER_SUBJECT` is supplied as public build input and
embedded immutably in the Desktop main bundle. The updater compares that
embedded value exactly with the installed binary subject and the manifest
publisher; missing, malformed, or different values disable updates. The local
Preview validator refuses activation unless the manifest is `SIGNED`,
timestamped, hashed, and carries the same configured subject.

Desktop packaging starts from a verified, targeted clean output directory. The
packaged application contains exactly one `codex.exe`; the old duplicate
`resources/@openai` copy is no longer added beside the asar-unpacked runtime.

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

The authenticated MCP relay has completed a real three-transmission proof with confirmed cleanup. The RC.6 updater architecture, Desktop interface, localization, settings, installer, SignPath guards, and WORK_HOST bridge are covered by the deterministic test suite and multi-platform CI. The real WORK_HOST proof is recorded in [`.ai/PROOF.md`](.ai/PROOF.md).

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
out-desktop/make/squirrel.windows/x64/ChatCOM-Desktop-1.0.0-rc.6-Setup.exe
```

`npm run verify` performs the build, core and Desktop typechecks, deterministic tests, example configuration validation, production dependency audit, and npm package dry-run. Diagnostic commands may contact a real Codex runtime and require explicit authorization.

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

ChatCOM exposes the RC.6 bridge tools plus bounded local binding-management tools:

- `chatcom_validate_config` validates configuration without starting Codex;
- `chatcom_work_open` accepts one validated `WORK_HOST` MISSION, runs one read-only Codex report, and returns `REPORT` while leaving the exchange open;
- `chatcom_work_complete` accepts exactly one `WORK_HOST` `NEXT_PROMPT`, deletes an ephemeral thread or preserves a bound thread, closes the client, and confirms cleanup;
- `chatcom_binding_create`, `chatcom_binding_validate`, `chatcom_binding_list`, `chatcom_binding_disable`, and `chatcom_binding_remove` manage exact local bindings without reading conversation history;
- `chatcom_run_relay` remains a compatibility tool named `LOCAL_SIMULATION`, not a real WORK proof.

The real protocol is:

1. The genuine WORK host calls `chatcom_work_open` with `MISSION`.
2. ChatCOM returns `REPORT`; WORK analyzes it in the host session.
3. The same host calls `chatcom_work_complete` with `NEXT_PROMPT`.

The final response is successful only with exactly three transmissions and `cleanup=CONFIRMED`. A missing WORK host is not replaced by Codex and yields `READY_FOR_WORK_PROOF`.

The default is `EPHEMERAL`. A `binding_id` enables `PERSISTENT_BOUND` only after exact UUID and canonical project validation. Titles never select conversations, and full thread IDs never appear in bounded output. See [PERSISTENT-BINDINGS.md](PERSISTENT-BINDINGS.md).

Build ChatCOM, copy [`.codex/config.toml.example`](.codex/config.toml.example) into a trusted Codex configuration, replace the placeholders with absolute paths, and restart the MCP host. Keep the relay tool in prompt-approval mode.

## Project resources

- [French homepage](README.fr.md)
- [Changelog](CHANGELOG.md)
- [Release procedure](RELEASING.md)
- [Operational proof](.ai/PROOF.md)
- [Durable Codex prompt](CODEX-CHATCOM-PROMPT.md)
- [Persistent Codex bindings](PERSISTENT-BINDINGS.md)
- [License](LICENSE)
- [Privacy notice](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)
- [Windows signing policy](CODE-SIGNING-POLICY.md)
- [SignPath application dossier](SIGNPATH-APPLICATION.md)
- [RC.3 pre-release](https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3)

## Origin

ChatCOM was extracted from the generic WORK ↔ Codex relay developed inside FitMyLife. FitMyLife product code and workflow state are not part of this repository.
