# ChatCOM handoff

ChatCOM contains the reusable Work ↔ Codex communication layer extracted from FitMyLife.

Current state:

- standalone package and CLI created;
- product-specific FitMyLife components excluded;
- read-only security boundary preserved;
- validated `MISSION`, `REPORT` and `NEXT_PROMPT` envelopes returned to API callers;
- 66 deterministic tests, build, typecheck, configuration validation, package dry-run and dependency audit successful;
- authenticated SDK lifecycle, complete three-transmission relay and App Server fallback proven with confirmed cleanup;
- ChatCOM v0.2.0 operational baseline ready for publication.

The next work must begin with the read-only post-publication directive in
`CODEX-CHATCOM-PROMPT.md`. Any later real diagnostic or relay run still requires
explicit authorization for that mission.

## Reprise directive — 2026-08-20

This Codex conversation is attached to the standalone ChatCOM checkout,
tracking its configured `origin` remote.

- Work only in ChatCOM; do not modify FitMyLife.
- Keep the reusable Work ↔ Codex relay independent from product repositories.
- Treat the v0.2.0 publication and its successful GitHub CI as the new baseline.
- Preserve the proven read-only and no-approval safety boundary.
- Use `CODEX-CHATCOM-PROMPT.md` as the single durable Visual Studio Code prompt.
- Require explicit per-mission authorization before future real diagnostics,
  relay executions or Git/GitHub writes.
