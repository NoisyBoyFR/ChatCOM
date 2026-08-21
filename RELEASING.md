# ChatCOM release procedure

This procedure describes a formal release. It does not grant authority to run
any step. Tags, GitHub Releases, and npm publication each require explicit user
authorization.

## Desktop candidate

For `1.0.0-rc.3`, the Windows desktop artifact is a validation artifact, not a
formal publication. Build it with `npm run desktop:make` and verify it with
`scripts/verify-desktop-package.mjs`. The Squirrel installer is unsigned, does
not require elevation, and must not be uploaded as a GitHub Release unless a
separate publication authorization names the exact tag and release. The
packaged desktop runtime must keep the read-only project boundary, disabled
approvals, bounded diagnostics, and the three-transmission route.

The RC.3 GitHub Actions artifact is named
`chatcom-desktop-1.0.0-rc.3-windows-x64` and contains the versioned installer,
`SHA256SUMS.txt`, and `desktop-build-manifest.json`. The manifest records only
the version, Windows platform, x64 architecture, installer filename, size,
SHA-256, Codex runtime version, and `UNSIGNED` signature state. This artifact
is not a real WORK ↔ Codex proof.

The authorized public pre-release uses tag `v1.0.0-rc.3` and uploads those
same three verified files. The permanent installer link used by both homepages
is:

```text
https://github.com/NoisyBoyFR/ChatCOM/releases/download/v1.0.0-rc.3/ChatCOM-Desktop-1.0.0-rc.3-Setup.exe
```

The release must remain marked as a pre-release. It is not the stable `v1.0.0`
release and does not authorize npm publication.

## Release gate

1. Start from a clean `main` aligned with `origin/main`.
2. Complete the read-only post-merge inspection in
   `CODEX-CHATCOM-PROMPT.md`.
3. Confirm the required GitHub Actions matrix is green on Ubuntu, Windows, and
   macOS.
4. Run `npm ci` followed by `npm run verify` from a fresh checkout.
5. Confirm `.ai/PROOF.md` covers the exact runtime being released. If runtime
   code changed after the recorded proof, obtain separate authorization and
   repeat the real MCP proof before continuing.
6. Review the package dry-run and confirm it contains no tests, secrets, local
   paths, logs, or build residue.

## Stable-version change

Prepare a dedicated release branch and change `package.json` and
`package-lock.json` from the release-candidate version to the approved stable
version. Update both READMEs and durable `.ai` state. Merge only through a green
pull request.

## Publication decision

- A Git tag and GitHub Release require explicit publication authorization.
- npm publication is a separate product and security decision. The package is
  currently marked `private`; do not remove that guard or run `npm publish`
  without explicit authorization covering the registry and access level.
- Never store registry tokens or credentials in the repository, documentation,
  command output, or release notes.

After publication, verify the tag, release artifacts, checksums, and main-branch
CI, then update the durable proof without exposing sensitive runtime content.
# Auto-update signing gate

The RC.4 updater is implemented locally but remains fail-closed. Windows
automatic updates are enabled only for a packaged x64 build whose Setup.exe,
full Squirrel package, and `RELEASES` manifest have a valid ChatCOM
Authenticode signature with a trusted publisher and timestamp. The current
validation artifacts are `UNSIGNED`, so CI may retain them as validation
artifacts but must not publish them as an update release. The only permitted
public source is the official Electron update service for
`NoisyBoyFR/ChatCOM`; no private update server, certificate bypass, Defender
disablement, or automatic GitHub Release is allowed.

The generated Windows set must contain `Setup.exe`, `*-full.nupkg`,
`RELEASES`, `SHA256SUMS.txt`, and a manifest recording version, channel,
platform, architecture, sizes, hashes, signature state, publisher, timestamp,
and minimum updater version. Hashes are generated only after signing in a
future authorized signed pipeline.

Stable updates use `update.electronjs.org`, which only considers published
non-draft, non-pre-release GitHub Releases. Preview updates therefore use a
separate static Squirrel layout at `/preview/win32/x64`; this layout is only
validated by the local synthetic feed until a separately authorized hosting
deployment exists. Stable never consumes RC artefacts, and Preview never
silently downgrades.

The protected manual signing workflow is `.github/workflows/sign-windows.yml`.
It runs only from `main`, requires the `windows-code-signing` environment and
the exact `SIGN_RC4` confirmation, authenticates to Azure through OIDC, and
uses the official Artifact Signing action pinned to a full commit SHA. It signs
the packaged PE files before Squirrel assembly and signs the final Setup before
hash and manifest generation. The workflow only uploads a temporary
`-signed` validation artifact; it has read-only repository permissions and
cannot create a tag or GitHub Release.

The repository owner must complete the identity validation, Public Trust
certificate profile, federated credential, role assignment, and protected
environment variables described in [WINDOWS-SIGNING.md](WINDOWS-SIGNING.md).
Until that external setup exists and the workflow proves a valid publisher and
timestamp, RC.4 publication remains blocked.
