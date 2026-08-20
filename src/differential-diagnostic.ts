import { AppServerClientError, isSafeCodexErrorCategory, type AppServerModel, type AppServerThread, type SafeTurnDiagnostic, type ThreadStartOptions } from "./app-server-client.js";
import { MESSAGE_OUTPUT_SCHEMA } from "./message-contract.js";

export type DifferentialProbeStatus = "SUCCEEDED" | "FAILED" | "NOT_RUN";
export type DifferentialFailure = "NONE" | "MODEL_LIST_FAILED" | "MODEL_SELECTION_FAILED" | "MINIMAL_TURN_FAILED" | "SCHEMA_TURN_FAILED" | "CLEANUP_FAILED";
export type DifferentialFailureStage = "NONE" | "THREAD_START" | "TURN_RUN";
type ProbeCleanup = "CONFIRMED" | "FAILED" | "NOT_REQUIRED";

export interface DifferentialDiagnosticClient {
  listModels(): Promise<readonly AppServerModel[]>;
  startThread(options: ThreadStartOptions): Promise<AppServerThread>;
  runTurn(threadId: string, prompt: string, outputSchema?: unknown): Promise<string>;
  deleteThread(threadId: string): Promise<void>;
  close(): Promise<{ exited: boolean; forced: boolean }>;
}

export interface DifferentialDiagnosticOptions {
  cwd: string;
  baseInstructions: string;
  prompt: string;
}

export interface DifferentialDiagnosticResult {
  kind: "DIFFERENTIAL";
  failure: DifferentialFailure;
  modelSelectedFromList: boolean;
  failedStage: DifferentialFailureStage;
  diagnostic?: SafeTurnDiagnostic;
  minimalTurn: DifferentialProbeStatus;
  schemaTurn: DifferentialProbeStatus;
  minimalCleanup: ProbeCleanup;
  schemaCleanup: ProbeCleanup | "NOT_RUN";
  clientClosed: boolean;
}

function safeDiagnostic(error: unknown): SafeTurnDiagnostic | undefined {
  if (!(error instanceof AppServerClientError) || error.diagnostic === undefined) return undefined;
  const source = error.diagnostic;
  const diagnostic: SafeTurnDiagnostic = {};
  if (typeof source.category === "string") {
    if (isSafeCodexErrorCategory(source.category)) diagnostic.category = source.category;
    else diagnostic.categoryUnknown = true;
  } else if (source.categoryUnknown === true) {
    diagnostic.categoryUnknown = true;
  }
  if (typeof source.httpStatusCode === "number" && Number.isSafeInteger(source.httpStatusCode) && source.httpStatusCode >= 0 && source.httpStatusCode <= 65_535) diagnostic.httpStatusCode = source.httpStatusCode;
  if (typeof source.willRetry === "boolean") diagnostic.willRetry = source.willRetry;
  if (typeof source.retryCount === "number" && Number.isSafeInteger(source.retryCount) && source.retryCount >= 0 && source.retryCount <= 64) diagnostic.retryCount = source.retryCount;
  if (typeof source.finalStatus === "string" && (source.finalStatus === "completed" || source.finalStatus === "interrupted" || source.finalStatus === "failed")) diagnostic.finalStatus = source.finalStatus;
  const retryCategoryCounts = Object.entries(source.retryCategoryCounts ?? {})
    .filter(([category, count]) => isSafeCodexErrorCategory(category) && Number.isSafeInteger(count) && count >= 1 && count <= 64)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8);
  if (retryCategoryCounts.length > 0) diagnostic.retryCategoryCounts = Object.fromEntries(retryCategoryCounts);
  return Object.keys(diagnostic).length === 0 ? undefined : diagnostic;
}

function selectModel(models: readonly AppServerModel[]): AppServerModel {
  const candidates = models
    .filter((model) => typeof model.id === "string" && model.id.length > 0 && model.id.length <= 128);
  const defaults = candidates.filter((model) => model.isDefault === true);
  const model = defaults.length === 1 ? defaults[0] : defaults.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
  if (!model) throw new AppServerClientError("EMPTY_MODEL_LIST");
  return model;
}

