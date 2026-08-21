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

Supported-version and remediation decisions are recorded in the repository
without publishing sensitive report details.
