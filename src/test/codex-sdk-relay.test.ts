import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexSdkRelayClient, resolveBundledCodexRuntime } from "../codex-sdk-relay.js";
import { AppServerClientError } from "../app-server-client.js";
import { createMessageForTests, runLocalRelay } from "../local-relay.js";
import type { Thread, ThreadEvent, TurnOptions } from "@openai/codex-sdk";
import { realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const message = JSON.stringify({ version: "1.0", session_id: "11111111-1111-4111-8111-111111111111", message_id: "22222222-2222-4222-8222-222222222222", correlation_id: "11111111-1111-4111-8111-111111111111", sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase: "CHATCOM-TEST", point: "RELAY-1", content: "synthetic", created_at: "2026-01-01T00:00:00.000Z", delivery_status: "CREATED", user_action_needed: false });

function runDiagnosticFixture(mode: "success" | "timeout" | "unknown") {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const result = spawnSync(process.execPath, [resolve(packageRoot, "scripts/sdk-diagnostic.mjs")], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, CHATCOM_SDK_DIAGNOSTIC_FIXTURE: mode },
  });
  const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  return { result, lines };
}

test("SDK runtime resolves to the canonical exact 0.149.0 native executable", { skip: process.platform !== "win32" }, async () => {
  const runtime = await resolveBundledCodexRuntime();
  assert.equal(runtime, await realpath(runtime));
  assert.match(runtime, /node_modules[\\/]@openai[\\/]codex-win32-x64[\\/]vendor[\\/]x86_64-pc-windows-msvc[\\/]bin[\\/]codex\.exe$/iu);
});

class FakeThread {
  id: string | null = "fake-thread-id";
  readonly calls: { input: string; options: unknown }[] = [];
  constructor(private readonly response: string | (() => string), private readonly failure = false, private readonly hang = false, private readonly ignoreAbort = false, private readonly startNever = false) {}
  async run(): Promise<never> {
    throw new Error("run() must not be used by the SDK relay");
  }
  async runStreamed(input: string, options: TurnOptions): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    this.calls.push({ input, options });
    if (this.startNever) return new Promise<{ events: AsyncGenerator<ThreadEvent> }>(() => undefined);
    const response = typeof this.response === "function" ? this.response() : this.response;
    const failure = this.failure;
    const hang = this.hang;
    const ignoreAbort = this.ignoreAbort;
    const signal = options.signal;
    return { events: (async function* (): AsyncGenerator<ThreadEvent> {
      yield { type: "thread.started", thread_id: "fake-thread-id" };
      yield { type: "turn.started" };
      if (hang) {
        if (ignoreAbort) await new Promise<void>(() => undefined);
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("sensitive stream detail");
      }
      if (failure) {
        yield { type: "error", message: "sensitive server detail" };
        yield { type: "turn.failed", error: { message: "sensitive server detail" } };
        return;
      }
      yield { type: "item.completed", item: { id: "item", type: "agent_message", text: response } };
      yield { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } };
    })() };
  }
}

class FakeCodex {
  readonly threads: FakeThread[] = [];
  constructor(private readonly outputs: string[]) {}
  startThread(): Thread {
    const thread = new FakeThread(() => this.outputs.shift() ?? "{}");
    this.threads.push(thread);
    return thread as unknown as Thread;
  }
}

test("SDK adapter runs a thread without exposing SDK internals", async () => {
  const thread = new FakeThread(message);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { codex: { startThread: () => thread as unknown as Thread } });
  await client.initialize();
  const id = await client.startThread("WORK_LOCAL instructions", "C:\\synthetic");
  assert.equal(await client.runTurn(id, "prompt", { type: "object" }), message);
  await client.deleteThread(id);
  const closed = await client.close();
  assert.deepEqual(closed, { exited: true, forced: false });
  assert.equal(thread.calls.length, 1);
  assert.equal(thread.calls[0].input.startsWith("WORK_LOCAL instructions\n\nprompt"), true);
  assert.equal((thread.calls[0].options as { outputSchema: unknown }).outputSchema !== undefined, true);
});

test("SDK adapter converts a failed turn to a bounded diagnostic", async () => {
  const thread = new FakeThread("", true);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  await assert.rejects(client.runTurn(id, "prompt"), (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_TURN_FAILED");
    assert.deepEqual(error.diagnostic, { method: "codex-sdk", categoryUnknown: true, finalStatus: "failed", sdkStage: "TERMINAL_FAILED", sdkLastStage: "TERMINAL_FAILED" });
    assert.equal(error.message.includes("sensitive"), false);
    return true;
  });
  await client.deleteThread(id);
  await client.close();
});

