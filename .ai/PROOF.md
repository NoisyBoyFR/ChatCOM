# ChatCOM operational proof

## Real proof — 2026-08-20

The standalone relay was exercised against the authenticated local Codex
runtime from the ChatCOM checkout. Only bounded terminal evidence is recorded
here; prompts, model responses, credentials, server messages and stacks are not
persisted.

### Codex SDK lifecycle

```text
SDK_DIAGNOSTIC kind=SUCCESS code=OK stage=TERMINAL_COMPLETED threadStarted=true turnStarted=true terminal=COMPLETED streamClosed=true processExited=true tempRemoved=true cleanup=CONFIRMED
```

### Complete Work ↔ Codex relay

```text
WORK_CODEX_RELAY kind=SUCCESS code=OK transmissions=3 cleanup=CONFIRMED
```

The run stopped before a second Codex mission as required.

### App Server fallback

```text
DIFFERENTIAL failure=NONE modelSelectedFromList=true minimalTurn=SUCCEEDED schemaTurn=SUCCEEDED minimalCleanup=CONFIRMED schemaCleanup=CONFIRMED clientClosed=true tempRemoved=true
```

### Independent deterministic review

- build: passed;
- typecheck: passed;
- tests: 66 passed, 0 failed;
- example configuration validation: passed;
- package dry-run: passed;
- production dependency audit: 0 known vulnerabilities.

Operational status remains conditional on preserving the safety model defined
in `AGENTS.md` and on re-running appropriate real proof after future runtime or
relay changes.

## Real MCP bridge proof — 2026-08-21

The v0.3.0 MCP server was started as a real STDIO child process. An MCP client
listed the two tools, validated a temporary configuration, invoked the complete
authenticated relay, received all three structured envelopes, and closed the
server. Model content was inspected only as private protocol data and was not
printed or persisted by the diagnostic.

```text
CHATCOM_MCP_PROOF kind=SUCCESS code=OK tools=2 transmissions=3 cleanup=CONFIRMED processExited=true tempRemoved=true
```

### v0.3.0 deterministic review

- build: passed;
- typecheck: passed;
- tests: 71 passed, 0 failed;
- real STDIO validation process: passed;
- example configuration validation: passed;
- package dry-run: passed;
- production dependency audit: 0 known vulnerabilities;
- MCP tool failures and ordinary text results: bounded and content-free;
- relay target sandbox: read-only with model-side approvals disabled;
- MCP host approval: required per real relay call by the supplied configuration.

## Local v1 convergence verification — 2026-08-21

The local convergence changes were validated without invoking a real relay or
external diagnostic. The strict MCP contract, cancellation propagation,
version-derived server metadata, unified verification gate, and documentation
updates are covered by deterministic tests and `npm run verify`.

This is not a new real-operation claim. A new MCP proof remains required after
the local changes are reviewed and explicitly authorized.

## Real v1 release-candidate MCP proof — 2026-08-21

The `1.0.0-rc.1` candidate was exercised once through the real local MCP STDIO
server and authenticated Codex runtime after the strict contract and bounded
cancellation changes passed deterministic review. The run remained read-only,
performed exactly three transmissions, stopped before a second Codex mission,
and confirmed process and temporary-file cleanup. No prompt, model response,
credential, server message, or stack trace was printed or persisted.

```text
CHATCOM_MCP_PROOF kind=SUCCESS code=OK tools=2 transmissions=3 cleanup=CONFIRMED processExited=true tempRemoved=true
```

### `1.0.0-rc.1` deterministic review

- build: passed;
- typecheck: passed;
- tests: 83 passed, 0 failed;
- example configuration validation: passed;
- package dry-run: 31 files;
- production dependency audit: 0 known vulnerabilities;
- diff whitespace validation: passed;
- real proof attempts used: 1 of the authorized maximum of 2;
- runtime code was not changed after the successful proof.

## Desktop RC.5 updater candidate — local only

