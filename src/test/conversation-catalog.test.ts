import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationCatalog, type ConversationCatalogClient } from "../desktop/conversation-catalog.js";

class FakeCatalogClient implements ConversationCatalogClient {
  closed = false;
  async initialize(): Promise<void> {}
  async listAllThreads(): Promise<import("../app-server-client.js").AppServerThreadSummary[]> {
    return [
      { id: "11111111-1111-4111-8111-111111111111", title: "WORK history", cwd: "C:\\Project", updatedAt: 1_700_000_000_000, sourceKind: "vscode" },
      { id: "22222222-2222-4222-8222-222222222222", preview: "CODEX history", cwd: "C:\\Project", status: "systemError", source: "cli" },
    ];
  }
  async listLoadedThreads(): Promise<string[]> { return ["11111111-1111-4111-8111-111111111111"]; }
  async close(): Promise<{ exited: boolean; forced: boolean }> { this.closed = true; return { exited: true, forced: false }; }
}

test("conversation catalog exposes masked cards and keeps exact ids in the main-side selection", async () => {
  const client = new FakeCatalogClient();
  const catalog = new ConversationCatalog({ createClient: async () => client, randomUUID: (() => { let n = 0; return () => `handle-${++n}`; })() });
  const cards = await catalog.discover({ projectRoot: "C:\\Project" });
  assert.equal(client.closed, true);
  assert.equal(cards[0].state, "LOADED");
  assert.equal(cards[1].state, "UNAVAILABLE");
  assert.equal(cards[0].idTail, "…111111");
  assert.doesNotMatch(JSON.stringify(cards), /11111111-1111-4111-8111-111111111111/u);
  assert.equal(catalog.getSelected("handle-1").id, "11111111-1111-4111-8111-111111111111");
  assert.throws(() => catalog.getSelected("handle-2"), /CONVERSATION_UNAVAILABLE/u);
  assert.throws(() => catalog.selectPair("handle-1", "handle-1"), /CONVERSATION_DUPLICATE/u);
});
