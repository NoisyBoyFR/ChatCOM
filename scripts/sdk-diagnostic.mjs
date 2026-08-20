import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexSdkRelayClient } from "../dist/codex-sdk-relay.js";

const PREFIX = "chatcom-sdk-diagnostic-";
let emitted = false;

function emit(line) {
  if (emitted) return;
  emitted = true;
  process.stdout.write(`${line}\n`);
}

function safeCode(error) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "SDK_DIAGNOSTIC_FAILED";
}

function safeStage(error) {
  const stage = error && typeof error === "object" && "sdkStage" in error ? error.sdkStage : "LAUNCH";
  return ["LAUNCH", "THREAD_CREATION", "TURN_START", "STREAM_ACTIVE", "TERMINAL_ABSENT", "TERMINAL_COMPLETED", "TERMINAL_FAILED"].includes(stage) ? stage : "LAUNCH";
}

function safeLastStage(error) {
  const stage = error && typeof error === "object" && "sdkLastStage" in error ? error.sdkLastStage : "LAUNCH";
  return ["LAUNCH", "THREAD_CREATION", "TURN_START", "STREAM_ACTIVE", "TERMINAL_ABSENT", "TERMINAL_COMPLETED", "TERMINAL_FAILED"].includes(stage) ? stage : "LAUNCH";
}

const SAFE_STAGES = ["LAUNCH", "THREAD_CREATION", "TURN_START", "STREAM_ACTIVE", "TERMINAL_ABSENT", "TERMINAL_COMPLETED", "TERMINAL_FAILED"];
const SAFE_LIFECYCLE_STAGES = ["NONE", "THREAD_CREATION", "TURN_START", "TERMINAL_COMPLETED", "TERMINAL_FAILED"];

function safeProof(error, client) {
  const source = error && typeof error === "object" && "streamProof" in error ? error.streamProof : client?.lastStreamProof;
  const proof = source && typeof source === "object" ? source : {};
  const eventTypes = Array.isArray(proof.eventTypes) ? proof.eventTypes.filter((type) => ["thread.started", "turn.started", "turn.completed", "turn.failed", "error", "UNKNOWN"].includes(type)).slice(0, 16) : [];
  return {
    threadStarted: proof.threadStarted === true,
    turnStarted: proof.turnStarted === true,
    eventCount: Number.isSafeInteger(proof.eventCount) && proof.eventCount >= 0 && proof.eventCount <= 64 ? proof.eventCount : 0,
    eventTypes: eventTypes.length === 0 ? "ABSENT" : eventTypes.join(","),
    unknownEventCount: Number.isSafeInteger(proof.unknownEventCount) && proof.unknownEventCount >= 0 && proof.unknownEventCount <= 16 ? proof.unknownEventCount : 0,
    streamActive: proof.streamActive === true,
    lastLifecycleStage: SAFE_LIFECYCLE_STAGES.includes(proof.lastLifecycleStage) ? proof.lastLifecycleStage : "NONE",
    terminal: ["ABSENT", "COMPLETED", "FAILED"].includes(proof.terminal) ? proof.terminal : "ABSENT",
    abortRequested: proof.abortRequested === true,
    streamClosed: proof.streamClosed === true,
  };
}

function createSyntheticCodex(mode) {
  return {
    startThread() {
      return {
        id: null,
        async runStreamed(_input, options) {
          return { events: (async function* () {
            yield { type: "thread.started", thread_id: "synthetic-thread" };
            yield { type: "turn.started" };
            if (mode === "unknown") yield { type: "secret.synthetic.event", secret: "fixture-secret" };
            if (mode === "timeout") {
              await new Promise((resolve) => options.signal?.addEventListener("abort", resolve, { once: true }));
              throw new Error("synthetic stream abort");
            }
            yield { type: "item.completed", item: { id: "synthetic-item", type: "agent_message", text: "READY" } };
            yield { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } };
          })() };
        },
      };
    },
  };
}

async function main() {
  const cwd = await mkdtemp(join(tmpdir(), PREFIX));
  let client;
  let threadId;
  let cleanup = "CONFIRMED";
  let code = "OK";
  let turn = "COMPLETED";
  let stage = "TERMINAL_COMPLETED";
  let lastStage = stage;
  let closeResult = { exited: false, forced: false };
  let tempRemoved = false;
  let errorForProof;
  try {
    const fixture = process.env.CHATCOM_SDK_DIAGNOSTIC_FIXTURE;
    client = fixture === "success" || fixture === "timeout" || fixture === "unknown"
      ? await createCodexSdkRelayClient(cwd, { timeoutMs: fixture === "timeout" ? 20 : 600_000, codex: createSyntheticCodex(fixture) })
      : await createCodexSdkRelayClient(cwd, { timeoutMs: 600_000 });
    threadId = await client.startThread("You are a bounded local diagnostic agent. Return only a short non-sensitive confirmation.", cwd);
    await client.runTurn(threadId, "Return exactly the word READY.");
    await client.deleteThread(threadId);
  } catch (error) {
    errorForProof = error;
    code = safeCode(error);
    turn = "FAILED";
    stage = safeStage(error);
    lastStage = safeLastStage(error);
  } finally {
    if (client) {
      try { closeResult = await client.close(); } catch { cleanup = "FAILED"; }
    }
    try { await rm(cwd, { recursive: true, force: false }); tempRemoved = true; } catch { cleanup = "FAILED"; }
  }
  const proof = safeProof(errorForProof, client);
  const processExited = closeResult.exited === true && closeResult.forced === false;
  if (!proof.streamClosed || !processExited || !tempRemoved) cleanup = "FAILED";
  else cleanup = "CONFIRMED";
  if (cleanup !== "CONFIRMED") {
    code = "CLEANUP_FAILED";
    turn = turn === "COMPLETED" ? "NOT_CONFIRMED" : turn;
  }
  const kind = code === "OK" ? "SUCCESS" : "FAILURE";
  if (kind === "SUCCESS") {
    stage = "TERMINAL_COMPLETED";
    lastStage = proof.lastLifecycleStage;
  }
  emit(`SDK_DIAGNOSTIC kind=${kind} code=${code} stage=${stage} lastStage=${lastStage} lastLifecycleStage=${proof.lastLifecycleStage} threadStarted=${proof.threadStarted} turnStarted=${proof.turnStarted} eventCount=${proof.eventCount} eventTypes=${proof.eventTypes} unknownEventCount=${proof.unknownEventCount} streamActive=${proof.streamActive} terminal=${proof.terminal} abortRequested=${proof.abortRequested} streamClosed=${proof.streamClosed} processExited=${processExited} tempRemoved=${tempRemoved} turn=${turn} cleanup=${cleanup}`);
  process.exitCode = kind === "SUCCESS" ? 0 : 1;
}

main().catch(() => {
  emit("SDK_DIAGNOSTIC kind=FAILURE code=SDK_BOOTSTRAP_FAILED stage=LAUNCH lastStage=LAUNCH turn=NOT_RUN cleanup=FAILED");
  process.exitCode = 1;
});
