import assert from "node:assert/strict";
import { test } from "node:test";
import { AppServerClientError } from "../app-server-client.js";
import { runDifferentialDiagnostic, type DifferentialDiagnosticClient } from "../differential-diagnostic.js";

class FakeDiagnosticClient implements DifferentialDiagnosticClient {
  readonly starts: { threadId: string; model?: string }[] = [];
  readonly turns: { threadId: string; schema: boolean }[] = [];
  readonly deletes: string[] = [];
  closeCalls = 0;
  private nextThread = 0;
  constructor(private readonly fail: "none" | "minimal" | "schema" | "delete" | "models" | "start" = "none") {}

  async listModels(): Promise<readonly { id: string; isDefault?: boolean }[]> {
    if (this.fail === "models") throw new Error("server detail must not escape");
    return [{ id: "model-z" }, { id: "model-a", isDefault: true }];
  }

  async startThread(options: { model?: string }): Promise<{ id: string }> {
    if (this.fail === "start") throw new AppServerClientError("THREAD_START_FAILED", { category: "codexErrorInfo:SecretToken123", httpStatusCode: 400, finalStatus: "failed" });
    const id = `thread-${++this.nextThread}`;
    this.starts.push({ threadId: id, model: options.model });
    return { id };
  }

  async runTurn(threadId: string, _prompt: string, outputSchema?: unknown): Promise<string> {
    this.turns.push({ threadId, schema: outputSchema !== undefined });
    if ((this.fail === "minimal" && outputSchema === undefined) || (this.fail === "schema" && outputSchema !== undefined)) {
      throw new Error("server secret must not escape");
    }
    return "synthetic response is intentionally discarded";
  }

  async deleteThread(threadId: string): Promise<void> {
    this.deletes.push(threadId);
    if (this.fail === "delete") throw new Error("private cleanup detail");
  }

  async close(): Promise<{ exited: boolean; forced: boolean }> {
    this.closeCalls += 1;
    return { exited: true, forced: false };
  }
}

const options = { cwd: "C:\\synthetic", baseInstructions: "synthetic", prompt: "synthetic" };

test("runs minimal first, then schema with the same model selected from model/list", async () => {
  const client = new FakeDiagnosticClient();
  const result = await runDifferentialDiagnostic(client, options);
  assert.deepEqual(result, {
    kind: "DIFFERENTIAL",
    failure: "NONE",
    modelSelectedFromList: true,
    failedStage: "NONE",
    minimalTurn: "SUCCEEDED",
    schemaTurn: "SUCCEEDED",
    minimalCleanup: "CONFIRMED",
    schemaCleanup: "CONFIRMED",
    clientClosed: true,
  });
  assert.deepEqual(client.starts.map((entry) => entry.model), ["model-a", "model-a"]);
  assert.deepEqual(client.turns.map((entry) => entry.schema), [false, true]);
  assert.deepEqual(client.deletes, ["thread-1", "thread-2"]);
});

test("does not run the schema probe when the minimal probe fails", async () => {
  const client = new FakeDiagnosticClient("minimal");
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MINIMAL_TURN_FAILED");
  assert.equal(result.minimalTurn, "FAILED");
  assert.equal(result.schemaTurn, "NOT_RUN");
  assert.equal(client.turns.length, 1);
  assert.equal(client.closeCalls, 1);
});

test("classifies a thread start failure and sanitizes its diagnostic", async () => {
  const client = new FakeDiagnosticClient("start");
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MINIMAL_TURN_FAILED");
  assert.equal(result.failedStage, "THREAD_START");
  assert.deepEqual(result.diagnostic, { categoryUnknown: true, httpStatusCode: 400, finalStatus: "failed" });
  assert.doesNotMatch(JSON.stringify(result), /SecretToken123/iu);
  assert.equal(result.minimalCleanup, "NOT_REQUIRED");
  assert.equal(client.closeCalls, 1);
});

