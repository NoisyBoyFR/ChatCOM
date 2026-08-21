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
