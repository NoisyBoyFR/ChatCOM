import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppServerClientError } from "../app-server-client.js";
import type { CodexSdkRelayClient } from "../codex-sdk-relay.js";
import { createMessageForTests } from "../local-relay.js";
import type { MessageEnvelope } from "../message-contract.js";
import { RelayFailure } from "../local-relay.js";
import { WorkHostBridge } from "../work-host-bridge.js";

const config = { version: "1.0" as const, projectRoot: "C:\\project", phase: "RC5", point: "BRIDGE", mission: "config mission" };
const sessionId = "11111111-1111-4111-8111-111111111111";
const missionId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";
const nextId = "44444444-4444-4444-8444-444444444444";

function mission(): MessageEnvelope {
  return createMessageForTests({ session_id: sessionId, message_id: missionId, correlation_id: sessionId, sequence: 1, sender: "WORK_HOST", recipient: "CODEX_LOCAL", type: "MISSION", phase: config.phase, point: config.point, content: "Inspect without changing files.", user_action_needed: false });
}

function nextPrompt(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return createMessageForTests({ session_id: sessionId, message_id: nextId, correlation_id: reportId, sequence: 3, sender: "WORK_HOST", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", phase: config.phase, point: config.point, content: "Prepare the bounded next prompt.", user_action_needed: false, ...overrides });
}

class FakeClient implements CodexSdkRelayClient {
  readonly starts: string[] = [];
  readonly turns: { threadId: string; schema: any; signal?: AbortSignal }[] = [];
  readonly deletes: string[] = [];
  closeCalls = 0;
  deleteError = false;
  runError: AppServerClientError | undefined;

  async initialize(): Promise<void> {}
  async startThread(): Promise<string> { this.starts.push("codex-thread"); return "internal-thread-id"; }
  async runTurn(threadId: string, _prompt: string, schema?: unknown, signal?: AbortSignal): Promise<string> {
    this.turns.push({ threadId, schema, signal });
    if (this.runError !== undefined) throw this.runError;
    return JSON.stringify(createMessageForTests({ session_id: sessionId, message_id: reportId, correlation_id: missionId, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_HOST", type: "REPORT", phase: config.phase, point: config.point, content: "Bounded technical report.", user_action_needed: false }));
  }
  async deleteThread(threadId: string): Promise<void> { if (this.deleteError) throw new AppServerClientError("THREAD_DELETE_UNCONFIRMED"); this.deletes.push(threadId); }
  async close(): Promise<{ exited: boolean; forced: boolean }> { this.closeCalls += 1; return { exited: true, forced: false }; }
}

function bridgeWith(client: FakeClient): WorkHostBridge {
  return new WorkHostBridge({ createClient: async () => client, randomUUID: () => sessionId });
}

test("WORK_HOST exchange returns REPORT, then completes exactly three transmissions", async () => {
  const client = new FakeClient();
  const bridge = bridgeWith(client);
  const opened = await bridge.open(config, mission(), 10_000, 10_000);
  assert.equal(opened.communicationMode, "REAL_WORK_HOST");
  assert.equal(opened.workHost, "MCP_HOST");
  assert.equal(opened.workAuthentication, "WORK_AUTH_MANAGED_BY_HOST");
  assert.equal(opened.transmissions, 2);
  assert.equal(opened.cleanup, "PENDING");
  assert.equal(opened.report.type, "REPORT");
  assert.equal(client.turns.length, 1);
  assert.deepEqual(client.turns[0].schema.properties.sender.enum, ["CODEX_LOCAL"]);
  assert.deepEqual(client.turns[0].schema.properties.recipient.enum, ["WORK_HOST"]);
  assert.deepEqual(client.turns[0].schema.properties.type.enum, ["REPORT"]);
  assert.equal(JSON.stringify(client.turns[0].schema).includes("\"const\""), false);
  const completed = await bridge.complete(sessionId, nextPrompt());
  assert.deepEqual({ transmissions: completed.transmissions, cleanup: completed.cleanup }, { transmissions: 3, cleanup: "CONFIRMED" });
  assert.deepEqual(client.deletes, ["internal-thread-id"]);
  assert.equal(client.closeCalls, 1);
  assert.equal(client.turns.length, 1, "the NEXT_PROMPT must not launch a second Codex mission");
});

test("WORK_HOST rejects replay, wrong session, correlation and role without exposing identifiers", async () => {
  const client = new FakeClient();
  const bridge = bridgeWith(client);
  await bridge.open(config, mission(), 10_000, 10_000);
  await assert.rejects(bridge.open(config, mission(), 10_000, 10_000), (error) => error instanceof RelayFailure && error.code === "WORK_HOST_SESSION_REPLAY");
  await assert.rejects(bridge.complete(sessionId, nextPrompt({ session_id: "55555555-5555-4555-8555-555555555555" })), (error) => error instanceof RelayFailure && error.code === "WORK_HOST_NEXT_PROMPT_ROUTE_INVALID" && error.cleanupErrors.includes("EXCHANGE_OPEN"));
  await assert.rejects(bridge.complete(sessionId, nextPrompt({ correlation_id: missionId })), (error) => error instanceof RelayFailure && error.code === "WORK_HOST_NEXT_PROMPT_ROUTE_INVALID");
  await assert.rejects(bridge.complete(sessionId, nextPrompt({ sender: "WORK_LOCAL" })), (error) => error instanceof RelayFailure && error.code === "WORK_HOST_NEXT_PROMPT_ROUTE_INVALID");
  assert.equal(client.deletes.length, 0);
  const completed = await bridge.complete(sessionId, nextPrompt());
  assert.equal(completed.cleanup, "CONFIRMED");
});

test("WORK_HOST expiration cleans the single thread and client", async () => {
  const client = new FakeClient();
  const bridge = bridgeWith(client);
  await bridge.open(config, mission(), 1_000, 20);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(bridge.activeExchangeCount(), 0);
  assert.deepEqual(client.deletes, ["internal-thread-id"]);
  assert.equal(client.closeCalls, 1);
});

test("primary cleanup failure remains bounded and cleanup is not confirmed", async () => {
  const client = new FakeClient();
  client.deleteError = true;
  const bridge = bridgeWith(client);
  await bridge.open(config, mission(), 10_000, 10_000);
  await assert.rejects(bridge.complete(sessionId, nextPrompt()), (error) => error instanceof RelayFailure && error.code === "CLEANUP_FAILED" && error.cleanupErrors.includes("THREAD_DELETE_UNCONFIRMED"));
});

test("preserves the bounded SDK REPORT diagnostic while cleanup remains primary only when it fails", async () => {
  const client = new FakeClient();
  client.runError = new AppServerClientError("SDK_TURN_FAILED", {
    sdkStage: "TERMINAL_FAILED",
    sdkLastStage: "TERMINAL_FAILED",
    terminal: "FAILED",
    threadStarted: true,
    turnStarted: true,
    streamClosed: true,
    failureCategory: "OUTPUT_SCHEMA_REJECTED",
  });
  await assert.rejects(bridgeWith(client).open(config, mission(), 10_000, 10_000), (error) => {
    assert.ok(error instanceof RelayFailure);
    assert.equal(error.code, "SDK_TURN_FAILED");
    assert.equal(error.relayStage, "CODEX_REPORT");
    assert.equal(error.completedTransmissions, 1);
    assert.deepEqual(error.primaryDiagnostic, {
      sdkStage: "TERMINAL_FAILED",
      sdkLastStage: "TERMINAL_FAILED",
      terminal: "FAILED",
      threadStarted: true,
      turnStarted: true,
      streamClosed: true,
      failureCategory: "OUTPUT_SCHEMA_REJECTED",
    });
    return true;
  });
  assert.deepEqual(client.deletes, ["internal-thread-id"]);
  assert.equal(client.closeCalls, 1);
});

test("cancelled WORK_HOST opening never creates a Codex thread", async () => {
  const client = new FakeClient();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(bridgeWith(client).open(config, mission(), 10_000, 10_000, controller.signal), (error) => error instanceof RelayFailure && error.code === "RELAY_CANCELLED");
  assert.equal(client.starts.length, 0);
});