async function runProbe(
  client: DifferentialDiagnosticClient,
  options: DifferentialDiagnosticOptions,
  model: AppServerModel,
  outputSchema: unknown | undefined,
): Promise<{ status: "SUCCEEDED" | "FAILED"; cleanup: ProbeCleanup; failedStage: DifferentialFailureStage; diagnostic?: SafeTurnDiagnostic }> {
  let threadId: string | undefined;
  let failed = false;
  let failedStage: DifferentialFailureStage = "NONE";
  let diagnostic: SafeTurnDiagnostic | undefined;
  let cleanup: ProbeCleanup = "NOT_REQUIRED";
  try {
    const started = await client.startThread({ cwd: options.cwd, baseInstructions: options.baseInstructions, model: model.id });
    threadId = started.id;
    await client.runTurn(threadId, options.prompt, outputSchema);
  } catch (error) {
    failed = true;
    failedStage = threadId === undefined ? "THREAD_START" : "TURN_RUN";
    diagnostic = safeDiagnostic(error);
  } finally {
    if (threadId !== undefined) {
      try { await client.deleteThread(threadId); cleanup = "CONFIRMED"; }
      catch { cleanup = "FAILED"; }
    }
  }
  return { status: failed ? "FAILED" : "SUCCEEDED", cleanup, failedStage, diagnostic };
}

/**
 * Runs only the synthetic differential plan. It never creates a client or
 * starts App Server itself; callers must inject an already-owned client.
 * Results contain statuses and bounded local classifications only.
 */
export async function runDifferentialDiagnostic(
  client: DifferentialDiagnosticClient,
  options: DifferentialDiagnosticOptions,
): Promise<DifferentialDiagnosticResult> {
  let minimalTurn: DifferentialProbeStatus = "NOT_RUN";
  let schemaTurn: DifferentialProbeStatus = "NOT_RUN";
  let minimalCleanup: DifferentialDiagnosticResult["minimalCleanup"] = "NOT_REQUIRED";
  let schemaCleanup: DifferentialDiagnosticResult["schemaCleanup"] = "NOT_RUN";
  let failure: DifferentialFailure = "NONE";
  let failedStage: DifferentialFailureStage = "NONE";
  let diagnostic: SafeTurnDiagnostic | undefined;
  let models: readonly AppServerModel[];
  try {
    models = await client.listModels();
  } catch {
    failure = "MODEL_LIST_FAILED";
    let clientClosed = false;
    try { const closed = await client.close(); clientClosed = closed.exited && !closed.forced; if (!clientClosed) failure = "CLEANUP_FAILED"; } catch { failure = "CLEANUP_FAILED"; }
    return { kind: "DIFFERENTIAL", failure, modelSelectedFromList: false, failedStage, minimalTurn, schemaTurn, minimalCleanup, schemaCleanup, clientClosed };
  }

  let model: AppServerModel;
  try {
    model = selectModel(models);
  } catch {
    failure = "MODEL_SELECTION_FAILED";
    let clientClosed = false;
    try { const closed = await client.close(); clientClosed = closed.exited && !closed.forced; if (!clientClosed) failure = "CLEANUP_FAILED"; } catch { failure = "CLEANUP_FAILED"; }
    return { kind: "DIFFERENTIAL", failure, modelSelectedFromList: false, failedStage, minimalTurn, schemaTurn, minimalCleanup, schemaCleanup, clientClosed };
  }

  const minimal = await runProbe(client, options, model, undefined);
  minimalTurn = minimal.status;
  minimalCleanup = minimal.cleanup;
  if (minimal.status === "FAILED") {
    failure = "MINIMAL_TURN_FAILED";
    failedStage = minimal.failedStage;
    diagnostic = minimal.diagnostic;
  }
  if (minimal.status === "SUCCEEDED" && minimal.cleanup === "CONFIRMED") {
    const schema = await runProbe(client, options, model, MESSAGE_OUTPUT_SCHEMA);
    schemaTurn = schema.status;
    schemaCleanup = schema.cleanup;
    if (schema.status === "FAILED") {
      failure = "SCHEMA_TURN_FAILED";
      failedStage = schema.failedStage;
      diagnostic = schema.diagnostic;
    }
    if (schema.cleanup === "FAILED") failure = "CLEANUP_FAILED";
  } else if (minimal.cleanup === "FAILED") {
    failure = "CLEANUP_FAILED";
  }

  let clientClosed = false;
  try { const closed = await client.close(); clientClosed = closed.exited && !closed.forced; if (!clientClosed) failure = "CLEANUP_FAILED"; }
  catch { failure = "CLEANUP_FAILED"; }
  return { kind: "DIFFERENTIAL", failure, modelSelectedFromList: true, failedStage, ...(diagnostic === undefined ? {} : { diagnostic }), minimalTurn, schemaTurn, minimalCleanup, schemaCleanup, clientClosed };
}
