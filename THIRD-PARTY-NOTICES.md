# Third-party notices

ChatCOM is distributed under the MIT License in [LICENSE](LICENSE). The
following direct production components are distributed with or required by
the application and retain their own notices:

| Component | Version | License / source |
| --- | --- | --- |
| Electron | 43.4.1 | MIT; https://github.com/electron/electron |
| `@openai/codex-sdk` | 0.149.0 | Apache-2.0; https://github.com/openai/codex |
| `@openai/codex-win32-x64` | 0.149.0 | Apache-2.0; https://github.com/openai/codex |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT; https://github.com/modelcontextprotocol/typescript-sdk |
| `zod` | 4.4.3 | MIT; https://github.com/colinhacks/zod |
| Squirrel.Windows tooling | via `@electron-forge/maker-squirrel` 7.11.2 | MIT; https://github.com/Squirrel/Squirrel.Windows |

Electron includes a Node.js runtime and other Chromium/operating-system
components with their own licenses. Build-only dependencies such as
TypeScript, Vite, and Electron Forge are recorded in `package-lock.json`.
The lockfile and each dependency's upstream notice are authoritative for the
complete transitive inventory; ChatCOM does not replace those notices with an
MIT license.
