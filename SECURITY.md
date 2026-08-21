# Security policy

ChatCOM is a local, read-only relay. Do not include credentials, prompts,
responses, project contents, thread identifiers, or private signing material
in a public issue, pull request, or diagnostic output.

## Reporting

Please report a suspected vulnerability privately through GitHub Security
Advisories for `NoisyBoyFR/ChatCOM` when private reporting is enabled. If the
repository does not expose that mechanism, contact the repository owner
through a private GitHub channel before disclosure. Do not use a public issue
for an undisclosed vulnerability.

Include the affected version or commit, operating system, minimal reproduction,
impact, and a proposed mitigation. Redact all secrets and user data.

## Scope

The highest-priority reports concern write access to an inspected project,
approval-policy bypass, command injection, IPC boundary violations, updater
integrity, artifact-signing workflow bypass, credential exposure, and
diagnostic leakage. Unsupported modified binaries, unofficial update feeds,
and intentionally authorized user actions may be out of scope.

The `WORK_HOST` bridge labels the host connection as `MCP_HOST` and
`WORK_AUTH_MANAGED_BY_HOST`; it does not cryptographically authenticate WORK
itself. Real proof claims require the first `MISSION` to come from the genuine
MCP host. The bridge rejects replayed sessions, route mismatches, and a second
Codex mission, and fails closed when thread or client cleanup is unconfirmed.

Supported-version and remediation decisions are recorded in the repository
without publishing sensitive report details.
