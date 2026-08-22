import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BindingStore } from "../desktop/bindings.js";

const threadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function storeFixture(): Promise<{ store: BindingStore; file: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "chatcom-binding-"));
  const file = join(root, "bindings.json");
  return { store: new BindingStore(file), file, root };
}

test("creates, validates, lists, disables and removes a binding without exposing its thread id", async () => {
  const fixture = await storeFixture();
  const created = await fixture.store.create("FitMyLife CODEX", fixture.root, threadId);
  assert.equal(created.mode, "PERSISTENT_BOUND");
  assert.equal(created.state, "VALID");
  assert.equal(created.threadTail, "…aaaaaa");
  assert.equal(JSON.stringify(created).includes(threadId), false);
  assert.equal((await fixture.store.validate(created.bindingId, fixture.root)).state, "VALID");
  assert.equal((await fixture.store.list()).length, 1);
  await fixture.store.disable(created.bindingId);
  assert.equal((await fixture.store.list())[0]?.state, "DISABLED");
  await fixture.store.remove(created.bindingId);
  assert.deepEqual(await fixture.store.list(), []);
});

test("rejects duplicate aliases, invalid ids and project differences", async () => {
  const fixture = await storeFixture();
  const created = await fixture.store.create("Exact alias", fixture.root, threadId);
  await assert.rejects(fixture.store.create("exact ALIAS", fixture.root, threadId), /BINDING_ALIAS_DUPLICATE/u);
  await assert.rejects(fixture.store.get(created.bindingId, join(fixture.root, "missing")), /BINDING_PROJECT_UNAVAILABLE/u);
  await assert.rejects(fixture.store.get("not-a-uuid"), /BINDING_ID_INVALID/u);
  await assert.rejects(fixture.store.create("bad", fixture.root, "not-a-thread-id"), /BINDING_THREAD_ID_INVALID/u);
});

test("accepts Codex UUIDv7 thread identifiers", async () => {
  const fixture = await storeFixture();
  const created = await fixture.store.create("Codex v7", fixture.root, "01a00f4c-9d87-79e2-9077-8d15191d32b5");
  assert.equal(created.state, "VALID");
});
