import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { AppServerCloseResult } from "../app-server-client.js";
import { AppServerClientError } from "../app-server-client.js";
import type { CodexSdkRelayClient } from "../codex-sdk-relay.js";
import { runPortableCli } from "../portable-cli.js";
import { runPortableRelay } from "../portable-relay.js";
import { RelayConfigError, loadRelayConfig, parseRelayConfig, type PortableRelayConfig } from "../relay-config.js";
import { createMessageForTests } from "../local-relay.js";
import type { MessageEnvelope } from "../message-contract.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function config(projectRoot: string, phase = "PORTABLE-PHASE", point = "PORTABLE-POINT"): PortableRelayConfig {
  return { version: "1.0", projectRoot, phase, point, mission: "Review the current project without changing it." };
}

function outputs(phase: string, point: string): string[] {
  const mission = createMessageForTests({ session_id: sessionId, message_id: "22222222-2222-4222-8222-222222222222", correlation_id: sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase, point, content: "mission", user_action_needed: false });
  const report = createMessageForTests({ session_id: sessionId, message_id: "33333333-3333-4333-8333-333333333333", correlation_id: mission.message_id, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", phase, point, content: "report", user_action_needed: false });
  const next = createMessageForTests({ session_id: sessionId, message_id: "44444444-4444-4444-8444-444444444444", correlation_id: report.message_id, sequence: 3, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", phase, point, content: "next", user_action_needed: false });
  return [mission, report, next].map((message) => JSON.stringify(message));
}

class FakePortableClient implements CodexSdkRelayClient {
  readonly starts: { instructions: string; cwd: string }[] = [];
  readonly turns: { threadId: string; prompt: string; schema: unknown }[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  readonly deletes: string[] = [];
  initialized = false;
  closed = false;
  private nextId = 1;

  constructor(private readonly responses: string[], private readonly cancelOnCall?: number) {}
  async initialize(): Promise<void> { this.initialized = true; }
  async startThread(instructions: string, cwd: string): Promise<string> { this.starts.push({ instructions, cwd }); return `thread-${this.nextId++}`; }
  async runTurn(threadId: string, prompt: string, outputSchema?: unknown, signal?: AbortSignal): Promise<string> {
    this.turns.push({ threadId, prompt, schema: outputSchema });
    this.signals.push(signal);
    if (this.cancelOnCall === this.turns.length) {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      throw new AppServerClientError("SDK_TURN_CANCELLED", { method: "codex-sdk", finalStatus: "interrupted" });
    }
    return this.responses.shift() ?? "{}";
  }
  async deleteThread(threadId: string): Promise<void> { this.deletes.push(threadId); }
  async close(): Promise<AppServerCloseResult> { this.closed = true; return { exited: true, forced: false }; }
}

test("parses project-relative reusable configuration without product-specific routing", () => {
  const configDirectory = resolve("portable", "config");
  const parsed = parseRelayConfig({ version: "1.0", project_root: "../project-b", phase: "RELEASE", point: "DOCS", mission: "Review documentation." }, configDirectory);
  assert.equal(parsed.projectRoot, resolve(configDirectory, "../project-b"));
  assert.equal(parsed.phase, "RELEASE");
  assert.equal(parsed.point, "DOCS");
  assert.throws(() => parseRelayConfig({ version: "1.0", project_root: ".", phase: "X", point: "Y", mission: "Z", extra: true }, resolve("portable")), (error) => error instanceof RelayConfigError && error.code === "CONFIG_KEYS_INVALID");
});

test("loads a portable config and canonicalizes its project root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-codex-config-"));
  const configPath = join(directory, "relay.json");
  try {
    await writeFile(configPath, JSON.stringify({ version: "1.0", project_root: ".", phase: "AUDIT", point: "A-1", mission: "Audit this project." }), "utf8");
    const loaded = await loadRelayConfig(configPath);
    assert.equal(loaded.projectRoot, await import("node:fs/promises").then(({ realpath }) => realpath(directory)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs the portable relay for independent project routes with structured output", async () => {
  for (const [phase, point] of [["PROJECT-A", "A-1"], ["PROJECT-B", "B-9"]] as const) {
    const client = new FakePortableClient(outputs(phase, point));
    const result = await runPortableRelay(config("C:\\portable\\workspace", phase, point), { timeoutMs: 10_000, sessionId, createClient: async () => client });
    assert.equal(result.relay.completedTransmissions, 3);
    assert.deepEqual(result.relay.messages.map(({ type, content }) => ({ type, content })), [
      { type: "MISSION", content: "mission" },
      { type: "REPORT", content: "report" },
      { type: "NEXT_PROMPT", content: "next" },
    ]);
    assert.equal(result.cleanup, "CONFIRMED");
    assert.equal(client.initialized, true);
    assert.equal(client.closed, true);
    assert.equal(client.starts.every(({ cwd }) => cwd === "C:\\portable\\workspace"), true);
    assert.equal(client.turns.every(({ schema }) => schema !== undefined), true);
    assert.equal(client.turns.every(({ prompt }) => prompt.includes(point)), true);
    assert.deepEqual(client.deletes, ["thread-2", "thread-1"]);
  }
});

test("portable relay propagates cancellation and always closes its client", async () => {
  const client = new FakePortableClient(outputs("PORTABLE-PHASE", "PORTABLE-POINT"), 1);
  const controller = new AbortController();
  const pending = runPortableRelay(config("C:\\portable\\workspace"), { timeoutMs: 10_000, sessionId, signal: controller.signal, createClient: async () => client });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => {
    const failure = error as { code?: string; relayStage?: string; completedTransmissions?: number };
    assert.equal(failure.code, "SDK_TURN_CANCELLED");
    assert.equal(failure.relayStage, "WORK_MISSION");
    assert.equal(failure.completedTransmissions, 0);
    return true;
  });
  assert.equal(client.signals[0], controller.signal);
  assert.equal(client.closed, true);
  assert.deepEqual(client.deletes, ["thread-2", "thread-1"]);
});

test("portable CLI validates and runs through injected dependencies", async () => {
  const portableConfig = config("C:\\portable\\workspace");
  const validated = await runPortableCli(["validate", "--config", "relay.json"], {
    loadConfig: async () => portableConfig,
    runRelay: async () => { throw new Error("must-not-run"); },
  });
  assert.deepEqual(validated, { exitCode: 0, line: "WORK_CODEX_RELAY kind=VALID code=OK version=1.0" });

  const run = await runPortableCli(["run", "--config", "relay.json", "--timeout-ms", "30000"], {
    loadConfig: async () => portableConfig,
    runRelay: async (_loaded, timeoutMs) => {
      const [mission, report, nextPrompt] = outputs("PORTABLE-PHASE", "PORTABLE-POINT").map((message) => JSON.parse(message)) as [MessageEnvelope, MessageEnvelope, MessageEnvelope];
      const messages = [
        { ...mission, content: "LEAK_SENTINEL_MISSION" },
        { ...report, content: "LEAK_SENTINEL_REPORT" },
        { ...nextPrompt, content: "LEAK_SENTINEL_NEXT_PROMPT" },
      ] as const;
      return { relay: { sessionId, threadIds: [], deletedThreadIds: [], messages, messageIds: [], sequence: [1, 2, 3], transmissions: 3, completedTransmissions: timeoutMs === 30_000 ? 3 : 0, stoppedBeforeSecondCodexMission: true, cleanupFailures: [], cleanupErrors: [] }, cleanup: "CONFIRMED" };
    },
  });
  assert.deepEqual(run, { exitCode: 0, line: "WORK_CODEX_RELAY kind=SUCCESS code=OK transmissions=3 cleanup=CONFIRMED" });
  assert.equal(run.line.includes("LEAK_SENTINEL"), false);
});

test("portable CLI keeps failures bounded", async () => {
  const outcome = await runPortableCli(["run", "--config", "missing.json"], {
    loadConfig: async () => { throw new RelayConfigError("CONFIG_READ_FAILED"); },
    runRelay: async () => { throw new Error("must-not-run"); },
  });
  assert.deepEqual(outcome, { exitCode: 1, line: "WORK_CODEX_RELAY kind=FAILURE code=CONFIG_READ_FAILED transmissions=0 cleanup=NOT_CONFIRMED" });
});
