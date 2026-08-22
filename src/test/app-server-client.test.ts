import assert from "node:assert/strict";
import { test } from "node:test";
import { AppServerClient, type JsonLinePeer } from "../app-server-client.js";

class FakePeer implements JsonLinePeer {
  readonly sent: unknown[] = [];
  private lineListener: ((line: string) => void) | undefined;
  private closeListener: (() => void) | undefined;
  private errorListener: ((error: unknown) => void) | undefined;
  waitForExitResult = true;
  terminateCalls = 0;

  send(value: unknown): void { this.sent.push(value); }
  onLine(listener: (line: string) => void): void { this.lineListener = listener; }
  onClose(listener: () => void): void { this.closeListener = listener; }
  onError(listener: (error: unknown) => void): void { this.errorListener = listener; }
  close(): void { this.closeListener?.(); }
  emit(value: unknown): void { this.lineListener?.(JSON.stringify(value)); }
  emitRaw(value: string): void { this.lineListener?.(value); }
  emitClose(): void { this.closeListener?.(); }
  emitError(error: unknown): void { this.errorListener?.(error); }
  async waitForExit(): Promise<boolean> { return this.waitForExitResult; }
  terminate(): void { this.terminateCalls += 1; this.waitForExitResult = true; }
}

function requestId(peer: FakePeer): number {
  const last = peer.sent.at(-1) as { id: number };
  return last.id;
}

async function initializedClient(peer: FakePeer, requestTimeout = 100, turnTimeout = requestTimeout, cleanupTimeout = Math.min(20, requestTimeout)): Promise<AppServerClient> {
  const client = new AppServerClient(peer, requestTimeout, turnTimeout, cleanupTimeout);
  const initialized = client.initialize();
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { platformOs: "windows" } });
  await initialized;
  return client;
}

function waitForMethod(peer: FakePeer, method: string): Promise<void> {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (peer.sent.some((value) => (value as { method?: string }).method === method)) {
        clearInterval(poll);
        resolve();
      }
    }, 1);
  });
}

test("correlates JSON-RPC responses and sends notifications", async () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  const response = client.request<{ ok: boolean }>("test", {});
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { ok: true } });
  assert.deepEqual(await response, { ok: true });
  client.notify("initialized");
  assert.equal((peer.sent.at(-1) as { method: string }).method, "initialized");
});

test("rejects unknown server requests and declines known interaction requests", () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  peer.emit({ jsonrpc: "2.0", id: 99, method: "unknown/request", params: {} });
  assert.equal((peer.sent.at(-1) as { error: { code: number } }).error.code, -32601);
  peer.emit({ jsonrpc: "2.0", id: 100, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1" } });
  assert.deepEqual((peer.sent.at(-1) as { result: unknown }).result, { decision: "decline" });
  peer.emit({ jsonrpc: "2.0", id: 101, method: "item/tool/requestUserInput", params: { threadId: "thread-1", turnId: "turn-1" } });
  assert.deepEqual((peer.sent.at(-1) as { result: unknown }).result, { answers: {} });
});

test("fails closed for every supported interaction family", () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  const cases: [string, unknown][] = [
    ["item/commandExecution/requestApproval", { decision: "decline" }],
    ["item/fileChange/requestApproval", { decision: "decline" }],
    ["item/permissions/requestApproval", { permissions: {}, scope: "turn" }],
    ["item/tool/requestUserInput", { answers: {} }],
    ["mcpServer/elicitation/request", { action: "decline", content: null, _meta: null }],
  ];
  for (const [method, expected] of cases) {
    peer.emit({ jsonrpc: "2.0", id: peer.sent.length + 1, method, params: { threadId: "thread-1", turnId: "turn-1" } });
    assert.deepEqual((peer.sent.at(-1) as { result: unknown }).result, expected);
  }
  peer.emit({ jsonrpc: "2.0", id: 99, method: "dynamic/unknown", params: {} });
  assert.equal((peer.sent.at(-1) as { error: { code: number } }).error.code, -32601);
});

