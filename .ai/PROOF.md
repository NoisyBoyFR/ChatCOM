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
