# WORK_HOST ↔ Codex proof procedure

This is the only procedure that may produce a real WORK ↔ Codex proof.

1. Start the ChatCOM MCP server from a clean build and call
   `chatcom_validate_config`.
2. From the genuine OpenAI WORK host, call `chatcom_work_open` with the
   absolute configuration path and a complete `WORK_HOST` `MISSION` envelope.
   The envelope must use sequence `1`, `correlation_id=session_id`,
   `sender=WORK_HOST`, `recipient=CODEX_LOCAL`, `type=MISSION`, and
   `user_action_needed=false`.
3. WORK must analyze the returned `REPORT` in its own host session. ChatCOM
   does not impersonate WORK and does not receive WORK credentials.
4. The same host calls `chatcom_work_complete` exactly once with the returned
   session ID and a new `WORK_HOST` `NEXT_PROMPT` envelope. The envelope must
   use sequence `3` and correlate to the returned report message.
5. Confirm structured status `SUCCESS`, `transmissions=3`,
   `stopped_before_second_codex_mission=true`, and `cleanup=CONFIRMED`.

The first call returns `REPORT_READY`, `transmissions=2`, and `cleanup=PENDING`.
It creates exactly one Codex thread in read-only mode with
`approvalPolicy: "never"`. The second call never starts another Codex turn;
it only validates the host's next prompt and performs cleanup. Abandoned
exchanges expire in memory and are cleaned automatically.

`chatcom_run_relay` is a compatibility route named `LOCAL_SIMULATION`. It is
useful for deterministic tests but must never be reported as a real host proof.
If the current session is not a genuine WORK MCP host, stop after local tests
and report `READY_FOR_WORK_PROOF`.
