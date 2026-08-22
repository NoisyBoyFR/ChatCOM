# Changelog

All notable ChatCOM changes are recorded in this file. Dates use the ISO `YYYY-MM-DD` format.

## [Unreleased]

- RC.5 hardening: specialized message schemas now use SDK-compatible singleton `enum` constraints instead of `const`; SDK REPORT diagnostics are preserved through the MCP boundary with allowlisted fields, and structured MCP results are checked for JSON serializability.
- RC.5: added the two-call `WORK_HOST` MCP bridge (`chatcom_work_open` and `chatcom_work_complete`) with one Codex thread, in-memory exchange state, route/replay protection, inactivity cleanup, and bounded host/authentication labels.
- RC.5: kept `chatcom_run_relay` explicitly classified as `LOCAL_SIMULATION`; no synthetic local relay is eligible for a real WORK proof.
- RC.5: added Desktop communication status for WORK host, MCP, local Codex, mode, cleanup, and timeline role coloring.
- RC.5: updated the deterministic bridge tests and the four-language user and security documentation.
- Added a main-process Electron/Squirrel updater controller with a ten-second first-run delay, six-hour checks, serialized requests, background download, deferred restart, and relay-cleanup gating.
- Added typed settings for automatic updates and Stable/Preview channels in all four locales.
- Added closed-by-default policy checks for packaging, Windows x64, publisher, timestamped Authenticode signatures, repository, version, and downgrade protection.
- Extended Windows validation metadata with Squirrel `Setup.exe`, full `.nupkg`, `RELEASES`, hashes, channel, and signature state.
- Public automatic updates remain disabled until the signing pipeline is configured; no release or tag was created.
- Replaced the inactive Azure Artifact Signing design with a protected, manual SignPath Foundation Open Source Code Signing workflow using the GitHub trusted build system and pinned actions.
- Added MIT licensing, privacy, security, third-party notices, a code-signing policy, and a SignPath owner application dossier.
- Added fail-closed Authenticode verification, independent publisher/timestamp checks, post-signing hashes, and a `SIGNED` manifest; no client secret or private certificate material is stored in the repository.

## [1.0.0-rc.5] - 2026-08-22

### Added

- Real `WORK_HOST` ↔ `CODEX_LOCAL` MCP bridge proof with `MISSION → REPORT → NEXT_PROMPT`, exactly three transmissions, read-only execution, and confirmed cleanup.
- RC.5 release-readiness flow for versioned Windows Preview artifacts, hashes, manifest validation, and a fail-closed `SIGNED` gate.

### Changed

- Migrated the protected SignPath workflow to RC.5 with version-derived artifact names, manual `main` execution, pinned actions, and read-only repository permissions.
- Authenticode validation now uses the exact external publisher subject configured by SignPath; the product name `ChatCOM` is not treated as a certificate subject.

### Distribution

- No tag, GitHub Release, GitHub Pages deployment, unsigned public update, or npm publication was created for RC.5.

## [1.0.0-rc.3] - 2026-08-21

### Added

- Electron and TypeScript Windows desktop interface for supervised WORK_LOCAL ↔ CODEX_LOCAL communication.
- Guided beginner configuration with required, recommended, and optional field explanations.
- Offline French, English, Simplified Chinese, and Russian translations.
- System, Light, and Dark themes; normal, maximized, and fullscreen window modes.
- Text-size, reduced-motion, timeline auto-scroll, safe preference reset, and RC.2 preference migration.
- Runtime, authentication, project, and read-only Desktop preflight.
- Explicit `USER_DECISION_REQUIRED` route and resume only after a validated user response.
- Versioned Squirrel.Windows installer, checksum file, and machine-readable build manifest.
- GitHub Actions Windows x64 artifact alongside Ubuntu, Windows, and macOS validation.

### Changed

- Expanded the deterministic validation suite to 109 tests.
- Improved bounded SDK failure categories and Desktop diagnostics.
- Made the native Codex runtime copy and final package verification deterministic.

### Security

- Preserved read-only execution and `approvalPolicy: "never"`.
- Kept Electron Node integration disabled with context isolation, sandboxing, restrictive CSP, and allowlisted IPC.
- Preferences exclude mission text, message content, diagnostics, tokens, thread IDs, and user responses.

### Distribution

- Published as the `v1.0.0-rc.3` GitHub pre-release.
- The Windows installer is unsigned and is not a stable `v1.0.0` release.
- No npm publication is included.

## [1.0.0-rc.2] - 2026-08-21

### Added

- Initial supervised Electron Desktop candidate and multi-cycle conversation orchestrator.
- Visual three-message timeline, pause, resume, stop, export, and bounded error states.
- Electron Forge and Squirrel.Windows packaging with a bundled native Codex runtime.

### Changed

- Added safe SDK failure classification and a Desktop readiness preflight.
- Corrected the user-decision route and packaging hook order during RC.2 hardening.

### Known limitation

- RC.2 did not complete a real GUI-driven relay proof.

## [1.0.0-rc.1] - 2026-08-21

### Added

- Version 1.0 message contract, propagated host cancellation, strict session coherence, and multi-platform CI.
- Successful real MCP release-candidate proof with exactly three transmissions and confirmed cleanup.

## [0.3.0] - 2026-08-21

### Added

- STDIO MCP bridge exposing configuration validation and one authorized relay.
- Strict structured tool results and bounded, content-free terminal diagnostics.
- Successful real MCP proof from validation through cleanup.

## [0.2.0] - 2026-08-21

### Added

- Standalone reusable TypeScript relay extracted from the original FitMyLife workflow.
- Portable CLI, Codex SDK adapter, App Server fallback, configuration validation, cleanup checks, and operational proof.

[Unreleased]: https://github.com/NoisyBoyFR/ChatCOM/compare/v1.0.0-rc.3...HEAD
[1.0.0-rc.3]: https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/NoisyBoyFR/ChatCOM/commit/acea382d0ab73d29a637438184cb5e96295b6bfc
[1.0.0-rc.1]: https://github.com/NoisyBoyFR/ChatCOM/commit/b084df64ccb3f9f84576eef03baae79860abba8a
[0.3.0]: https://github.com/NoisyBoyFR/ChatCOM/commit/402cc27601b0c30a53f99fb3baf66c9f274157e0
[0.2.0]: https://github.com/NoisyBoyFR/ChatCOM/releases/tag/v0.2.0
