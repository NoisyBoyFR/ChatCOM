import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConversationPairStore, summarizeConversationPair, type PersistedConversationPair } from "../desktop/conversation-pair.js";

test("conversation pair persistence is atomic and summaries mask thread ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatcom-pair-"));
  try {
    const pair: PersistedConversationPair = { version: 1, workThreadId: "11111111-1111-4111-8111-111111111111", codexThreadId: "22222222-2222-4222-8222-222222222222", workProjectRoot: "C:\\Project", codexProjectRoot: "C:\\Project", workTitle: "WORK", codexTitle: "CODEX", firstSpeaker: "WORK", objective: "read only", maxCycles: 3, phase: "RC7", point: "DUAL", cycleTimeoutMs: 600000 };
    const store = new ConversationPairStore(join(directory, "pair.json"));
    await store.write(pair);
    assert.deepEqual(await store.read(), pair);
    const summary = summarizeConversationPair(pair);
    assert.equal(summary.workThreadTail, "…111111");
    assert.equal(summary.codexThreadTail, "…222222");
    assert.doesNotMatch(JSON.stringify(summary), /11111111-1111-4111-8111-111111111111/u);
    await store.clear();
    assert.equal(await store.read(), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
