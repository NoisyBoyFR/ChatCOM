import { randomUUID } from "node:crypto";
import { AppServerClientError, type SafeTurnDiagnostic } from "./app-server-client.js";
import { createCodexSdkRelayClient, type CodexSdkRelayClient } from "./codex-sdk-relay.js";
import { DEFAULT_CODEX_LOCAL_INSTRUCTIONS, RelayFailure } from "./local-relay.js";
import { BindingStore, type BindingMode } from "./desktop/bindings.js";
import { createMessageOutputSchema, parseMessageText, type MessageEnvelope, validateMessage } from "./message-contract.js";
import type { PortableRelayConfig } from "./relay-config.js";

const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const MAX_EXCHANGE_TIMEOUT_MS = 3_600_000;

export interface WorkHostBridgeDependencies {
  createClient(projectRoot: string, timeoutMs: number): Promise<CodexSdkRelayClient>;
  randomUUID(): string;
  bindingStore?: BindingStore;
}
const DEFAULT_DEPENDENCIES: WorkHostBridgeDependencies = {
  createClient: (projectRoot, timeoutMs) => createCodexSdkRelayClient(projectRoot, { timeoutMs }),
  randomUUID,
};

interface ActiveExchange {
  sessionId: string;
  reportMessageId: string;
  phase: string;
  point: string;
  client: CodexSdkRelayClient;
  threadId: string;
  mode: "EPHEMERAL" | BindingMode;
  bindingId?: string;
  timer: NodeJS.Timeout;
}

export interface WorkHostOpenResult {
  status: "REPORT_READY";
  communicationMode: "REAL_WORK_HOST";
  workHost: "MCP_HOST";
  workAuthentication: "WORK_AUTH_MANAGED_BY_HOST";
  codexAuthentication: "CODEX_AUTH_READY";
  security: "READ_ONLY";
  sessionId: string;
  report: MessageEnvelope;
  transmissions: 2;
  completedTransmissions: 2;
  cleanup: "PENDING";
  stoppedBeforeSecondCodexMission: true;
  conversationMode: "EPHEMERAL" | BindingMode;
  bindingId?: string;
  threadPreserved: "PENDING";
  threadDeleted: "PENDING";
}

export interface WorkHostCompleteResult {
  status: "SUCCESS";
  communicationMode: "REAL_WORK_HOST";
  workHost: "MCP_HOST";
  workAuthentication: "WORK_AUTH_MANAGED_BY_HOST";
  codexAuthentication: "CODEX_AUTH_READY";
  security: "READ_ONLY";
  sessionId: string;
  transmissions: 3;
  completedTransmissions: 3;
  cleanup: "CONFIRMED";
  stoppedBeforeSecondCodexMission: true;
  conversationMode: "EPHEMERAL" | BindingMode;
  bindingId?: string;
  threadPreserved: "CONFIRMED" | "PENDING";
  threadDeleted: "CONFIRMED" | "PENDING";
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof RelayFailure || error instanceof AppServerClientError) return error.code;
  return fallback;
}

function validateTimeout(value: number | undefined, fallback: number, code: string): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_EXCHANGE_TIMEOUT_MS) throw new RelayFailure(code);
  return timeout;
}

function assertMission(message: MessageEnvelope, config: PortableRelayConfig): void {
  try { validateMessage(message); }
  catch { throw new RelayFailure("WORK_HOST_MISSION_INVALID"); }
  if (
    message.sequence !== 1 ||
    message.sender !== "WORK_HOST" ||
    message.recipient !== "CODEX_LOCAL" ||
    message.type !== "MISSION" ||
    message.correlation_id !== message.session_id ||
    message.phase !== config.phase ||
    message.point !== config.point ||
    message.delivery_status !== "CREATED" ||
    message.user_action_needed
  ) throw new RelayFailure("WORK_HOST_MISSION_ROUTE_INVALID");
}

function assertNextPrompt(message: MessageEnvelope, exchange: ActiveExchange): void {
  try { validateMessage(message); }
  catch { throw new RelayFailure("WORK_HOST_NEXT_PROMPT_INVALID"); }
  if (
    message.session_id !== exchange.sessionId ||
    message.sequence !== 3 ||
    message.sender !== "WORK_HOST" ||
    message.recipient !== "CODEX_LOCAL" ||
    message.type !== "NEXT_PROMPT" ||
    message.correlation_id !== exchange.reportMessageId ||
    message.phase !== exchange.phase ||
    message.point !== exchange.point ||
    message.delivery_status !== "CREATED" ||
    message.user_action_needed
  ) throw new RelayFailure("WORK_HOST_NEXT_PROMPT_ROUTE_INVALID");
}

