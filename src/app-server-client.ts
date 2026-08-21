import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { MAX_MESSAGE_BYTES } from "./message-contract.js";

export const MAX_JSON_LINE_BYTES = MAX_MESSAGE_BYTES;

export interface JsonLinePeer {
  send(value: unknown): void;
  onLine(listener: (line: string) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: unknown) => void): void;
  close(): void;
  waitForExit?(timeoutMs: number): Promise<boolean>;
  terminate?(): void;
}

export const SAFE_SDK_STAGES = ["LAUNCH", "THREAD_CREATION", "TURN_START", "STREAM_ACTIVE", "TERMINAL_ABSENT", "TERMINAL_COMPLETED", "TERMINAL_FAILED"] as const;
export type SafeSdkStage = (typeof SAFE_SDK_STAGES)[number];
export const SAFE_SDK_LAST_STAGES = ["NONE", "THREAD_CREATION", "TURN_START", "TERMINAL_COMPLETED", "TERMINAL_FAILED"] as const;
export type SafeSdkLastStage = (typeof SAFE_SDK_LAST_STAGES)[number];
export const SAFE_SDK_TERMINALS = ["ABSENT", "COMPLETED", "FAILED"] as const;
export type SafeSdkTerminal = (typeof SAFE_SDK_TERMINALS)[number];
export const SAFE_SDK_FAILURE_CATEGORIES = ["AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMITED", "QUOTA_EXCEEDED", "NETWORK_UNAVAILABLE", "CONFIG_INVALID", "OUTPUT_SCHEMA_REJECTED", "MODEL_UNAVAILABLE", "RUNTIME_FAILED", "UNKNOWN"] as const;
export type SafeSdkFailureCategory = (typeof SAFE_SDK_FAILURE_CATEGORIES)[number];

export interface SafeTurnDiagnostic {
  method?: string;
  category?: string;
  categoryUnknown?: boolean;
  httpStatusCode?: number;
  willRetry?: boolean;
  retryCount?: number;
  retryCategoryCounts?: Record<string, number>;
  finalStatus?: string;
  interruptionError?: string;
  sdkStage?: SafeSdkStage;
  sdkLastStage?: SafeSdkLastStage;
  terminal?: SafeSdkTerminal;
  threadStarted?: boolean;
  turnStarted?: boolean;
  streamClosed?: boolean;
  failureCategory?: SafeSdkFailureCategory;
}

export class AppServerClientError extends Error {
  readonly code: string;
  readonly diagnostic?: SafeTurnDiagnostic;

  constructor(code: string, diagnostic?: SafeTurnDiagnostic) {
    super(code);
    this.name = "AppServerClientError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

class SpawnedJsonLinePeer implements JsonLinePeer {
  private readonly listeners = { close: [] as (() => void)[], error: [] as ((error: unknown) => void)[], line: [] as ((line: string) => void)[] };
  private readonly exited: Promise<void>;
  private resolveExited!: () => void;
  private buffer = "";
  private closed = false;
  private exitedAlready = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.exited = new Promise((resolve) => { this.resolveExited = resolve; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.on("error", (error) => this.fail(error));
    child.on("close", () => {
      this.exitedAlready = true;
      this.resolveExited();
      this.finish();
    });
    child.stderr.resume();
  }

  static spawn(command: string, args: string[]): SpawnedJsonLinePeer {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    return new SpawnedJsonLinePeer(child);
  }

  private consume(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_JSON_LINE_BYTES) {
      this.fail(new AppServerClientError("JSON_LINE_TOO_LARGE"));
      return;
    }
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);
      for (const listener of this.listeners.line) listener(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    for (const listener of this.listeners.error) listener(error);
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.listeners.close) listener();
  }

  send(value: unknown): void {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_JSON_LINE_BYTES) throw new AppServerClientError("JSON_LINE_TOO_LARGE");
    this.child.stdin.write(line);
  }

  onLine(listener: (line: string) => void): void { this.listeners.line.push(listener); }
  onClose(listener: () => void): void { this.listeners.close.push(listener); }
  onError(listener: (error: unknown) => void): void { this.listeners.error.push(listener); }

  close(): void {
    if (this.exitedAlready) return;
    this.child.stdin.end();
  }

  async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exitedAlready) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.exited.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  terminate(): void {
    if (!this.exitedAlready) this.child.kill();
  }
}

