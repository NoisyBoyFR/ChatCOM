# Persistent Codex bindings

ChatCOM RC.6 supports two explicit conversation lifecycles:

- `EPHEMERAL` (default): ChatCOM creates one read-only Codex thread and deletes it after the exchange or timeout.
- `PERSISTENT_BOUND`: ChatCOM resumes an explicitly bound Codex thread, keeps it after cleanup, and closes only the client and streams.

## Exact binding rule

A binding is created or imported locally with an alias, a canonical project path, and the exact Codex thread UUID. Titles are never used for selection. The registry is stored atomically in the ChatCOM user-data directory as `bindings.json`; it is never committed, synchronized, included in reports, or uploaded to GitHub.

The UI and bounded MCP results expose only the public `binding_id`, alias, project path, state, and a masked thread tail. The complete thread identifier is never returned in diagnostics, logs, manifests, reports, or screenshots.

Before a persistent exchange, ChatCOM validates that the binding is active, that the exact thread identifier is valid, and that its canonical project path equals the requested project. A mismatch fails closed without contacting the model.

## MCP operations

The local registry operations are:

- `chatcom_binding_create` — create/import a binding without contacting Codex;
- `chatcom_binding_validate` — validate its state and project without reading history;
- `chatcom_binding_list` — list aliases and masked tails;
- `chatcom_binding_disable` — disable a binding without deleting the Codex thread;
- `chatcom_binding_remove` — remove only the registry entry.

`chatcom_work_open` accepts an optional `binding_id`. Omitting it preserves RC.5 `EPHEMERAL` behavior. Providing a validated binding selects `PERSISTENT_BOUND`, uses `resumeThread(threadId)`, and returns `thread_preserved=CONFIRMED` after `chatcom_work_complete`. No second Codex mission is started by completion.

The route remains `MISSION → REPORT → NEXT_PROMPT` for every session. Each session has independent UUIDs, correlation, replay protection, timeout, cancellation, bounded stream closure, and explicit cleanup. A subsequent authorized session may resume the same binding; ChatCOM never starts an autonomous infinite loop.

The Codex SDK remains isolated with `sandboxMode: "read-only"` and `approvalPolicy: "never"`. No authentication secret is read or stored by the binding registry.

