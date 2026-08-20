# ChatCOM agent instructions

ChatCOM is a reusable, local Work ↔ Codex communication relay.

## Boundaries

- Keep the relay independent from any product repository.
- Do not hard-code project names, phases, points, paths, credentials, or user decisions.
- Preserve read-only execution and `approvalPolicy: "never"` unless the user explicitly approves a different security model.
- Never expose prompts, model output, credentials, server messages, or stack traces in bounded terminal diagnostics.
- Do not claim autonomous communication is operational without a successful real end-to-end proof and independent review.

## Validation

Before reporting an implementation complete, run:

```text
npm run build
npm run typecheck
npm test
npm run validate-config
```

Git and GitHub operations require explicit user authorization.
