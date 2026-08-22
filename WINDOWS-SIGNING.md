# Windows code signing with SignPath Foundation

ChatCOM uses SignPath Foundation Open Source Code Signing for the public
Windows publisher signature. The workflow is intentionally manual and
protected by the `windows-code-signing` GitHub environment. Azure Artifact
Signing and PFX-based signing are not used by this project.

## Owner prerequisites

The repository owner must complete the SignPath open-source application and
obtain project approval before any real signing request. SignPath must have
access to the public repository through its GitHub trusted build system. The
owner must configure a public-trust signing policy and an artifact
configuration that signs only project-owned PE files and excludes or verifies
third-party Electron, Chromium, Node.js, Codex runtime, and Squirrel files.

The protected environment must be restricted to `main` and should require a
reviewer. Add these values in GitHub environment settings only:

| Name | Kind | Purpose |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | secret | SignPath API authentication |
| `SIGNPATH_ORGANIZATION_ID` | variable | SignPath organization |
| `SIGNPATH_PROJECT_SLUG` | variable | SignPath project |
| `SIGNPATH_SIGNING_POLICY_SLUG` | variable | approved signing policy |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | variable | nested artifact rules |
| `SIGNPATH_PUBLISHER_SUBJECT` | variable | exact Authenticode subject assigned by SignPath |

Never commit or paste a token, private key, certificate password, or other
credential. The exact identifiers and subject are external owner configuration
and are deliberately not invented in this repository.

## Protected workflow

`.github/workflows/sign-windows.yml` has `workflow_dispatch` only. It accepts
`SIGN_RC5`, requires `main`, uses the `windows-code-signing` environment, and
has only `actions: read` and `contents: read` permissions. It checks the
repository origin, runs `npm run verify`, builds the Squirrel package, uploads
the input as a temporary GitHub artifact, submits one SignPath request with the
pinned official action, downloads the result, and independently checks
`ChatCOM.exe` and the final Setup with Authenticode, the configured publisher
subject, and RFC 3161 timestamp validation. The public subject is injected
before the signed build and embedded immutably in the Desktop main bundle; the
manifest records it separately so the updater can compare all three identities
exactly. It then emits `desktop-build-manifest.json` and
`SHA256SUMS.txt` with `signatureState: SIGNED`.

The unsigned input build is deterministic: the targeted output directory is
cleaned and recreated safely, the package is checked for exactly one
`codex.exe`, and recursively included output directories are rejected. The
unsigned local validation package is not an update feed and keeps automatic
updates disabled.

The workflow cannot create a branch, tag, Release, public update feed, or npm
publication. A failed, unsigned, or unverified result is validation-only and
must not be published.

## Manual run

After owner approval and environment configuration, select **Sign Windows RC.5**
from GitHub Actions, choose `main`, enter `SIGN_RC5`, and approve the protected
environment if prompted. The expected bounded markers are:

```text
CHATCOM_SIGNING_PREFLIGHT kind=READY provider=SIGNPATH configuration=COMPLETE
CHATCOM_SIGNPATH_RESULT kind=SIGNED manifest=SIGNED hashes=EMITTED
```

No ChatCOM relay or MCP proof is started by this workflow. A successful signed
validation is not itself permission to create a tag or GitHub Release.

See [CODE-SIGNING-POLICY.md](CODE-SIGNING-POLICY.md) and
[SIGNPATH-APPLICATION.md](SIGNPATH-APPLICATION.md) for the policy and owner
application dossier. The privacy and security boundaries are documented in
[PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).