type RpcId = number;
type RpcResponse = { jsonrpc?: string; id: RpcId; result?: unknown; error?: unknown };
type RpcNotification = { jsonrpc?: string; method: string; params?: unknown };
type TurnSnapshot = { id: string; status?: string; items?: unknown[]; error?: unknown };
type CompletionWaiter = { resolve: (turn: TurnSnapshot) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout };
type DeletionWaiter = { resolve: () => void; reject: (error: unknown) => void; timer: NodeJS.Timeout };

export interface AppServerTimeouts {
  requestMs?: number;
  turnMs?: number;
  cleanupMs?: number;
}

export interface AppServerCloseResult {
  exited: boolean;
  forced: boolean;
}

export interface ThreadStartOptions {
  cwd: string;
  baseInstructions: string;
  model?: string;
}

export interface AppServerThread {
  id: string;
}

export interface AppServerModel {
  id: string;
  isDefault?: boolean;
}

const KNOWN_INTERACTION_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
  "applyPatchApproval",
  "execCommandApproval",
]);

function recordObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

const MAX_RETRY_COUNT = 64;
const MAX_RETRY_CATEGORIES = 8;
export const CODEX_ERROR_CATEGORY_NAMES = [
  "contextWindowExceeded",
  "sessionBudgetExceeded",
  "usageLimitExceeded",
  "serverOverloaded",
  "cyberPolicy",
  "internalServerError",
  "unauthorized",
  "badRequest",
  "threadRollbackFailed",
  "sandboxError",
  "other",
] as const;
export const CODEX_ERROR_VARIANT_NAMES = [
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "activeTurnNotSteerable",
] as const;
export const SAFE_CODEX_ERROR_CATEGORY_TOKENS = [
  ...CODEX_ERROR_CATEGORY_NAMES.map((category) => `codexErrorInfo:${category}`),
  ...CODEX_ERROR_VARIANT_NAMES.map((variant) => `codexErrorInfo:${variant}`),
] as const;

const CODEX_ERROR_CATEGORIES = new Set<string>(CODEX_ERROR_CATEGORY_NAMES);
const CODEX_ERROR_VARIANTS = new Set<string>(CODEX_ERROR_VARIANT_NAMES);
const SAFE_CODEX_ERROR_CATEGORIES = new Set<string>(SAFE_CODEX_ERROR_CATEGORY_TOKENS);

export function isSafeCodexErrorCategory(value: unknown): value is string {
  return typeof value === "string" && SAFE_CODEX_ERROR_CATEGORIES.has(value);
}

type SafeErrorDetails = Pick<SafeTurnDiagnostic, "category" | "categoryUnknown" | "httpStatusCode">;

/**
 * The stable category convention is `codexErrorInfo:<schema-variant>`. Only
 * the generated schema's enum values and one-key variants are accepted.
 */
function safeErrorDiagnostic(value: unknown): SafeErrorDetails {
  const error = recordObject(value);
  const rawInfo = error?.codexErrorInfo;
  if (typeof rawInfo === "string") {
    return CODEX_ERROR_CATEGORIES.has(rawInfo) ? { category: `codexErrorInfo:${rawInfo}` } : { categoryUnknown: true };
  }
  const info = recordObject(rawInfo);
  if (!info) return {};
  const keys = Object.keys(info);
  if (keys.length !== 1 || !CODEX_ERROR_VARIANTS.has(keys[0])) return { categoryUnknown: true };
  const variant = keys[0];
  const payload = recordObject(info[variant]);
  if (!payload) return { categoryUnknown: true };
  if (variant === "activeTurnNotSteerable" && payload.turnKind !== "review" && payload.turnKind !== "compact") return { categoryUnknown: true };
  const status = payload.httpStatusCode;
  const httpStatusCode = typeof status === "number" && Number.isInteger(status) && status >= 0 && status <= 65_535 ? status : undefined;
  return { category: `codexErrorInfo:${variant}`, ...(httpStatusCode === undefined ? {} : { httpStatusCode }) };
}

function isAgentMessage(value: unknown): value is { type: "agentMessage"; text: string; phase?: string | null } {
  const item = recordObject(value);
  return item?.type === "agentMessage" && typeof item.text === "string";
}

