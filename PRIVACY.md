# ChatCOM privacy notice

Last updated: 2026-08-21

ChatCOM is a local, read-only relay and desktop client. It has no telemetry,
advertising identifier, analytics SDK, or ChatCOM account. Mission text,
message content, and credentials are not written to ChatCOM preference files.

For the `WORK_HOST` MCP bridge, WORK authentication remains in the OpenAI host
application. ChatCOM receives the MCP request but never reads or stores host
cookies, session tokens, API keys, browser profiles, or other authentication
secrets. Exchange route metadata is held in memory only until the second tool
call or bounded expiration; the Codex thread is deleted during cleanup.

## Data stored locally

Electron stores versioned preferences in its normal per-user `userData`
directory. Preferences include display language, theme, text size, updater
channel, reduced motion, and similar UI choices. The application may retain
bounded local proof metadata needed to display the current run; it does not
persist prompts or model responses as a product history. Uninstalling ChatCOM
does not necessarily remove an operating system's application-data directory;
remove that directory manually if you want to erase local preferences.

## Data sent to services

When the user explicitly starts a relay, the configured Codex runtime may send
the selected project path and mission/message content to the Codex/OpenAI
service according to the user's account, runtime, and applicable OpenAI terms.
ChatCOM does not silently start that runtime and does not control the service's
retention policy.

The optional updater contacts the configured Electron update service and the
project's public GitHub release/feed endpoints. It is disabled for unsigned
preview artifacts. The installed application does not contact GitHub Actions
or SignPath; those services are used only by the maintainer's protected build
workflow. No MCP configuration is added automatically.

## User control

The user chooses the project, mission, relay authorization, update channel,
and whether to download an update. Stop and cleanup controls are local. A
relay never receives write approval and the renderer cannot access Node.js
directly.

## Contact and changes

This notice is versioned with the repository. Changes are recorded in the
changelog. Security reports should follow [SECURITY.md](SECURITY.md).
