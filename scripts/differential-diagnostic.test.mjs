import assert from "node:assert/strict";
import { test } from "node:test";
import { AppServerClientError } from "../dist/app-server-client.js";
import { runCommand } from "./differential-diagnostic.mjs";

test("authoritative diagnostic invocation is bounded and synthetic", async () => {
  const calls = [];
  const result = await runCommand(["--cli-dir", "C:\\synthetic cli", "--timeout-ms", "600000"], {
    resolveExecutable: async () => "C:\\synthetic cli\\codex.exe",
    spawnClient: () => ({
      async listModels() { calls.push("model/list"); return [{ id: "synthetic", isDefault: true }]; },
      async initialize() { calls.push("initialize"); calls.push("initialized"); },
      async startThread({ model }) { calls.push(`thread/start:${model}`); return { id: `thread-${calls.length}` }; },
      async runTurn(_threadId, _prompt, schema) { calls.push(schema === undefined ? "turn/minimal" : "turn/schema"); return "discarded"; },
      async deleteThread(threadId) { calls.push(`thread/delete:${threadId}`); },
      async close() { calls.push("close"); return { exited: true, forced: false }; },
    }),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.line, /^DIFFERENTIAL failure=NONE .*clientClosed=true tempRemoved=true$/u);
  assert.deepEqual(calls, ["initialize", "initialized", "model/list", "thread/start:synthetic", "turn/minimal", "thread/delete:thread-4", "thread/start:synthetic", "turn/schema", "thread/delete:thread-7", "close"]);
});

test("authoritative invocation rejects missing CLI arguments without creating a client", async () => {
  let spawned = false;
  const result = await runCommand([], { spawnClient: () => { spawned = true; throw new Error("must not run"); } });
  assert.equal(result.exitCode, 1);
  assert.match(result.line, /^DIFFERENTIAL failure=DIAGNOSTIC_BOOTSTRAP_FAILED /u);
  assert.equal(spawned, false);
});

test("closes the real client when the App Server handshake fails", async () => {
  const calls = [];
  const result = await runCommand(["--cli-dir", "C:\\synthetic cli", "--timeout-ms", "600000"], {
    resolveExecutable: async () => "C:\\synthetic cli\\codex.exe",
    spawnClient: () => ({
      async initialize() { calls.push("initialize"); throw new Error("server detail must not escape"); },
      async close() { calls.push("close"); return { exited: true, forced: false }; },
    }),
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.line, /^DIFFERENTIAL failure=DIAGNOSTIC_INITIALIZATION_FAILED .*clientClosed=true tempRemoved=true$/u);
  assert.deepEqual(calls, ["initialize", "close"]);
  assert.doesNotMatch(result.line, /server|detail/iu);
});

test("reports the bounded failed stage and diagnostic without leaking arbitrary categories", async () => {
  const result = await runCommand(["--cli-dir", "C:\\synthetic cli", "--timeout-ms", "600000"], {
    resolveExecutable: async () => "C:\\synthetic cli\\codex.exe",
    spawnClient: () => ({
      async initialize() {},
      async listModels() { return [{ id: "synthetic", isDefault: true }]; },
      async startThread() { throw new AppServerClientError("THREAD_START_FAILED", { category: "codexErrorInfo:SecretToken123", httpStatusCode: 400, finalStatus: "failed" }); },
      async close() { return { exited: true, forced: false }; },
    }),
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.line, /failure=MINIMAL_TURN_FAILED .*failedStage=THREAD_START .*clientClosed=true tempRemoved=true diagnosticCategory=UNKNOWN .*diagnosticHttpStatusCode=400 .*diagnosticFinalStatus=failed$/u);
  assert.doesNotMatch(result.line, /SecretToken123/iu);
});