test("rejects timeout, unexpected close, invalid JSON and oversized lines", async () => {
  const timeoutPeer = new FakePeer();
  const timeoutClient = new AppServerClient(timeoutPeer, 10);
  await assert.rejects(timeoutClient.request("timeout", {}), /REQUEST_TIMEOUT/);
  const closePeer = new FakePeer();
  const closeClient = new AppServerClient(closePeer, 100);
  const closed = closeClient.request("close", {});
  closePeer.emitClose();
  await assert.rejects(closed, /PROCESS_CLOSED/);
  const invalidPeer = new FakePeer();
  const invalidClient = new AppServerClient(invalidPeer, 100);
  const invalid = invalidClient.request("invalid", {});
  invalidPeer.emitRaw("not-json");
  await assert.rejects(invalid, /INVALID_JSON_LINE/);
  const largePeer = new FakePeer();
  const largeClient = new AppServerClient(largePeer, 100);
  const large = largeClient.request("large", {});
  largePeer.emitRaw(`{"x":"${"x".repeat(65_536)}"}`);
  await assert.rejects(large, /JSON_LINE_TOO_LARGE/);
});

test("performs the initialize handshake", async () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  const initialized = client.initialize();
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { platformOs: "windows" } });
  await initialized;
  assert.equal((peer.sent[0] as { method: string }).method, "initialize");
  assert.equal((peer.sent[1] as { method: string }).method, "initialized");
});

test("requires the handshake before model/list and preserves the JSONL order", async () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  await assert.rejects(client.listModels(), /NOT_INITIALIZED/);
  const initialized = client.initialize();
  assert.equal((peer.sent[0] as { method: string }).method, "initialize");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { platformOs: "windows" } });
  await initialized;
  const models = client.listModels();
  assert.deepEqual(peer.sent.map((value) => (value as { method?: string }).method), ["initialize", "initialized", "model/list"]);
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { data: [{ id: "synthetic-model", isDefault: true }] } });
  assert.deepEqual(await models, [{ id: "synthetic-model", isDefault: true }]);
  await client.close();
});

test("starts non-ephemeral read-only threads", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const started = client.startThread({ cwd: "C:\\synthetic", baseInstructions: "read only" });
  const request = peer.sent.at(-1) as { params: Record<string, unknown> };
  assert.equal(request.params.ephemeral, false);
  assert.equal(request.params.sandbox, "read-only");
  assert.equal(request.params.approvalPolicy, "never");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { thread: { id: "thread-1" } } });
  assert.deepEqual(await started, { id: "thread-1" });
});

test("lists, paginates and resumes existing read-only conversations without creating threads", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const listed = client.listAllThreads({ cwd: "C:\\synthetic", sourceKinds: ["cli", "vscode"] });
  assert.equal((peer.sent.at(-1) as { method: string }).method, "thread/list");
  assert.deepEqual((peer.sent.at(-1) as { params: unknown }).params, { cursor: null, limit: 100, archived: false, cwd: "C:\\synthetic", sourceKinds: ["cli", "vscode"] });
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { data: [{ id: "thread-a", title: "A", source: "vscode" }], nextCursor: "page-2" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((peer.sent.at(-1) as { method: string }).method, "thread/list");
  assert.equal((peer.sent.at(-1) as { params: { cursor: string } }).params.cursor, "page-2");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { data: [{ id: "thread-b", title: "B", sourceKind: "cli" }] } });
  assert.deepEqual(await listed, [{ id: "thread-a", title: "A", source: "vscode", sourceKind: "vscode" }, { id: "thread-b", title: "B", sourceKind: "cli" }]);

  const loaded = client.listLoadedThreads();
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { data: ["thread-a"] } });
  assert.deepEqual(await loaded, ["thread-a"]);

  const resumed = client.resumeThread("thread-a");
  const resumeRequest = peer.sent.at(-1) as { method: string; params: Record<string, unknown> };
  assert.equal(resumeRequest.method, "thread/resume");
  assert.deepEqual(resumeRequest.params, { threadId: "thread-a", excludeTurns: true, sandbox: "read-only", approvalPolicy: "never" });
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { thread: { id: "thread-a" } } });
  assert.deepEqual(await resumed, { id: "thread-a" });
  await client.close();
});

