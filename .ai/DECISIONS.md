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

## C-005 — Local MCP bridge

**Status:** accepted — 2026-08-21

ChatCOM exposes a local STDIO MCP server with exactly two focused tools:
configuration validation and an explicitly authorized relay execution. The MCP
protocol carries validated envelopes as structured private tool content; human
terminal diagnostics remain bounded and content-free.

## C-006 — Accurate MCP approval semantics

**Status:** accepted — 2026-08-21

Configuration validation is annotated read-only, closed-world and idempotent.
The relay tool keeps the inspected project read-only but is annotated as an
external, non-idempotent action so the MCP host can require explicit approval
for every real mission. Neither annotations nor model instructions replace
user authorization.

## C-007 — TypeScript remains the orchestration language

**Status:** accepted — 2026-08-21

TypeScript remains the best-adapted language for the relay and MCP boundary
because ChatCOM already depends on the official Codex TypeScript SDK and the
official MCP TypeScript SDK. A C++ component is deferred until a measured native
performance or operating-system integration requirement justifies the added
interop and safety surface.

## C-008 — Cancellation propagation

**Status:** accepted — 2026-08-21

Host cancellation is propagated through the local relay and Codex SDK stream.
Cancellation remains bounded, returns a stable error code, and requires the
usual thread and process cleanup before completion.

## C-009 — Reproducible verification

**Status:** accepted — 2026-08-21

`npm run verify` is the local and CI gate. It covers build, typecheck, all
deterministic tests, configuration validation, the production dependency audit,
and package dry-run.

## C-010 — v1 release candidate

**Status:** accepted — 2026-08-21

The converged relay is versioned `1.0.0-rc.1` before a formal stable release.
The candidate keeps TypeScript as its orchestration language, has a single
strict message-contract source, propagates cancellation from MCP to the Codex
SDK, validates on Ubuntu, Windows and macOS, and requires a successful real MCP
proof. A tag, GitHub Release and npm publication remain separate user decisions.