function parseModelList(value: unknown): readonly AppServerModel[] {
  const response = recordObject(value);
  const entries = Array.isArray(response?.data) ? response.data : undefined;
  if (!entries) throw new AppServerClientError("INVALID_MODEL_LIST_RESPONSE");
  const models = entries
    .map((entry) => recordObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined && typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 128)
    .map((entry) => ({ id: entry.id as string, ...(entry.isDefault === true ? { isDefault: true } : {}) }));
  if (models.length === 0) throw new AppServerClientError("EMPTY_MODEL_LIST");
  return models;
}

export class AppServerClient {
  private nextId = 1;
  private initialized = false;
  private closed = false;
  private closePromise: Promise<AppServerCloseResult> | undefined;
  private readonly pending = new Map<RpcId, { resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout }>();
  private readonly notifications = new Set<(notification: RpcNotification) => void>();
  private readonly observedNotificationMethods: string[] = [];
  private readonly completedTurns = new Map<string, TurnSnapshot>();
  private readonly interactionTurns = new Map<string, string>();
  private readonly completionWaiters = new Map<string, CompletionWaiter[]>();
  private readonly completedItems = new Map<string, { type: "agentMessage"; text: string; phase?: string | null }[]>();
  private readonly startingThreads = new Set<string>();
  private readonly activeTurnKeys = new Set<string>();
  private readonly retiredTurnKeys = new Set<string>();
  private readonly retryCounts = new Map<string, number>();
  private readonly turnDiagnostics = new Map<string, SafeTurnDiagnostic>();
  private readonly deletedThreads = new Set<string>();
  private readonly deletionWaiters = new Map<string, DeletionWaiter[]>();

  constructor(
    private readonly peer: JsonLinePeer,
    private readonly requestTimeoutMs = 30_000,
    private readonly turnTimeoutMs = requestTimeoutMs,
    private readonly cleanupTimeoutMs = Math.min(5_000, requestTimeoutMs),
  ) {
    peer.onLine((line) => this.handleLine(line));
    peer.onClose(() => this.failAll(new AppServerClientError("PROCESS_CLOSED")));
    peer.onError(() => this.failAll(new AppServerClientError("PROCESS_ERROR")));
  }

  static spawn(timeouts: AppServerTimeouts | number = 30_000, executable = "codex"): AppServerClient {
    const options = typeof timeouts === "number" ? { requestMs: timeouts, turnMs: timeouts } : timeouts;
    const requestMs = options.requestMs ?? 30_000;
    const turnMs = options.turnMs ?? requestMs;
    const cleanupMs = options.cleanupMs ?? Math.min(5_000, requestMs);
    const peer = SpawnedJsonLinePeer.spawn(executable, ["app-server", "--listen", "stdio://"]);
    return new AppServerClient(peer, requestMs, turnMs, cleanupMs);
  }