test("lists models and passes an explicit model to isolated threads", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const models = client.listModels();
  const listRequest = peer.sent.at(-1) as { method: string; params: unknown };
  assert.equal(listRequest.method, "model/list");
  assert.deepEqual(listRequest.params, { limit: 20, includeHidden: false });
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { data: [{ id: "synthetic-model" }] } });
  assert.deepEqual(await models, [{ id: "synthetic-model" }]);
  const started = client.startThread({ cwd: "C:\\synthetic", baseInstructions: "read only", model: "synthetic-model" });
  const request = peer.sent.at(-1) as { params: Record<string, unknown> };
  assert.equal(request.params.model, "synthetic-model");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { thread: { id: "thread-model" } } });
  assert.deepEqual(await started, { id: "thread-model" });
});

test("collects the final agent message from matching item/completed", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const turn = client.runTurn("thread-1", "synthetic");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  peer.emit({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item: { type: "agentMessage", id: "item-1", phase: "final_answer", text: JSON.stringify({ ok: true }) } } });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } });
  assert.equal(await turn, JSON.stringify({ ok: true }));
});

test("waits for turn/completed after a non-retryable error", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const failure = client.runTurn("thread-1", "synthetic failure");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId: "turn-1", willRetry: false, error: { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } }, message: "secret", additionalDetails: "private" } } });
  let settled = false;
  void failure.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed" } } });
  await assert.rejects(failure, (error: unknown) => {
    assert.equal((error as { code?: string }).code, "TURN_FAILED");
    const diagnostic = (error as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
    assert.equal(diagnostic.category, "codexErrorInfo:responseStreamDisconnected");
    assert.equal(diagnostic.httpStatusCode, 502);
    assert.equal(diagnostic.willRetry, false);
    assert.equal(diagnostic.retryCount, 0);
    assert.equal(diagnostic.finalStatus, "failed");
    assert.doesNotMatch(JSON.stringify(error), /secret|private/iu);
    return true;
  });
});

test("uses a completion cached before the waiter is installed", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const failure = client.runTurn("thread-1", "cached failure");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId: "turn-1", willRetry: false, error: { codexErrorInfo: "unauthorized" } } });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed" } } });
  await assert.rejects(failure, (error: unknown) => {
    const diagnostic = (error as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
    assert.equal((error as { code?: string }).code, "TURN_FAILED");
    assert.equal(diagnostic.category, "codexErrorInfo:unauthorized");
    assert.equal(diagnostic.finalStatus, "failed");
    return true;
  });
});

test("ignores completed items from another thread and another turn", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const turn = client.runTurn("thread-1", "synthetic");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  for (const [threadId, turnId] of [["thread-other", "turn-1"], ["thread-1", "turn-other"]]) {
    peer.emit({ jsonrpc: "2.0", method: "item/completed", params: { threadId, turnId, completedAtMs: 1, item: { type: "agentMessage", id: "wrong", phase: "final_answer", text: "wrong" } } });
  }
  peer.emit({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item: { type: "agentMessage", id: "right", phase: "final_answer", text: "right" } } });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } });
  assert.equal(await turn, "right");
});

