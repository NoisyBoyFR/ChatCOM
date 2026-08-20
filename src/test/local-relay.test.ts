import assert from "node:assert/strict";
import { test } from "node:test";
import { AppServerClientError } from "../app-server-client.js";
import { createMessageForTests, runLocalRelay, RelayFailure } from "../local-relay.js";
import type { MessageEnvelope } from "../message-contract.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function relayRequest(phase = "CHATCOM-TEST", point = "RELAY-1") {
  return { cwd: "C:\\synthetic\\fixture", phase, point, mission: "synthetic mission", sessionId };
}

function fixtureMessages(): [MessageEnvelope, MessageEnvelope, MessageEnvelope] {
  const mission = createMessageForTests({ session_id: sessionId, message_id: "22222222-2222-4222-8222-222222222222", correlation_id: sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase: "CHATCOM-TEST", point: "RELAY-1", content: "synthetic mission", user_action_needed: false });
  const report = createMessageForTests({ session_id: sessionId, message_id: "33333333-3333-4333-8333-333333333333", correlation_id: mission.message_id, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", phase: "CHATCOM-TEST", point: "RELAY-1", content: "synthetic report", user_action_needed: false });
  const next = createMessageForTests({ session_id: sessionId, message_id: "44444444-4444-4444-8444-444444444444", correlation_id: report.message_id, sequence: 3, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", phase: "CHATCOM-TEST", point: "RELAY-1", content: "synthetic next prompt", user_action_needed: false });
  return [mission, report, next];
}

class FakeRelayAgent {
  readonly starts: string[] = [];
  readonly turns: { threadId: string; prompt: string }[] = [];
  readonly deletes: string[] = [];
  constructor(private readonly outputs: string[], private readonly failureOnCall?: number) {}
  async startThread(instructions: string): Promise<string> { const id = instructions.includes("WORK_LOCAL") ? "work-thread" : "codex-thread"; this.starts.push(id); return id; }
  async runTurn(threadId: string, prompt: string): Promise<string> { this.turns.push({ threadId, prompt }); if (this.failureOnCall === this.turns.length) throw new AppServerClientError("TURN_TIMEOUT", { method: "turn/start", retryCount: 2, retryCategoryCounts: { "codexErrorInfo:responseStreamDisconnected": 2 } }); return this.outputs.shift() ?? "{}"; }
  async deleteThread(threadId: string): Promise<void> { this.deletes.push(threadId); }
}

class FailingCleanupAgent extends FakeRelayAgent {
  constructor(private readonly failureCode: string) { super([]); }
  override async runTurn(): Promise<string> { throw new AppServerClientError(this.failureCode, { method: "turn/start", finalStatus: "failed" }); }
  override async deleteThread(threadId: string): Promise<void> {
    if (threadId === "codex-thread") throw new AppServerClientError("THREAD_DELETE_UNCONFIRMED");
    await super.deleteThread(threadId);
  }
}

test("runs three automatic transmissions and stops before the second Codex mission", async () => {
  const messages = fixtureMessages();
  const agent = new FakeRelayAgent(messages.map((message) => JSON.stringify(message)));
  const result = await runLocalRelay(agent, relayRequest());
  assert.equal(result.transmissions, 3);
  assert.equal(result.completedTransmissions, 3);
  assert.equal(result.stoppedBeforeSecondCodexMission, true);
  assert.deepEqual(result.sequence, [1, 2, 3]);
  assert.deepEqual(result.messages, messages);
  assert.equal(result.messages[1].type, "REPORT");
  assert.equal(result.messages[2].type, "NEXT_PROMPT");
  assert.deepEqual(agent.turns.map((turn) => turn.threadId), ["work-thread", "codex-thread", "work-thread"]);
  assert.deepEqual(agent.deletes, ["codex-thread", "work-thread"]);
});

test("preserves the failing relay stage and completed transmission count", async () => {
  const outputs = fixtureMessages().map((message) => JSON.stringify(message));
  const expected = [
    ["WORK_MISSION", 0],
    ["CODEX_REPORT", 1],
    ["WORK_NEXT_PROMPT", 2],
  ] as const;
  for (const [stage, completed] of expected) {
    const call = completed + 1;
    const agent = new FakeRelayAgent([...outputs], call);
    await assert.rejects(runLocalRelay(agent, relayRequest()), (error) => {
      assert.ok(error instanceof RelayFailure);
      assert.equal(error.relayStage, stage);
      assert.equal(error.completedTransmissions, completed);
      assert.equal(error.code, "TURN_TIMEOUT");
      return true;
    });
  }
});

test("cleans both synthetic threads after a relay error", async () => {
  const messages = fixtureMessages();
  const agent = new FakeRelayAgent([JSON.stringify(messages[0]), "invalid json"]);
  await assert.rejects(runLocalRelay(agent, relayRequest()), (error) => error instanceof RelayFailure && error.code === "INVALID_MESSAGE_JSON");
  assert.deepEqual(agent.deletes, ["codex-thread", "work-thread"]);
});

test("does not execute a fourth turn even when the next prompt exists", async () => {
  const agent = new FakeRelayAgent(fixtureMessages().map((message) => JSON.stringify(message)));
  await runLocalRelay(agent, relayRequest());
  assert.equal(agent.turns.length, 3);
});

test("preserves the primary relay failure while reporting partial cleanup separately", async () => {
  const agent = new FailingCleanupAgent("TURN_TIMEOUT");
  await assert.rejects(runLocalRelay(agent, relayRequest()), (error) => {
    assert.ok(error instanceof RelayFailure);
    assert.equal(error.code, "TURN_TIMEOUT");
    assert.deepEqual(error.cleanupFailures, ["codex-thread"]);
    assert.deepEqual(error.cleanupErrors, ["THREAD_DELETE_UNCONFIRMED"]);
    assert.deepEqual(error.deletedThreadIds, ["work-thread"]);
    assert.equal(error.primaryDiagnostic?.method, "turn/start");
    return true;
  });
});

test("routes the same relay core across independent project phases", async () => {
  const phase = "PROJECT-BETA";
  const point = "REVIEW-7";
  const messages = fixtureMessages().map((message) => ({ ...message, phase, point }));
  const agent = new FakeRelayAgent(messages.map((message) => JSON.stringify(message)));
  const result = await runLocalRelay(agent, relayRequest(phase, point));
  assert.equal(result.completedTransmissions, 3);
  assert.equal(agent.turns.every(({ prompt }) => !prompt.includes("RELAY-1")), true);
  assert.equal(agent.turns[0].prompt.includes("PROJECT-BETA"), true);
  assert.equal(agent.turns[0].prompt.includes("REVIEW-7"), true);
});

test("rejects invalid portable relay input before starting an agent", async () => {
  const agent = new FakeRelayAgent([]);
  await assert.rejects(runLocalRelay(agent, { ...relayRequest(), mission: "" }), (error) => error instanceof RelayFailure && error.code === "INVALID_RELAY_MISSION");
  assert.equal(agent.starts.length, 0);
});