function reportPrompt(mission: MessageEnvelope): string {
  return `Review the following validated read-only mission from the external WORK host. Do not modify files, run a second mission, or invent authorization. Return one JSON REPORT envelope only. Mission: ${JSON.stringify(mission)}`;
}

async function cleanupClient(client: CodexSdkRelayClient, threadId: string | undefined, mode: "EPHEMERAL" | BindingMode): Promise<{ failures: string[]; errors: string[] }> {
  const failures: string[] = [];
  const errors: string[] = [];
  if (threadId !== undefined && mode === "EPHEMERAL") {
    try { await client.deleteThread(threadId); }
    catch (error) { failures.push("CODEX_THREAD"); errors.push(errorCode(error, "THREAD_DELETE_FAILED")); }
  }
  try {
    const closed = await client.close(mode === "PERSISTENT_BOUND" && threadId !== undefined ? { preserveThreadIds: [threadId] } : undefined);
    if (!closed.exited || closed.forced) errors.push("CLIENT_CLOSE_UNCONFIRMED");
  } catch { errors.push("CLIENT_CLOSE_FAILED"); }
  return { failures, errors };
}

export class WorkHostBridge {
  private readonly exchanges = new Map<string, ActiveExchange>();
  private readonly bindingStore: BindingStore;

  constructor(private readonly dependencies: WorkHostBridgeDependencies = DEFAULT_DEPENDENCIES) { this.bindingStore = dependencies.bindingStore ?? new BindingStore(); }