  private failAll(error: AppServerClientError): void {
    if (this.closed && this.pending.size === 0 && this.completionWaiters.size === 0 && this.deletionWaiters.size === 0) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiters of this.completionWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.completionWaiters.clear();
    for (const waiters of this.deletionWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.deletionWaiters.clear();
    this.notifications.clear();
    this.activeTurnKeys.clear();
    this.startingThreads.clear();
  }

  private handleLine(line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_JSON_LINE_BYTES) {
      this.failAll(new AppServerClientError("JSON_LINE_TOO_LARGE"));
      return;
    }
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.failAll(new AppServerClientError("INVALID_JSON_LINE")); return; }
    if (typeof message !== "object" || message === null) { this.failAll(new AppServerClientError("INVALID_JSON_RPC_MESSAGE")); return; }
    const record = message as Record<string, unknown>;
    if (typeof record.method === "string") {
      if (typeof record.id === "number") {
        this.handleServerRequest(record.id, record.method, record.params);
        return;
      }
      const notification = record as unknown as RpcNotification;
      this.observedNotificationMethods.push(notification.method);
      this.handleNotification(notification);
      for (const listener of this.notifications) listener(notification);
      return;
    }
    if (typeof record.id !== "number") { this.failAll(new AppServerClientError("INVALID_JSON_RPC_RESPONSE")); return; }
    const response = record as unknown as RpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (Object.prototype.hasOwnProperty.call(response, "error")) pending.reject(new AppServerClientError("RPC_ERROR"));
    else pending.resolve(response.result);
  }

  private handleNotification(notification: RpcNotification): void {
    const params = recordObject(notification.params);
    if (notification.method === "item/completed") {
      const threadId = params?.threadId;
      const turnId = params?.turnId;
      if (typeof threadId === "string" && typeof turnId === "string" && (this.startingThreads.has(threadId) || this.activeTurnKeys.has(`${threadId}:${turnId}`))) {
        const item = params?.item;
        if (isAgentMessage(item)) {
          const key = `${threadId}:${turnId}`;
          const items = this.completedItems.get(key) ?? [];
          if (items.length < 64) items.push(item);
          this.completedItems.set(key, items);
        }
      }
    }
    if (notification.method === "turn/completed" && typeof params?.threadId === "string") {
      const turn = recordObject(params.turn);
      const turnId = turn?.id;
      if (turn && typeof turnId === "string" && !this.retiredTurnKeys.has(`${params.threadId}:${turnId}`)) {
        const key = `${params.threadId}:${turnId}`;
        const snapshot = params.turn as TurnSnapshot;
        this.completedTurns.set(key, snapshot);
        const diagnostic = this.turnDiagnostics.get(key) ?? {};
        this.turnDiagnostics.set(key, { ...diagnostic, finalStatus: typeof turn.status === "string" ? turn.status : undefined, ...safeErrorDiagnostic(turn.error) });
        this.resolveCompletion(key, snapshot);
      }
    }
    if (notification.method === "thread/deleted" && typeof params?.threadId === "string") {
      this.deletedThreads.add(params.threadId);
      const waiters = this.deletionWaiters.get(params.threadId) ?? [];
      this.deletionWaiters.delete(params.threadId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
    if (notification.method === "error") this.handleErrorNotification(params);
  }

  private handleErrorNotification(params: Record<string, unknown> | undefined): void {
    const threadId = params?.threadId;
    const turnId = params?.turnId;
    if (typeof threadId !== "string" || typeof turnId !== "string") return;
    const key = `${threadId}:${turnId}`;
    const willRetry = params?.willRetry === true;
    const previousRetryCount = this.retryCounts.get(key) ?? 0;
    const retries = Math.min(previousRetryCount + (willRetry ? 1 : 0), MAX_RETRY_COUNT);
    this.retryCounts.set(key, retries);
    const parsed = safeErrorDiagnostic(params?.error);
    const previous = this.turnDiagnostics.get(key);
    const retryCategoryCounts = { ...(previous?.retryCategoryCounts ?? {}) };
    if (willRetry && previousRetryCount < MAX_RETRY_COUNT && parsed.category !== undefined) {
      if (Object.prototype.hasOwnProperty.call(retryCategoryCounts, parsed.category)) {
        retryCategoryCounts[parsed.category] = Math.min(retryCategoryCounts[parsed.category] + 1, MAX_RETRY_COUNT);
      } else if (Object.keys(retryCategoryCounts).length < MAX_RETRY_CATEGORIES) {
        retryCategoryCounts[parsed.category] = 1;
      }
    }
    const diagnostic: SafeTurnDiagnostic = {
      ...previous,
      method: "error",
      willRetry,
      retryCount: retries,
      ...(Object.keys(retryCategoryCounts).length === 0 ? {} : { retryCategoryCounts }),
      ...(previous?.categoryUnknown || parsed.categoryUnknown ? { categoryUnknown: true } : {}),
      ...parsed,
    };
    this.turnDiagnostics.set(key, diagnostic);
  }

  private handleServerRequest(id: number, method: string, params: unknown): void {
    const record = recordObject(params);
    const threadId = record?.threadId;
    const turnId = record?.turnId;
    const key = typeof threadId === "string" && typeof turnId === "string" ? `${threadId}:${turnId}` : undefined;
    if (KNOWN_INTERACTION_METHODS.has(method)) {
      if (key) {
        const diagnostic: SafeTurnDiagnostic = { method };
        this.interactionTurns.set(key, method);
        this.turnDiagnostics.set(key, { ...this.turnDiagnostics.get(key), ...diagnostic });
        this.rejectCompletion(key, new AppServerClientError("SERVER_INTERACTION_REQUIRED", diagnostic));
      }
      const response = this.safeInteractionResponse(method);
      if (response === undefined) this.peer.send({ jsonrpc: "2.0", id, error: { code: -32001, message: "Server interaction is disabled by the relay." } });
      else this.peer.send({ jsonrpc: "2.0", id, result: response });
      return;
    }
    this.peer.send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Server requests are disabled by the relay." } });
  }

  private safeInteractionResponse(method: string): unknown {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" || method === "applyPatchApproval" || method === "execCommandApproval") return { decision: "decline" };
    if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
    if (method === "item/tool/requestUserInput") return { answers: {} };
    if (method === "mcpServer/elicitation/request") return { action: "decline", content: null, _meta: null };
    return undefined;
  }

  private resolveCompletion(key: string, turn: TurnSnapshot): void {
    const waiters = this.completionWaiters.get(key) ?? [];
    this.completionWaiters.delete(key);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(turn);
    }
  }

  private rejectCompletion(key: string, error: AppServerClientError): void {
    const waiters = this.completionWaiters.get(key) ?? [];
    this.completionWaiters.delete(key);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  safeDiagnostics(): string[] {
    return [...this.observedNotificationMethods];
  }

  safeTurnDiagnostics(): SafeTurnDiagnostic[] {
    return [...this.turnDiagnostics.values()].map((diagnostic) => ({ ...diagnostic }));
  }

  request<T>(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (this.closed) return Promise.reject(new AppServerClientError("PROCESS_CLOSED"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerClientError("REQUEST_TIMEOUT", { method }));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.peer.send({ jsonrpc: "2.0", id, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new AppServerClientError("SEND_FAILED", { method })); }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
    this.peer.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", { clientInfo: { name: "work-codex-local-relay", version: "0.1.0" } });
    this.notify("initialized");
    this.initialized = true;
  }

  async startThread(options: ThreadStartOptions): Promise<AppServerThread> {
    if (!this.initialized) throw new AppServerClientError("NOT_INITIALIZED");
    const response = await this.request<{ thread?: AppServerThread }>("thread/start", {
      cwd: options.cwd,
      baseInstructions: options.baseInstructions,
      ephemeral: false,
      sandbox: "read-only",
      approvalPolicy: "never",
      ...(options.model === undefined ? {} : { model: options.model }),
    });
    if (!response.thread || typeof response.thread.id !== "string") throw new AppServerClientError("INVALID_THREAD_RESPONSE");
    return response.thread;
  }

  async listModels(): Promise<readonly AppServerModel[]> {
    if (!this.initialized) throw new AppServerClientError("NOT_INITIALIZED");
    const response = await this.request("model/list", { limit: 20, includeHidden: false });
    return parseModelList(response);
  }

  async runTurn(threadId: string, prompt: string, outputSchema?: unknown): Promise<string> {
    if (!this.initialized) throw new AppServerClientError("NOT_INITIALIZED");
    this.startingThreads.add(threadId);
    let response: { turn?: TurnSnapshot };
    try {
      response = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        ...(outputSchema === undefined ? {} : { outputSchema }),
      });
    } finally {
      this.startingThreads.delete(threadId);
    }
    const turn = response.turn;
    const turnId = turn?.id;
    if (!turn || typeof turnId !== "string") throw new AppServerClientError("INVALID_TURN_RESPONSE");
    const key = `${threadId}:${turnId}`;
    this.activeTurnKeys.add(key);
    try {
      let finalTurn = turn;
      if (turn.status === "inProgress") {
        try {
          finalTurn = await this.waitForCompletion(threadId, turnId, this.turnTimeoutMs, "TURN_TIMEOUT");
        } catch (error) {
          if (error instanceof AppServerClientError && error.code === "TURN_TIMEOUT") throw await this.timeoutAndInterrupt(threadId, turnId, error);
          throw error;
        }
      }
      const diagnostic = this.turnDiagnostics.get(key) ?? {};
      if (finalTurn.status === "failed") throw new AppServerClientError("TURN_FAILED", { ...diagnostic, finalStatus: "failed", ...safeErrorDiagnostic(finalTurn.error) });
      if (finalTurn.status === "interrupted") throw new AppServerClientError("TURN_INTERRUPTED", { ...diagnostic, finalStatus: "interrupted" });
      return this.extractFinalAgentMessage(key, finalTurn);
    } finally {
      this.activeTurnKeys.delete(key);
      this.completedItems.delete(key);
      this.completedTurns.delete(key);
      this.interactionTurns.delete(key);
      this.retryCounts.delete(key);
      this.turnDiagnostics.delete(key);
      this.retiredTurnKeys.add(key);
      if (this.retiredTurnKeys.size > 128) this.retiredTurnKeys.delete(this.retiredTurnKeys.values().next().value as string);
    }
  }

  private extractFinalAgentMessage(key: string, turn: TurnSnapshot): string {
    const completed = this.completedItems.get(key) ?? [];
    const fallback = Array.isArray(turn.items) ? turn.items.filter(isAgentMessage) : [];
    const candidates = completed.length > 0 ? completed : fallback;
    const finalCandidates = candidates.filter((item) => item.phase === "final_answer");
    const selected = (finalCandidates.length > 0 ? finalCandidates : candidates).at(-1);
    if (!selected || selected.text.trim().length === 0) throw new AppServerClientError("EMPTY_AGENT_RESPONSE");
    return selected.text.trim();
  }

  private async timeoutAndInterrupt(threadId: string, turnId: string, primary: AppServerClientError): Promise<AppServerClientError> {
    const key = `${threadId}:${turnId}`;
    let interruptionError: string | undefined;
    try {
      await this.request("turn/interrupt", { threadId, turnId }, this.cleanupTimeoutMs);
    } catch (error) {
      interruptionError = error instanceof AppServerClientError ? error.code : "INTERRUPT_FAILED";
    }
    if (interruptionError === undefined) {
      try {
        const interrupted = await this.waitForCompletion(threadId, turnId, this.cleanupTimeoutMs, "INTERRUPTED_COMPLETION_TIMEOUT");
        if (interrupted.status !== "interrupted") interruptionError = "UNEXPECTED_POST_INTERRUPT_STATUS";
      } catch (error) {
        interruptionError = error instanceof AppServerClientError ? error.code : "INTERRUPTED_COMPLETION_FAILED";
      }
    }
    this.retiredTurnKeys.add(key);
    const diagnostic = { ...this.turnDiagnostics.get(key), ...primary.diagnostic, interruptionError };
    return new AppServerClientError("TURN_TIMEOUT", diagnostic);
  }

  private waitForCompletion(threadId: string, turnId: string, timeoutMs: number, timeoutCode: string): Promise<TurnSnapshot> {
    const key = `${threadId}:${turnId}`;
    if (this.interactionTurns.has(key)) return Promise.reject(new AppServerClientError("SERVER_INTERACTION_REQUIRED", this.turnDiagnostics.get(key)));
    const existing = this.completedTurns.get(key);
    if (existing) return Promise.resolve(existing);
    return new Promise<TurnSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.completionWaiters.get(key) ?? [];
        this.completionWaiters.set(key, waiters.filter((waiter) => waiter.timer !== timer));
        if (this.completionWaiters.get(key)?.length === 0) this.completionWaiters.delete(key);
        reject(new AppServerClientError(timeoutCode, this.turnDiagnostics.get(key)));
      }, timeoutMs);
      const waiter: CompletionWaiter = { resolve, reject, timer };
      this.completionWaiters.set(key, [...(this.completionWaiters.get(key) ?? []), waiter]);
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    if (this.closed) return;
    await this.request("thread/delete", { threadId }, this.cleanupTimeoutMs);
    if (this.deletedThreads.has(threadId)) {
      this.deletedThreads.delete(threadId);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.deletionWaiters.get(threadId) ?? [];
        this.deletionWaiters.set(threadId, waiters.filter((waiter) => waiter.timer !== timer));
        if (this.deletionWaiters.get(threadId)?.length === 0) this.deletionWaiters.delete(threadId);
        reject(new AppServerClientError("THREAD_DELETE_UNCONFIRMED"));
      }, this.cleanupTimeoutMs);
      const waiter: DeletionWaiter = { resolve, reject, timer };
      this.deletionWaiters.set(threadId, [...(this.deletionWaiters.get(threadId) ?? []), waiter]);
    });
    this.deletedThreads.delete(threadId);
  }

  async close(): Promise<AppServerCloseResult> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      this.failAll(new AppServerClientError("PROCESS_CLOSED"));
      this.peer.close();
      const exited = this.peer.waitForExit ? await this.peer.waitForExit(this.cleanupTimeoutMs) : true;
      if (!exited) {
        this.peer.terminate?.();
        const exitedAfterTerminate = this.peer.waitForExit ? await this.peer.waitForExit(this.cleanupTimeoutMs) : true;
        return { exited: exitedAfterTerminate, forced: true };
      }
      return { exited: true, forced: false };
    })();
    return this.closePromise;
  }
}
