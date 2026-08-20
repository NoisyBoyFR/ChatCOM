# ChatCOM decisions

## C-001 — Standalone extraction

**Status:** accepted

ChatCOM is a standalone project extracted from the generic relay built inside FitMyLife. It does not contain FitMyLife product code or product workflow state.

## C-002 — Safety boundary

**Status:** accepted

The default relay remains read-only, uses no model-side approvals, performs exactly three transmissions, and stops before a second Codex mission. User authority is never inferred.

## C-003 — Operational claim

**Status:** accepted — 2026-08-20

Synthetic validation alone does not prove real communication. ChatCOM v0.2.0
is declared operational after a successful authenticated SDK lifecycle proof,
a complete three-transmission Work ↔ Codex relay, a successful App Server
fallback diagnostic, confirmed cleanup and an independent deterministic review.
Future relay or runtime changes require proportionate revalidation before the
operational claim is renewed.

## C-004 — Validated messages returned to callers

**Status:** accepted — 2026-08-20

The programmatic API returns the validated `MISSION`, `REPORT` and
`NEXT_PROMPT` envelopes to its caller so Work can consume the technical report
and prepare corrections. The bounded CLI continues to expose status metadata
only and never prints model content.