  async open(config: PortableRelayConfig, mission: MessageEnvelope, timeoutMs?: number, idleTimeoutMs?: number, signal?: AbortSignal, bindingId?: string): Promise<WorkHostOpenResult> {
    assertMission(mission, config);
    const sessionId = mission.session_id;
    if (this.exchanges.has(sessionId)) throw new RelayFailure("WORK_HOST_SESSION_REPLAY");
    if (signal?.aborted) throw new RelayFailure("RELAY_CANCELLED", [], [], [], [], undefined, "WORK_MISSION", 1);
    const turnTimeout = validateTimeout(timeoutMs, 600_000, "WORK_HOST_TIMEOUT_INVALID");
    const idleTimeout = validateTimeout(idleTimeoutMs, Math.min(DEFAULT_IDLE_TIMEOUT_MS, turnTimeout), "WORK_HOST_IDLE_TIMEOUT_INVALID");
    let client: CodexSdkRelayClient | undefined;
    let threadId: string | undefined;
    let binding: Awaited<ReturnType<BindingStore["get"]>> | undefined;
    if (bindingId !== undefined) {
      try { binding = await this.bindingStore.get(bindingId, config.projectRoot); }
      catch (error) {
        const code = error instanceof Error && ["BINDING_ID_INVALID", "BINDING_NOT_FOUND", "BINDING_PROJECT_DIFFERENT", "BINDING_PROJECT_UNAVAILABLE", "BINDING_REGISTRY_INVALID"].includes(error.message) ? error.message : "BINDING_INVALID";
        throw new RelayFailure(code);
      }
    }
    const mode: "EPHEMERAL" | BindingMode = binding === undefined ? "EPHEMERAL" : "PERSISTENT_BOUND";
    let primaryError: unknown;
    try {
      client = await this.dependencies.createClient(config.projectRoot, turnTimeout);
      await client.initialize();
      if (mode === "PERSISTENT_BOUND" && client.resumeThread === undefined) throw new RelayFailure("THREAD_RESUME_UNSUPPORTED");
      threadId = mode === "PERSISTENT_BOUND" ? await client.resumeThread?.(binding?.threadId as string, config.projectRoot) as string : await client.startThread(DEFAULT_CODEX_LOCAL_INSTRUCTIONS, config.projectRoot);
      const report = parseMessageText(await client.runTurn(
        threadId,
        reportPrompt(mission),
        createMessageOutputSchema({ sessionId, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_HOST", type: "REPORT", correlationId: mission.message_id, phase: config.phase, point: config.point, userActionNeeded: false }),
        signal,
      ));
      if (report.session_id !== sessionId || report.sequence !== 2 || report.sender !== "CODEX_LOCAL" || report.recipient !== "WORK_HOST" || report.type !== "REPORT" || report.correlation_id !== mission.message_id || report.phase !== config.phase || report.point !== config.point || report.delivery_status !== "CREATED" || report.user_action_needed) {
        throw new RelayFailure("WORK_HOST_REPORT_ROUTE_INVALID", [], [], [], [], undefined, "CODEX_REPORT", 1);
      }
      const exchange: ActiveExchange = {
        sessionId,
        reportMessageId: report.message_id,
        phase: config.phase,
        point: config.point,
        client,
        threadId,
        mode,
        ...(bindingId === undefined ? {} : { bindingId }),
        timer: setTimeout(() => { void this.expire(sessionId); }, Math.min(turnTimeout, idleTimeout)),
      };
      this.exchanges.set(sessionId, exchange);
      return { status: "REPORT_READY", communicationMode: "REAL_WORK_HOST", workHost: "MCP_HOST", workAuthentication: "WORK_AUTH_MANAGED_BY_HOST", codexAuthentication: "CODEX_AUTH_READY", security: "READ_ONLY", sessionId, report, transmissions: 2, completedTransmissions: 2, cleanup: "PENDING", stoppedBeforeSecondCodexMission: true, conversationMode: mode, ...(bindingId === undefined ? {} : { bindingId }), threadPreserved: "PENDING", threadDeleted: "PENDING" };
    } catch (error) {
      primaryError = error;
    }
    if (client !== undefined) {
      const cleanup = await cleanupClient(client, threadId, mode);
      const diagnostic = primaryError instanceof RelayFailure
        ? primaryError.primaryDiagnostic
        : primaryError instanceof AppServerClientError
          ? primaryError.diagnostic
          : undefined;
      const failure = primaryError instanceof RelayFailure
        ? primaryError
        : new RelayFailure(errorCode(primaryError, "WORK_HOST_REPORT_FAILED"), [], [], [], [], diagnostic, "CODEX_REPORT", 1);
      if (cleanup.failures.length > 0 || cleanup.errors.length > 0) throw new RelayFailure(failure.code, cleanup.failures, [], [], cleanup.errors, failure.primaryDiagnostic, failure.relayStage, failure.completedTransmissions);
      throw failure;
    }
    throw primaryError instanceof RelayFailure ? primaryError : new RelayFailure(errorCode(primaryError, "WORK_HOST_OPEN_FAILED"));
  }

  async complete(sessionId: string, nextPrompt: MessageEnvelope, signal?: AbortSignal): Promise<WorkHostCompleteResult> {
    const exchange = this.exchanges.get(sessionId);
    if (!exchange) throw new RelayFailure("WORK_HOST_SESSION_NOT_FOUND", [], [], [], ["EXCHANGE_NOT_OPEN"], undefined, "WORK_NEXT_PROMPT", 2);
    if (signal?.aborted) throw new RelayFailure("RELAY_CANCELLED", [], [], [], ["EXCHANGE_OPEN"], undefined, "WORK_NEXT_PROMPT", 2);
    try { assertNextPrompt(nextPrompt, exchange); }
    catch (error) { throw error instanceof RelayFailure ? new RelayFailure(error.code, [], [], [], ["EXCHANGE_OPEN"], undefined, "WORK_NEXT_PROMPT", 2) : error; }
    clearTimeout(exchange.timer);
    this.exchanges.delete(sessionId);
    const cleanup = await cleanupClient(exchange.client, exchange.threadId, exchange.mode);
    if (cleanup.failures.length > 0 || cleanup.errors.length > 0) throw new RelayFailure("CLEANUP_FAILED", cleanup.failures, [], [], cleanup.errors, undefined, "WORK_NEXT_PROMPT", 3);
    return { status: "SUCCESS", communicationMode: "REAL_WORK_HOST", workHost: "MCP_HOST", workAuthentication: "WORK_AUTH_MANAGED_BY_HOST", codexAuthentication: "CODEX_AUTH_READY", security: "READ_ONLY", sessionId, transmissions: 3, completedTransmissions: 3, cleanup: "CONFIRMED", stoppedBeforeSecondCodexMission: true, conversationMode: exchange.mode, ...(exchange.bindingId === undefined ? {} : { bindingId: exchange.bindingId }), threadPreserved: exchange.mode === "PERSISTENT_BOUND" ? "CONFIRMED" : "PENDING", threadDeleted: exchange.mode === "EPHEMERAL" ? "CONFIRMED" : "PENDING" };
  }

  private async expire(sessionId: string): Promise<void> {
    const exchange = this.exchanges.get(sessionId);
    if (!exchange) return;
    this.exchanges.delete(sessionId);
    clearTimeout(exchange.timer);
    await cleanupClient(exchange.client, exchange.threadId, exchange.mode);
  }

  activeExchangeCount(): number { return this.exchanges.size; }
}
