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