test("classifies a runTurn failure and preserves only its safe diagnostic", async () => {
  const client = new FakeDiagnosticClient("minimal");
  client.runTurn = async (threadId, _prompt, outputSchema) => {
    client.turns.push({ threadId, schema: outputSchema !== undefined });
    if (outputSchema === undefined) throw new AppServerClientError("TURN_FAILED", { category: "codexErrorInfo:other", retryCount: 2, willRetry: false, finalStatus: "failed" });
    return "discarded";
  };
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MINIMAL_TURN_FAILED");
  assert.equal(result.failedStage, "TURN_RUN");
  assert.deepEqual(result.diagnostic, { category: "codexErrorInfo:other", willRetry: false, retryCount: 2, finalStatus: "failed" });
  assert.equal(result.minimalCleanup, "CONFIRMED");
  assert.equal(client.closeCalls, 1);
});

test("keeps cleanup failure as the terminal priority without losing the failed stage", async () => {
  const client = new FakeDiagnosticClient("minimal");
  client.runTurn = async (threadId, _prompt, outputSchema) => {
    client.turns.push({ threadId, schema: outputSchema !== undefined });
    throw new AppServerClientError("TURN_FAILED", { category: "codexErrorInfo:other", finalStatus: "failed" });
  };
  client.deleteThread = async () => { throw new Error("private cleanup detail"); };
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "CLEANUP_FAILED");
  assert.equal(result.failedStage, "TURN_RUN");
  assert.deepEqual(result.diagnostic, { category: "codexErrorInfo:other", finalStatus: "failed" });
  assert.equal(result.minimalCleanup, "FAILED");
});

test("classifies schema rejection without exposing server details", async () => {
  const client = new FakeDiagnosticClient("schema");
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "SCHEMA_TURN_FAILED");
  assert.equal(result.minimalTurn, "SUCCEEDED");
  assert.equal(result.schemaTurn, "FAILED");
  assert.doesNotMatch(JSON.stringify(result), /secret|private|response/iu);
});

test("fails closed when cleanup is not confirmed", async () => {
  const client = new FakeDiagnosticClient("delete");
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "CLEANUP_FAILED");
  assert.equal(result.minimalCleanup, "FAILED");
  assert.equal(result.schemaTurn, "NOT_RUN");
  assert.equal(result.clientClosed, true);
});

test("classifies a model/list RPC failure separately from selection", async () => {
  const client = new FakeDiagnosticClient("models");
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MODEL_LIST_FAILED");
  assert.equal(result.modelSelectedFromList, false);
  assert.equal(result.minimalTurn, "NOT_RUN");
  assert.equal(result.minimalCleanup, "NOT_REQUIRED");
  assert.equal(result.schemaTurn, "NOT_RUN");
  assert.equal(client.starts.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /server|detail/iu);
});

test("classifies a received but unusable model list as selection failure", async () => {
  const client = new FakeDiagnosticClient();
  client.listModels = async () => [{ id: "model-a" }, { id: "model-b" }];
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MODEL_SELECTION_FAILED");
  assert.equal(result.modelSelectedFromList, false);
  assert.equal(result.minimalTurn, "NOT_RUN");
  assert.equal(client.starts.length, 0);
});

test("falls back only when exactly one admissible model exists", async () => {
  const client = new FakeDiagnosticClient();
  client.listModels = async () => [{ id: "only-model" }];
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "NONE");
  assert.deepEqual(client.starts.map((entry) => entry.model), ["only-model", "only-model"]);
});

test("rejects multiple defaults instead of choosing alphabetically", async () => {
  const client = new FakeDiagnosticClient();
  client.listModels = async () => [{ id: "model-z", isDefault: true }, { id: "model-a", isDefault: true }];
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "MODEL_SELECTION_FAILED");
  assert.equal(result.minimalTurn, "NOT_RUN");
  assert.equal(client.starts.length, 0);
});

test("marks forced or unconfirmed client close as cleanup failure", async () => {
  const client = new FakeDiagnosticClient();
  client.close = async () => ({ exited: true, forced: true });
  const result = await runDifferentialDiagnostic(client, options);
  assert.equal(result.failure, "CLEANUP_FAILED");
  assert.equal(result.clientClosed, false);
});
