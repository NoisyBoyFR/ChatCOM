# SignPath Foundation application dossier

This dossier is the owner-facing submission package for ChatCOM. It does not
claim that SignPath has approved the project or that a certificate exists.

## Project

- Project: ChatCOM
- Repository: `https://github.com/NoisyBoyFR/ChatCOM`
- License: MIT
- Copyright: `Copyright (c) 2026 Alexandre Balladelli`
- Candidate: `1.0.0-rc.4`
- Build workflow: `.github/workflows/ci.yml`
- Protected signing workflow: `.github/workflows/sign-windows.yml`
- Environment: `windows-code-signing`, deployment branch `main`
- Contact owner: Alexandre Balladelli, via the repository owner account

## Purpose and trust model

ChatCOM is an open-source Windows desktop application and TypeScript CLI/MCP
relay. It inspects a user-selected local project in read-only mode, requires
explicit authorization for a relay, enforces `approvalPolicy: "never"`, and
stops after three transmissions. The signed Windows artifact is distributed
so users can verify that it came from this public repository. The application
does not use a client certificate, PFX, private key, or self-managed signing
secret.

## Trusted build and artifact flow

1. A maintainer starts the workflow manually on `main` and enters `SIGN_RC4`.
2. GitHub-hosted Windows builds from the public origin and runs `npm run verify`.
3. The Squirrel package is uploaded as a temporary workflow artifact.
4. The SignPath GitHub trusted build system verifies repository origin, branch,
   commit, and workflow provenance before signing the configured project-owned
   PE files.
5. The workflow downloads the signed artifact, independently checks the
   Authenticode subject and RFC 3161 timestamp on `ChatCOM.exe` and Setup,
   generates `desktop-build-manifest.json` and `SHA256SUMS.txt`, and uploads
   only a validation artifact. It cannot create tags, releases, or npm
   publications.

The SignPath artifact configuration must exclude or verify third-party
components and must not recursively apply the ChatCOM publisher identity to
Electron, Chromium, Node.js, Codex runtime, or Squirrel files.

## Owner actions still required

The owner must submit the project to SignPath Foundation through the official
open-source application, install/authorize the SignPath GitHub App, create or
approve the project, select a public-trust release signing policy, configure
the artifact configuration from a representative Windows package, and name a
manual approver. The owner must then add these values only in the protected
GitHub environment (not in Git):

- `SIGNPATH_API_TOKEN` secret;
- `SIGNPATH_ORGANIZATION_ID` variable;
- `SIGNPATH_PROJECT_SLUG` variable;
- `SIGNPATH_SIGNING_POLICY_SLUG` variable;
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` variable;
- `SIGNPATH_PUBLISHER_SUBJECT` variable.

No value is invented in this repository because these identifiers and the
certificate subject are assigned externally by SignPath. The application and
approval status must be recorded before a real signing request is authorized.

Official starting points:

- https://signpath.io/solutions/open-source-community
- https://docs.signpath.io/trusted-build-systems/github
- https://docs.signpath.io/projects
- https://docs.signpath.io/artifact-configuration/
- https://docs.signpath.io/origin-verification/

## Publication gate

Until owner submission, project approval, environment configuration, and a
successful protected signing validation are complete, ChatCOM must not create
an RC.4 tag, GitHub Release, public update feed, or npm publication.