test("SDK adapter classifies a missing terminal after abort and waits for stream closure", async () => {
  const thread = new FakeThread("", false, true);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { timeoutMs: 10, codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  await assert.rejects(client.runTurn(id, "prompt"), (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_TURN_TIMEOUT");
    assert.deepEqual(error.diagnostic, { method: "codex-sdk", categoryUnknown: true, finalStatus: "interrupted", sdkStage: "TERMINAL_ABSENT", sdkLastStage: "TURN_START" });
    return true;
  });
  await client.deleteThread(id);
  assert.deepEqual(await client.close(), { exited: true, forced: false });
});

test("SDK adapter propagates an external cancellation and closes the stream", async () => {
  const thread = new FakeThread("", false, true);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { timeoutMs: 1_000, codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  const controller = new AbortController();
  const pending = client.runTurn(id, "prompt", undefined, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_TURN_CANCELLED");
    assert.deepEqual(error.diagnostic, { method: "codex-sdk", categoryUnknown: true, finalStatus: "interrupted", sdkStage: "TERMINAL_ABSENT", sdkLastStage: "TURN_START" });
    return true;
  });
  await client.deleteThread(id);
  assert.deepEqual(await client.close(), { exited: true, forced: false });
});

test("SDK adapter detects a pre-aborted signal before starting a turn", async () => {
  const thread = new FakeThread(message);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.runTurn(id, "prompt", undefined, controller.signal), (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_TURN_CANCELLED");
    assert.equal(thread.calls.length, 0);
    return true;
  });
  await client.deleteThread(id);
  await client.close();
});

test("SDK adapter bounds cleanup when a stream ignores cancellation", async () => {
  const thread = new FakeThread("", false, true, true);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { timeoutMs: 1_000, streamCleanupTimeoutMs: 20, codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  const controller = new AbortController();
  const started = Date.now();
  const pending = client.runTurn(id, "prompt", undefined, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_STREAM_CLEANUP_FAILED");
    return true;
  });
  assert.ok(Date.now() - started < 500);
  await client.deleteThread(id);
  await client.close();
});

test("SDK adapter bounds a runStreamed call that never resolves", async () => {
  const thread = new FakeThread("", false, false, false, true);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { timeoutMs: 1_000, streamCleanupTimeoutMs: 20, codex: { startThread: () => thread as unknown as Thread } });
  const id = await client.startThread("CODEX_LOCAL instructions", "C:\\synthetic");
  const controller = new AbortController();
  const started = Date.now();
  const pending = client.runTurn(id, "prompt", undefined, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof AppServerClientError);
    assert.equal(error.code, "SDK_STREAM_CLEANUP_FAILED");
    return true;
  });
  assert.ok(Date.now() - started < 500);
  await client.deleteThread(id);
  await client.close();
});

test("SDK adapter drives the complete three-transmission relay", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const mission = createMessageForTests({ session_id: sessionId, message_id: "22222222-2222-4222-8222-222222222222", correlation_id: sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase: "CHATCOM-TEST", point: "RELAY-1", content: "mission", user_action_needed: false });
  const report = createMessageForTests({ session_id: sessionId, message_id: "33333333-3333-4333-8333-333333333333", correlation_id: mission.message_id, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", phase: "CHATCOM-TEST", point: "RELAY-1", content: "report", user_action_needed: false });
  const next = createMessageForTests({ session_id: sessionId, message_id: "44444444-4444-4444-8444-444444444444", correlation_id: report.message_id, sequence: 3, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", phase: "CHATCOM-TEST", point: "RELAY-1", content: "next", user_action_needed: false });
  const fakeCodex = new FakeCodex([JSON.stringify(mission), JSON.stringify(report), JSON.stringify(next)]);
  const client = await createCodexSdkRelayClient("C:\\synthetic", { codex: fakeCodex });
  const result = await runLocalRelay(client, { cwd: "C:\\synthetic", phase: "CHATCOM-TEST", point: "RELAY-1", mission: "synthetic mission", sessionId });
  assert.equal(result.completedTransmissions, 3);
  assert.deepEqual(result.sequence, [1, 2, 3]);
  assert.equal(fakeCodex.threads.length, 2);
  assert.equal(fakeCodex.threads[0].calls.length, 2);
  assert.equal(fakeCodex.threads[1].calls.length, 1);
  await client.close();
});

test("SDK diagnostic process proves stream and child cleanup on synthetic success", () => {
  const { result, lines } = runDiagnosticFixture("success");
  assert.equal(result.status, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^SDK_DIAGNOSTIC kind=SUCCESS code=OK /u);
  assert.match(lines[0], /threadStarted=true turnStarted=true eventCount=4 /u);
  assert.match(lines[0], /terminal=COMPLETED abortRequested=false streamClosed=true processExited=true tempRemoved=true turn=COMPLETED cleanup=CONFIRMED$/u);
});

test("SDK diagnostic process proves bounded abort, stream closure, and cleanup", () => {
  const { result, lines } = runDiagnosticFixture("timeout");
  assert.equal(result.status, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^SDK_DIAGNOSTIC kind=FAILURE code=SDK_TURN_TIMEOUT /u);
  assert.match(lines[0], /stage=TERMINAL_ABSENT lastStage=TURN_START lastLifecycleStage=TURN_START threadStarted=true turnStarted=true /u);
  assert.match(lines[0], /terminal=ABSENT abortRequested=true streamClosed=true processExited=true tempRemoved=true turn=FAILED cleanup=CONFIRMED$/u);
});

test("SDK diagnostic process bounds unknown events without leaking their content", () => {
  const { result, lines } = runDiagnosticFixture("unknown");
  assert.equal(result.status, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /eventTypes=thread.started,turn.started,UNKNOWN,turn.completed /u);
  assert.match(lines[0], /unknownEventCount=1 /u);
  assert.equal(lines[0].includes("fixture-secret"), false);
});
