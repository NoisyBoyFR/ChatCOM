import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySdkFailure } from "../codex-sdk-relay.js";
import { runDesktopPreflight, type PreflightDependencies } from "../desktop/preflight.js";
import { validateRelayMessages, type MessageEnvelope } from "../message-contract.js";
import { createMessageForTests, RelayFailure, runLocalRelay } from "../local-relay.js";
import { ConversationOrchestrator, type ConversationRelay } from "../conversation/orchestrator.js";
import type { PortableRelayConfig } from "../relay-config.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function preflightDependencies(overrides: Partial<PreflightDependencies> = {}): PreflightDependencies {
  return {
    inspectRuntime: async () => ({ executablePath: "C:\\codex.exe", packageVersion: "0.149.0", architecture: "x64" }),
    runCommand: async (_path, args) => ({ exitCode: 0, output: args[0] === "--version" ? "codex 0.149.0" : "authenticated" }),
    checkProject: async () => true,
    checkCodexHome: async () => true,
    ...overrides,
  };
}

function routeMessages(type: "NEXT_PROMPT" | "USER_DECISION_REQUIRED"): [MessageEnvelope, MessageEnvelope, MessageEnvelope] {
  const mission = createMessageForTests({ session_id: sessionId, correlation_id: sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", phase: "DESKTOP", point: "PROOF", content: "mission", user_action_needed: false });
  const report = createMessageForTests({ session_id: sessionId, correlation_id: mission.message_id, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", phase: "DESKTOP", point: "PROOF", content: "report", user_action_needed: false });
  const third = createMessageForTests({ session_id: sessionId, correlation_id: report.message_id, sequence: 3, sender: "WORK_LOCAL", recipient: type === "NEXT_PROMPT" ? "CODEX_LOCAL" : "USER", type, phase: "DESKTOP", point: "PROOF", content: type === "NEXT_PROMPT" ? "next" : "Choose the next scope.", user_action_needed: type === "USER_DECISION_REQUIRED" });
  return [mission, report, third];
}

test("classifies SDK failures into the closed allowlist without retaining text", () => {
  assert.equal(classifySdkFailure(new Error("authentication required: secret-detail")), "AUTH_REQUIRED");
  assert.equal(classifySdkFailure({ message: "HTTP 429 rate limit fixture" }), "RATE_LIMITED");
  assert.equal(classifySdkFailure({ message: "network connection fixture" }), "NETWORK_UNAVAILABLE");
  assert.equal(classifySdkFailure({ message: "fixture-secret" }), "RUNTIME_FAILED");
  assert.deepEqual(Object.keys({ failureCategory: classifySdkFailure({ message: "fixture-secret" }) }), ["failureCategory"]);
});

test("preflight is ready without starting a model turn", async () => {
  const result = await runDesktopPreflight("C:\\project", preflightDependencies());
  assert.deepEqual(result, { runtime: { status: "READY", version: "0.149.0", architecture: "x64" }, authentication: { status: "READY" }, project: { status: "READY" }, security: "READ_ONLY", canStart: true });
});

test("preflight reports authentication required and never returns command output", async () => {
  const result = await runDesktopPreflight("C:\\project", preflightDependencies({ runCommand: async (_path, args) => ({ exitCode: args[0] === "--version" ? 0 : 1, output: args[0] === "--version" ? "codex 0.149.0" : "login required fixture-secret" }) }));
  assert.equal(result.authentication.status, "REQUIRED");
  assert.equal(result.canStart, false);
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
});

test("preflight fails closed for an invalid runtime or project", async () => {
  const invalidRuntime = await runDesktopPreflight("C:\\project", preflightDependencies({ inspectRuntime: async () => { throw new Error("private runtime path"); } }));
  assert.equal(invalidRuntime.canStart, false);
  assert.equal(invalidRuntime.runtime.status, "ERROR");
  const invalidProject = await runDesktopPreflight("C:\\missing", preflightDependencies({ checkProject: async () => false }));
  assert.equal(invalidProject.project.status, "ERROR");
  assert.equal(invalidProject.canStart, false);
});

test("validateRelayMessages accepts the exact USER_DECISION_REQUIRED route", () => {
  const messages = routeMessages("USER_DECISION_REQUIRED");
  assert.deepEqual(validateRelayMessages(messages), messages);
  assert.throws(() => validateRelayMessages(routeMessages("USER_DECISION_REQUIRED").map((message, index) => index === 2 ? { ...message, recipient: "CODEX_LOCAL", user_action_needed: false } : message)), /ROLE_TYPE_MISMATCH|INVALID_RELAY_ROUTE/u);
});

test("local relay returns a confirmed USER_DECISION_REQUIRED third transmission", async () => {
  const outputs = routeMessages("USER_DECISION_REQUIRED").map((message) => JSON.stringify(message));
  const turns: { schema: unknown; signal?: AbortSignal }[] = [];
  const agent = {
    async startThread(instructions: string) { return instructions.includes("WORK_LOCAL") ? "work" : "codex"; },
    async runTurn(_threadId: string, _prompt: string, schema?: unknown, signal?: AbortSignal) { turns.push({ schema, signal }); return outputs.shift() ?? "{}"; },
    async deleteThread() {},
  };
  const result = await runLocalRelay(agent, { cwd: "C:\\project", phase: "DESKTOP", point: "PROOF", mission: "Inspect", sessionId });
  assert.equal(result.requiresUserDecision, true);
  assert.equal(result.messages[2].type, "USER_DECISION_REQUIRED");
  assert.equal(result.messages[2].recipient, "USER");
  assert.equal(result.messages[2].user_action_needed, true);
  assert.equal(turns.length, 3);
  assert.ok((turns[2].schema as { anyOf?: unknown[] }).anyOf);
});

class DecisionRelay implements ConversationRelay {
  calls: PortableRelayConfig[] = [];
  async run(config: PortableRelayConfig): Promise<{ relay: { sessionId: string; threadIds: string[]; deletedThreadIds: string[]; messages: readonly [MessageEnvelope, MessageEnvelope, MessageEnvelope]; messageIds: string[]; sequence: number[]; transmissions: number; completedTransmissions: number; stoppedBeforeSecondCodexMission: boolean; requiresUserDecision: boolean; cleanupFailures: string[]; cleanupErrors: string[] }; cleanup: "CONFIRMED" }> {
    this.calls.push(config);
    const messages = routeMessages(this.calls.length === 1 ? "USER_DECISION_REQUIRED" : "NEXT_PROMPT");
    return { relay: { sessionId: messages[0].session_id, threadIds: ["work", "codex"], deletedThreadIds: ["codex", "work"], messages, messageIds: messages.map((message) => message.message_id), sequence: [1, 2, 3], transmissions: 3, completedTransmissions: 3, stoppedBeforeSecondCodexMission: true, requiresUserDecision: this.calls.length === 1, cleanupFailures: [], cleanupErrors: [] }, cleanup: "CONFIRMED" };
  }
}

test("decision route stops before another cycle and resumes only after explicit response", async () => {
  const relay = new DecisionRelay();
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ projectRoot: "C:\\project", phase: "DESKTOP", point: "PROOF", mission: "Inspect", maxCycles: 2 });
  await orchestrator.start();
  assert.equal(orchestrator.snapshot().state, "USER_DECISION_REQUIRED");
  assert.equal(relay.calls.length, 1);
  assert.equal(orchestrator.snapshot().cleanup, "CONFIRMED");
  orchestrator.submitDecision("Continue with the approved read-only scope");
  assert.equal(orchestrator.snapshot().state, "PAUSED");
  await orchestrator.resume();
  assert.equal(relay.calls.length, 2);
  assert.equal(relay.calls[1]?.mission, "Continue with the approved read-only scope");
});

test("bounded SDK fields reach the desktop diagnostic without sensitive text", async () => {
  const relay: ConversationRelay = { run: async () => { throw new RelayFailure("SDK_TURN_FAILED", [], [], [], [], { sdkStage: "TERMINAL_FAILED", sdkLastStage: "TERMINAL_FAILED", terminal: "FAILED", threadStarted: true, turnStarted: true, streamClosed: true, failureCategory: "AUTH_REQUIRED" }, "WORK_MISSION", 0); } };
  const orchestrator = new ConversationOrchestrator(relay);
  orchestrator.configure({ projectRoot: "C:\\project", phase: "DESKTOP", point: "PROOF", mission: "Inspect", maxCycles: 1 });
  await orchestrator.start();
  assert.deepEqual(orchestrator.snapshot().lastDiagnostic, { code: "SDK_TURN_FAILED", relayStage: "WORK_MISSION", completedTransmissions: 0, cleanup: "CONFIRMED", sdkStage: "TERMINAL_FAILED", sdkLastStage: "TERMINAL_FAILED", terminal: "FAILED", threadStarted: true, turnStarted: true, streamClosed: true, failureCategory: "AUTH_REQUIRED" });
});