test("selects the last final-answer item deterministically and rejects an empty result", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const turn = client.runTurn("thread-1", "synthetic");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  for (const text of ["intermediate", "final-1", "final-2"]) peer.emit({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item: { type: "agentMessage", id: text, phase: text === "intermediate" ? "commentary" : "final_answer", text } } });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } });
  assert.equal(await turn, "final-2");
  const empty = client.runTurn("thread-1", "empty");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-2", status: "completed", items: [{ type: "reasoning", id: "reasoning-1" }] } } });
  await assert.rejects(empty, /EMPTY_AGENT_RESPONSE/);
});

test("accepts schema-shaped error variants and rejects terminal errors safely", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const variants: [unknown, string | undefined, number | undefined][] = [
    ["serverOverloaded", "codexErrorInfo:serverOverloaded", undefined],
    [{ httpConnectionFailed: { httpStatusCode: 502 } }, "codexErrorInfo:httpConnectionFailed", 502],
    [{ responseStreamConnectionFailed: {} }, "codexErrorInfo:responseStreamConnectionFailed", undefined],
    [{ responseStreamDisconnected: { httpStatusCode: null } }, "codexErrorInfo:responseStreamDisconnected", undefined],
    [{ responseTooManyFailedAttempts: { httpStatusCode: 503 } }, "codexErrorInfo:responseTooManyFailedAttempts", 503],
    [{ activeTurnNotSteerable: { turnKind: "review" } }, "codexErrorInfo:activeTurnNotSteerable", undefined],
    ["futureCategory", undefined, undefined],
    [{}, undefined, undefined],
    [{ httpConnectionFailed: { httpStatusCode: 502 }, responseStreamDisconnected: {} }, undefined, undefined],
    [{ httpConnectionFailed: { httpStatusCode: 1.5 } }, "codexErrorInfo:httpConnectionFailed", undefined],
    [undefined, undefined, undefined],
  ];
  for (const [info, category, httpStatusCode] of variants) {
    const turn = client.runTurn("thread-1", "failure");
    const turnId = `turn-${peer.sent.length}`;
    peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: turnId, status: "inProgress" } } });
    peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId, willRetry: false, error: { message: "secret", additionalDetails: "private", ...(info === undefined ? {} : { codexErrorInfo: info }) } } });
    peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "failed" } } });
    await assert.rejects(turn, (error: unknown) => {
      if (!(error instanceof Error) || !("diagnostic" in error)) return false;
      const diagnostic = (error as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
      assert.equal(diagnostic.category, category);
      assert.equal(diagnostic.httpStatusCode, httpStatusCode);
      assert.equal(diagnostic.finalStatus, "failed");
      if (category === undefined && info !== undefined) assert.equal(diagnostic.categoryUnknown, true);
      assert.doesNotMatch(JSON.stringify(error), /secret|private|additionalDetails/iu);
      return true;
    });
  }
});

test("preserves bounded retry counts and categories through a terminal error", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const failure = client.runTurn("thread-1", "retry");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-retry", status: "inProgress" } } });
  const infos = [
    { responseStreamDisconnected: { httpStatusCode: 502 } },
    { httpConnectionFailed: { httpStatusCode: 503 } },
    { responseTooManyFailedAttempts: {} },
    "serverOverloaded",
    { responseStreamConnectionFailed: {} },
  ];
  for (let index = 0; index < 70; index += 1) {
    peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId: "turn-retry", willRetry: true, error: { codexErrorInfo: infos[index % infos.length] } } });
  }
  peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId: "turn-retry", willRetry: false, error: { codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 504 } } } } });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-retry", status: "failed" } } });
  await assert.rejects(failure, (error: unknown) => {
    const diagnostic = (error as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
    assert.equal(diagnostic.retryCount, 64);
    assert.equal(diagnostic.category, "codexErrorInfo:responseTooManyFailedAttempts");
    assert.equal(diagnostic.httpStatusCode, 504);
    const counts = diagnostic.retryCategoryCounts as Record<string, number>;
    assert.ok(Object.keys(counts).length <= 8);
    assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 64);
    return true;
  });
});

