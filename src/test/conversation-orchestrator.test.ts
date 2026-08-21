import assert from "node:assert/strict";
import test from "node:test";
import { createMessageForTests, type MessageEnvelope } from "../index.js";
import {
  ConversationOrchestrator,
  type ConversationRelay,
  type ConversationEvent,
} from "../conversation/orchestrator.js";
import { RelayFailure } from "../local-relay.js";
import type { PortableRelayConfig } from "../relay-config.js";

function relayResult(config: PortableRelayConfig, sessionId: string, userActionNeeded = false) {
  const mission = createMessageForTests({
    session_id: sessionId,
    correlation_id: sessionId,
    sequence: 1,
    sender: "WORK_LOCAL",
    recipient: "CODEX_LOCAL",
    type: "MISSION",
    phase: config.phase,
    point: config.point,
    content: config.mission,
    user_action_needed: false,
  });
  const report = createMessageForTests({
    session_id: sessionId,
    correlation_id: mission.message_id,
    sequence: 2,
    sender: "CODEX_LOCAL",
    recipient: "WORK_LOCAL",
    type: "REPORT",
    phase: config.phase,
    point: config.point,
    content: `report:${config.mission}`,
    user_action_needed: false,
  });
  const nextPrompt = createMessageForTests({
    session_id: sessionId,
    correlation_id: report.message_id,
    sequence: 3,
    sender: "WORK_LOCAL",
    recipient: "CODEX_LOCAL",
    type: "NEXT_PROMPT",
    phase: config.phase,
    point: config.point,
    content: `next:${config.mission}`,
    user_action_needed: userActionNeeded,
  });
  return {
    relay: {
      sessionId,
      threadIds: ["work", "codex"],
      deletedThreadIds: ["codex", "work"],
      messages: [mission, report, nextPrompt] as readonly [MessageEnvelope, MessageEnvelope, MessageEnvelope],
      messageIds: [mission.message_id, report.message_id, nextPrompt.message_id],
      sequence: [1, 2, 3],
      transmissions: 3,
      completedTransmissions: 3,
      stoppedBeforeSecondCodexMission: true,
      requiresUserDecision: false,
      cleanupFailures: [],
      cleanupErrors: [],
    },
    cleanup: "CONFIRMED" as const,
  };
}

class FakeRelay implements ConversationRelay {
  readonly calls: Array<{ config: PortableRelayConfig; sessionId: string; signal: AbortSignal }> = [];
  cleanup: "CONFIRMED" | "NOT_CONFIRMED" = "CONFIRMED";
  delayMs = 0;
  userActionNeeded = false;

  async run(config: PortableRelayConfig, options: { timeoutMs: number; sessionId: string; signal: AbortSignal }) {
    this.calls.push({ config, sessionId: options.sessionId, signal: options.signal });
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new RelayFailure("RELAY_CANCELLED", [], [], [], [], undefined, "WORK_MISSION", 0));
        }, { once: true });
      });
    }
    const result = relayResult(config, options.sessionId, this.userActionNeeded);
    return { ...result, cleanup: this.cleanup };
  }
}

function input() {
  return { projectRoot: "C:\\ChatCOM", phase: "DESKTOP", point: "ORCHESTRATOR", mission: "Inspect without changing files" };
}

test("runs one bounded cycle with exactly three transmissions", async () => {
  const relay = new FakeRelay();
  const events: ConversationEvent[] = [];
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.subscribe((event) => events.push(event));
  orchestrator.configure({ ...input(), maxCycles: 1 });
  await orchestrator.start();
  assert.equal(orchestrator.snapshot().state, "COMPLETED");
  assert.equal(events.filter((event) => event.kind === "transmission").length, 3);
  assert.equal(relay.calls.length, 1);
  assert.equal(orchestrator.snapshot().cleanup, "CONFIRMED");
});

test("uses a new session per cycle and the prior NEXT_PROMPT as the next mission", async () => {
  const relay = new FakeRelay();
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ ...input(), maxCycles: 3 });
  await orchestrator.start();
  assert.equal(relay.calls.length, 3);
  assert.equal(new Set(relay.calls.map((call) => call.sessionId)).size, 3);
  assert.equal(relay.calls[1]?.config.mission, "next:Inspect without changing files");
  assert.equal(relay.calls[2]?.config.mission, "next:next:Inspect without changing files");
});

test("pauses after a clean cycle and resumes with the next cycle", async () => {
  const relay = new FakeRelay();
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.subscribe((event) => {
    if (event.kind === "cycle_completed" && event.cycle === 1) orchestrator.requestPause();
  });
  orchestrator.configure({ ...input(), maxCycles: 2 });
  await orchestrator.start();
  assert.equal(orchestrator.snapshot().state, "PAUSED");
  await orchestrator.resume();
  assert.equal(orchestrator.snapshot().state, "COMPLETED");
  assert.equal(relay.calls.length, 2);
});

test("does not start a cycle after unconfirmed cleanup", async () => {
  const relay = new FakeRelay();
  relay.cleanup = "NOT_CONFIRMED";
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ ...input(), maxCycles: 3 });
  await orchestrator.start();
  assert.equal(orchestrator.snapshot().state, "FAILED");
  assert.equal(orchestrator.snapshot().cleanup, "NOT_CONFIRMED");
  assert.equal(relay.calls.length, 1);
});

test("stops an active cycle through AbortController and exposes only bounded diagnostics", async () => {
  const relay = new FakeRelay();
  relay.delayMs = 1000;
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ ...input(), maxCycles: 2 });
  const startPromise = orchestrator.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await orchestrator.stop();
  await startPromise;
  assert.equal(orchestrator.snapshot().state, "STOPPED");
  assert.equal(relay.calls[0]?.signal.aborted, true);
  assert.equal(orchestrator.snapshot().lastDiagnostic?.completedTransmissions, 0);
  assert.deepEqual(Object.keys(orchestrator.snapshot().lastDiagnostic ?? {}).sort(), ["cleanup", "code", "completedTransmissions", "relayStage"]);
});

test("stops at USER_DECISION_REQUIRED without starting the next cycle", async () => {
  const relay = new FakeRelay();
  relay.userActionNeeded = true;
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ ...input(), maxCycles: 3 });
  await orchestrator.start();
  assert.equal(orchestrator.snapshot().state, "USER_DECISION_REQUIRED");
  assert.equal(relay.calls.length, 1);
});
