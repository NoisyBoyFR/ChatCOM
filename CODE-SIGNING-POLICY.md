# Windows code-signing policy

This policy applies to ChatCOM Desktop Windows artifacts. The project uses
SignPath Foundation Open Source Code Signing when the repository owner has
completed the external application and SignPath has approved the project.

## What is signed

Only project-owned PE files are eligible for the ChatCOM publisher identity.
Third-party Electron, Node.js, Codex runtime, and Squirrel components must be
excluded from project signing or independently verified according to the
SignPath artifact configuration. The final Setup and `ChatCOM.exe` must carry
the expected Authenticode publisher and an RFC 3161 timestamp.

## Trusted build

The protected `Sign Windows RC` workflow is manual, runs only from `main`,
checks out the public origin repository, builds on a GitHub-hosted Windows
runner, uploads the build as a GitHub workflow artifact, submits it through the
SignPath GitHub trusted build system, and independently verifies the returned
artifact. The workflow has no tag, release, or npm publication permission.

The `windows-code-signing` environment must restrict deployment to `main` and
should require a human reviewer. SignPath project, policy, and artifact
configuration slugs are stored as environment variables; the API token is an
environment secret. They must never be committed or printed.

## Release gate

An artifact is release-eligible only when the workflow reports `SIGNED`, the
publisher subject and timestamp checks pass for the Setup and application,
the package manifest and SHA-256 file are generated after signing, and the
full CI, package, and Electron smoke validations are green. A failed or
unsigned artifact is validation-only and must not be attached to a public
release or update feed.

## Incident response

If a signing identity, timestamp, SignPath project, or artifact configuration
is suspected to be wrong, block publication, revoke or correct the external
configuration, and record the decision in the changelog or security process.
