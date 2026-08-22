import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createMessage } from "../message-contract.js";
import { DualConversationDialogue, type DualDialogueClient } from "../desktop/dual-dialogue.js";

class FakeDualClient implements DualDialogueClient {
  readonly resumed: string[] = [];
  readonly turns: Array<{ threadId: string; schema: any }> = [];
  closed = false;
  async initialize(): Promise<void> {}
  async resumeThread(threadId: string): Promise<{ id: string }> { this.resumed.push(threadId); return { id: threadId }; }
  async runTurn(threadId: string, _prompt: string, outputSchema: any): Promise<string> {
    this.turns.push({ threadId, schema: outputSchema });
    const value = (name: string): unknown => outputSchema.properties[name]?.enum?.[0];
    return JSON.stringify(createMessage({ session_id: value("session_id") as string, correlation_id: value("correlation_id") as string, sequence: value("sequence") as number, sender: value("sender") as "WORK_LOCAL" | "CODEX_LOCAL", recipient: value("recipient") as "WORK_LOCAL" | "CODEX_LOCAL", type: value("type") as "MISSION" | "REPORT" | "NEXT_PROMPT", phase: value("phase") as string, point: value("point") as string, content: `synthetic-${this.turns.length}`, user_action_needed: false, message_id: randomUUID(), created_at: new Date(1_700_000_000_000 + this.turns.length).toISOString() }));
  }
  async close(): Promise<{ exited: boolean; forced: boolean }> { this.closed = true; return { exited: true, forced: false }; }
}

test("dual dialogue resumes the selected threads and completes one bounded three-message cycle", async () => {
  const client = new FakeDualClient();
  const dialogue = new DualConversationDialogue({ workThreadId: "work-thread", codexThreadId: "codex-thread", projectRoot: "C:\\Project", phase: "RC7", point: "DUAL", objective: "Inspect", firstSpeaker: "WORK", maxCycles: 1, cycleTimeoutMs: 600_000 }, { createClient: async () => client, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  const result = await dialogue.start();
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.messages.length, 3);
  assert.equal(result.cleanup, "CONFIRMED");
  assert.deepEqual(client.resumed, ["work-thread", "codex-thread"]);
  assert.deepEqual(client.turns.map((turn) => turn.threadId), ["work-thread", "codex-thread", "work-thread"]);
  assert.deepEqual(client.turns.map((turn) => turn.schema.properties.type.enum[0]), ["MISSION", "REPORT", "NEXT_PROMPT"]);
  assert.equal(client.closed, true);
});

test("dual dialogue rejects duplicate selected threads before any client is created", () => {
  assert.throws(() => new DualConversationDialogue({ workThreadId: "same", codexThreadId: "same", projectRoot: "C:\\Project", phase: "RC7", point: "DUAL", objective: "", firstSpeaker: "CODEX", maxCycles: 3, cycleTimeoutMs: 1 }), /CONVERSATION_DUPLICATE/u);
});
