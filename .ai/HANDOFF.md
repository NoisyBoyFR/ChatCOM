# ChatCOM handoff

## v1 release-candidate note

ChatCOM `1.0.0-rc.1` includes strict shared TypeScript/MCP output validation,
propagated and bounded host cancellation, validated session coherence, a unified
verification gate, and an Ubuntu/Windows/macOS CI matrix. One authorized real
MCP proof succeeded with exactly three transmissions and confirmed cleanup.

ChatCOM contains the reusable Work ↔ Codex communication layer extracted from FitMyLife.

Current state:

- standalone package and CLI created;
- product-specific FitMyLife components excluded;
- read-only security boundary preserved;
- validated `MISSION`, `REPORT` and `NEXT_PROMPT` envelopes returned to API callers;
- local STDIO MCP bridge exposes focused configuration validation and authorized relay tools;
- MCP relay results return the three envelopes as structured private tool content while ordinary text remains bounded;
- accurate MCP annotations distinguish pure validation from the external, non-idempotent Codex relay call;
- 83 deterministic tests, build, typecheck, configuration validation, package dry-run and dependency audit successful;
- authenticated SDK lifecycle, complete three-transmission relay and App Server fallback proven with confirmed cleanup;
- real MCP STDIO → ChatCOM → Codex → Work proof succeeded with confirmed process and temporary-file cleanup;
- ChatCOM v0.2.0 is formally tagged and released; v0.3.0 is the operational MCP baseline; `1.0.0-rc.1` is the proven release candidate.

The next work must begin with the `1.0.0-rc.1` read-only post-merge directive in
`CODEX-CHATCOM-PROMPT.md`. Every later real diagnostic or relay run still
requires explicit authorization for that mission. A formal v1.0 publication is
not authorized by the release-candidate work.

## Reprise directive — 2026-08-21

This Codex conversation is attached to the standalone ChatCOM checkout,
tracking its configured `origin` remote.

- Work only in ChatCOM; do not modify FitMyLife.
- Keep the reusable Work ↔ Codex relay independent from product repositories.
- Treat the formal v0.2.0 release, the v0.3.0 MCP baseline and the proven `1.0.0-rc.1` candidate as immutable history.
- Preserve the proven read-only and no-approval safety boundary.
- Keep the relay tool in explicit per-call approval mode even though project execution is read-only.
- Use `CODEX-CHATCOM-PROMPT.md` as the single durable Visual Studio Code prompt.
- Require explicit per-mission authorization before future real diagnostics,
  relay executions or Git/GitHub writes.