The updater candidate has not been published and has not performed a real
update download. Deterministic tests cover the main-process controller,
Squirrel first-run delay, six-hour schedule, mutex, downgrade and channel
guards, typed IPC, relay cleanup gating, and fail-closed unsigned policy.
Windows packaging metadata records `Setup.exe`, the full `.nupkg`, `RELEASES`,
hashes, channel, publisher, timestamp, and signature state. The current local
state is `UNSIGNED`, so public automatic updates remain disabled. No new MCP,
Codex, or relay proof was run for this work.

## RC.5 WORK_HOST bridge readiness — no real proof claimed

The RC.5 implementation adds the two-call `WORK_HOST` MCP protocol. Deterministic
tests cover the validated MISSION, one Codex REPORT, host NEXT_PROMPT, exact
three-transmission accounting, replay and route rejection, expiration,
cancellation, bounded diagnostics, and confirmed or failed cleanup. The
legacy local route remains explicitly `LOCAL_SIMULATION`.

The current Codex session does not expose the new `chatcom_work_open` and
`chatcom_work_complete` tools as a genuine WORK host. No false relay was
started. The candidate status is `READY_FOR_WORK_PROOF`; a genuine MCP host
must perform the single authorized real proof after MCP reload.

## RC.5 CODEX_REPORT pre-proof correction — 2026-08-22

The first genuine WORK_HOST preflight reached ChatCOM and stopped during the
single CODEX_REPORT turn with `SDK_TURN_FAILED`; one transmission completed and
cleanup was confirmed. No new real relay is claimed for this correction.

The deterministic correction replaces route `const` constraints with
SDK-compatible singleton `enum` constraints, preserves the allowlisted SDK
diagnostic through `WorkHostBridge`, and checks MCP success results for JSON
serializability. Synthetic tests cover the REPORT route, SDK failure metadata,
bounded MCP output, cleanup priority, cancellation, timeout, late streams,
replay, and the no-second-mission invariant.

## Real RC.5 WORK_HOST proof — 2026-08-22

The genuine MCP host used the reloaded `chatcom_rc5_aab8e81` instance and
completed one read-only exchange. The host sent the first `WORK_HOST/MISSION`,
received and analyzed the `CODEX_LOCAL/REPORT`, then sent the correlated
`WORK_HOST/NEXT_PROMPT`. Exactly three transmissions completed; the exchange
stopped before a second Codex mission and cleanup was confirmed.

- communication mode: `REAL_WORK_HOST`;
- route: `MISSION → REPORT → NEXT_PROMPT`;
- transmissions: `3/3`;
- security: `READ_ONLY`;
- cleanup: `CONFIRMED`;
- Codex authentication: managed by the local Codex host;
- no prompts, model responses, credentials, cookies, server messages, stack
  traces, or thread identifiers were persisted or exposed.

This records the already authorized proof; no additional relay was run by the
release-readiness work.

## RC.5 signature and packaging guard — 2026-08-22

This guard changed no signing identity and made no signing request. The future
public Authenticode subject remains an external build variable; an empty,
malformed, or inconsistent value disables updates. A signed build will embed
the approved value in the Desktop main bundle and compare it exactly with the
installed binary subject and the manifest publisher.

Two fresh isolated Windows builds had identical structure and sizes:

- Setup: `279708160` bytes;
- full Squirrel package: `279442587` bytes;
- unpacked application: `782975400` bytes;
- Electron `ChatCOM.exe`: `235534336` bytes;
- `app.asar`: `17702645` bytes;
- `app.asar.unpacked`: `391132092` bytes;
- Codex runtime: exactly one `codex.exe`, `297362224` bytes;
- forbidden recursively included output paths: `0`.

The previous `410684928`-byte Setup and `410895942`-byte full package carried
an additional `resources/@openai` tree beside the asar-unpacked runtime; the
new package removes that duplication and safely cleans only a verified output
directory. These are local unsigned validation artefacts, not a new WORK proof
or a public update feed.