test("fails closed when a matching turn requests server interaction", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer);
  const turn = client.runTurn("thread-1", "needs interaction");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  peer.emit({ jsonrpc: "2.0", id: 88, method: "item/tool/requestUserInput", params: { threadId: "thread-1", turnId: "turn-1" } });
  assert.deepEqual((peer.sent.at(-1) as { result: unknown }).result, { answers: {} });
  await assert.rejects(turn, (error: unknown) => error instanceof Error && error.message === "SERVER_INTERACTION_REQUIRED");
});

test("interrupts a timed-out turn with a short cleanup deadline and preserves the primary cause", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer, 100, 15, 15);
  const turn = client.runTurn("thread-1", "slow");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  peer.emit({ jsonrpc: "2.0", method: "error", params: { threadId: "thread-1", turnId: "turn-1", willRetry: false, error: { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } }, message: "secret", additionalDetails: "private" } } });
  await waitForMethod(peer, "turn/interrupt");
  const interrupt = peer.sent.at(-1) as { id: number; params: unknown };
  assert.deepEqual(interrupt.params, { threadId: "thread-1", turnId: "turn-1" });
  peer.emit({ jsonrpc: "2.0", id: interrupt.id, result: {} });
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", items: [] } } });
  await assert.rejects(turn, (error: unknown) => {
    if (!(error instanceof Error) || error.message !== "TURN_TIMEOUT" || !("diagnostic" in error)) return false;
    const diagnostic = (error as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
    assert.equal(diagnostic.category, "codexErrorInfo:responseStreamDisconnected");
    assert.equal(diagnostic.httpStatusCode, 502);
    assert.equal(diagnostic.interruptionError, undefined);
    assert.doesNotMatch(JSON.stringify(error), /secret|private/iu);
    return true;
  });
});

test("ignores a late completion after a timeout without changing the returned error", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer, 100, 10, 5);
  const turn = client.runTurn("thread-1", "slow");
  peer.emit({ jsonrpc: "2.0", id: requestId(peer), result: { turn: { id: "turn-1", status: "inProgress" } } });
  await waitForMethod(peer, "turn/interrupt");
  const interrupt = peer.sent.at(-1) as { id: number };
  peer.emit({ jsonrpc: "2.0", id: interrupt.id, result: {} });
  await assert.rejects(turn, /TURN_TIMEOUT/);
  peer.emit({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [{ type: "agentMessage", id: "late", text: "late" }] } } });
});

test("requires confirmation of every thread deletion", async () => {
  const peer = new FakePeer();
  const client = await initializedClient(peer, 100, 100, 10);
  const deletion = client.deleteThread("thread-1");
  const request = peer.sent.at(-1) as { id: number };
  peer.emit({ jsonrpc: "2.0", id: request.id, result: {} });
  await Promise.resolve();
  peer.emit({ jsonrpc: "2.0", method: "thread/deleted", params: { threadId: "thread-1" } });
  await deletion;
  const unconfirmed = client.deleteThread("thread-2");
  const secondRequest = peer.sent.at(-1) as { id: number };
  peer.emit({ jsonrpc: "2.0", id: secondRequest.id, result: {} });
  await assert.rejects(unconfirmed, /THREAD_DELETE_UNCONFIRMED/);
});

test("closes only the peer owned by the client", async () => {
  const peer = new FakePeer();
  const client = new AppServerClient(peer, 100);
  const result = await client.close();
  assert.deepEqual(result, { exited: true, forced: false });
  assert.throws(() => client.notify("after-close"), /PROCESS_CLOSED/);
});

test("forces termination only for its own child after a bounded close wait", async () => {
  const peer = new FakePeer();
  peer.waitForExitResult = false;
  const client = new AppServerClient(peer, 100, 100, 1);
  const result = await client.close();
  assert.deepEqual(result, { exited: true, forced: true });
  assert.equal(peer.terminateCalls, 1);
});
