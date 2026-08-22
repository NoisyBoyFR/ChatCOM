import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Codex, type CodexOptions, type Thread, type ThreadEvent, type ThreadOptions, type TurnOptions } from "@openai/codex-sdk";
import { AppServerClientError, type AppServerCloseResult, type SafeSdkFailureCategory, type SafeTurnDiagnostic } from "./app-server-client.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const STREAM_CLEANUP_TIMEOUT_MS = 5_000;
const CODEX_HOME_DIRECTORY = ".codex";
export const EXPECTED_RUNTIME_VERSION = "0.149.0" as const;
const moduleRequire = createRequire(import.meta.url);

export type SdkRunStage = NonNullable<SafeTurnDiagnostic["sdkStage"]>;
export type SdkLifecycleStage = NonNullable<SafeTurnDiagnostic["sdkLastStage"]>;
export type SdkStreamTerminal = NonNullable<SafeTurnDiagnostic["terminal"]>;
export interface SdkStreamProof {
  threadStarted: boolean;
  turnStarted: boolean;
  eventCount: number;
  eventTypes: string[];
  unknownEventCount: number;
  streamActive: boolean;
  lastLifecycleStage: SdkLifecycleStage;
  terminal: SdkStreamTerminal;
  abortRequested: boolean;
  streamClosed: boolean;
  failureCategory: SafeSdkFailureCategory;
}

const MAX_STREAM_EVENTS = 64;
const ALLOWED_STREAM_EVENTS = new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", "error"]);
const KNOWN_OMITTED_STREAM_EVENTS = new Set(["item.started", "item.updated", "item.completed"]);

type SdkThread = Pick<Thread, "runStreamed"> & { id: string | null };
type SdkClient = Pick<Codex, "startThread">;
type SdkStreamed = Awaited<ReturnType<SdkThread["runStreamed"]>>;
type StreamStartOutcome =
  | { kind: "started"; streamed: SdkStreamed }
  | { kind: "start-error"; error: unknown };

export class CodexSdkRelayError extends AppServerClientError {
  constructor(code: string, readonly sdkStage: SdkRunStage, readonly sdkLastStage: SdkLifecycleStage, readonly streamProof?: SdkStreamProof, diagnostic?: SafeTurnDiagnostic) {
    super(code, {
      ...diagnostic,
      sdkStage,
      sdkLastStage,
      ...(streamProof === undefined ? {} : {
        terminal: streamProof.terminal,
        threadStarted: streamProof.threadStarted,
        turnStarted: streamProof.turnStarted,
        streamClosed: streamProof.streamClosed,
        failureCategory: streamProof.failureCategory,
      }),
    });
  }
}

export interface CodexSdkRelayOptions {
  timeoutMs?: number;
  streamCleanupTimeoutMs?: number;
  environment?: Record<string, string>;
  codexPathOverride?: string;
  codex?: SdkClient;
  codexFactory?: (options?: CodexOptions) => SdkClient;
}

export interface CodexSdkRelayClient {
  initialize(): Promise<void>;
  startThread(instructions: string, cwd: string): Promise<string>;
  runTurn(threadId: string, prompt: string, outputSchema?: unknown, signal?: AbortSignal): Promise<string>;
  deleteThread(threadId: string): Promise<void>;
  close(): Promise<AppServerCloseResult>;
}

type OwnedThread = { thread: SdkThread; cwd: string; instructions: string; firstTurn: boolean };

async function listFiles(directory: string): Promise<Set<string>> {
  const files = new Set<string>();
  const visit = async (current: string): Promise<void> => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.add(resolve(path));
    }
  };
  await visit(directory);
  return files;
}

async function canonicalExecutable(path: string): Promise<string> {
  let canonical: string;
  try { canonical = await import("node:fs/promises").then(({ realpath }) => realpath(path)); }
  catch { throw new AppServerClientError("SDK_RUNTIME_NOT_FOUND"); }
  try {
    const fileStats = await stat(canonical);
    if (!fileStats.isFile()) throw new Error("not-file");
  } catch { throw new AppServerClientError("SDK_RUNTIME_NOT_FOUND"); }
  return canonical;
}

export async function resolveBundledCodexRuntime(): Promise<string> {
  const target = process.platform === "win32" && process.arch === "x64"
    ? ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc", "codex.exe"]
    : process.platform === "win32" && process.arch === "arm64"
      ? ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc", "codex.exe"]
      : process.platform === "darwin" && process.arch === "x64"
        ? ["@openai/codex-darwin-x64", "x86_64-apple-darwin", "codex"]
        : process.platform === "darwin" && process.arch === "arm64"
          ? ["@openai/codex-darwin-arm64", "aarch64-apple-darwin", "codex"]
          : process.platform === "linux" && process.arch === "x64"
            ? ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl", "codex"]
            : process.platform === "linux" && process.arch === "arm64"
              ? ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl", "codex"]
              : undefined;
  if (!target) throw new AppServerClientError("SDK_RUNTIME_NOT_FOUND");
  const [packageName, targetTriple, executableName] = target;
  const packageJsonCandidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath !== undefined && packageName.startsWith("@openai/")) {
    const shortName = packageName.slice("@openai/".length);
    packageJsonCandidates.push(join(resourcesPath, "app.asar.unpacked", "node_modules", "@openai", shortName, "package.json"));
  }
  try { packageJsonCandidates.push(moduleRequire.resolve(`${packageName}/package.json`)); } catch { /* packaged fallback is checked above */ }
  for (const packageJsonPath of packageJsonCandidates) {
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
      if (typeof packageJson.version !== "string" || !(packageJson.version === EXPECTED_RUNTIME_VERSION || packageJson.version.startsWith(`${EXPECTED_RUNTIME_VERSION}-`))) continue;
      return await canonicalExecutable(join(dirname(packageJsonPath), "vendor", targetTriple, "bin", executableName));
    } catch { /* try the next bounded candidate */ }
  }
  throw new AppServerClientError("SDK_RUNTIME_NOT_FOUND");
}

export function classifySdkFailure(value: unknown): SafeSdkFailureCategory {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
  const raw = [record?.code, record?.message, record?.error].filter((part): part is string => typeof part === "string").join(" ").toLowerCase();
  if (/\b(unauthori[sz]ed|not authenticated|login required|authentication required|invalid api key)\b/u.test(raw)) return "AUTH_REQUIRED";
  if (/\b(forbidden|access denied|permission denied|status\s*403)\b/u.test(raw)) return "ACCESS_DENIED";
  if (/\b(rate limit|too many requests|status\s*429)\b/u.test(raw)) return "RATE_LIMITED";
  if (/\b(quota|usage limit|insufficient quota|status\s*402)\b/u.test(raw)) return "QUOTA_EXCEEDED";
  if (/\b(network|connection|connect|dns|socket|timed out|timeout|status\s*5\d\d)\b/u.test(raw)) return "NETWORK_UNAVAILABLE";
  if (/\b(schema|structured output|output schema|json schema)\b/u.test(raw)) return "OUTPUT_SCHEMA_REJECTED";
  if (/\b(model|deployment)\b.*\b(unavailable|not found|unsupported)\b/u.test(raw)) return "MODEL_UNAVAILABLE";
  if (/\b(config|configuration|invalid argument|bad request)\b/u.test(raw)) return "CONFIG_INVALID";
  if (raw.length > 0) return "RUNTIME_FAILED";
  return "UNKNOWN";
}

function safeSdkDiagnostic(finalStatus: SafeTurnDiagnostic["finalStatus"], proof: SdkStreamProof, error?: unknown): SafeTurnDiagnostic {
  return { method: "codex-sdk", categoryUnknown: true, finalStatus, failureCategory: proof.failureCategory === "UNKNOWN" ? classifySdkFailure(error) : proof.failureCategory };
}

function createStreamProof(): SdkStreamProof {
  return {
    threadStarted: false,
    turnStarted: false,
    eventCount: 0,
    eventTypes: [],
    unknownEventCount: 0,
    streamActive: false,
    lastLifecycleStage: "NONE",
    terminal: "ABSENT",
    abortRequested: false,
    streamClosed: false,
    failureCategory: "UNKNOWN",
  };
}

function snapshotStreamProof(proof: SdkStreamProof): SdkStreamProof {
  return { ...proof, eventTypes: [...proof.eventTypes] };
}

function recordStreamEvent(proof: SdkStreamProof, event: ThreadEvent): void {
  const type = event.type;
  proof.eventCount = Math.min(MAX_STREAM_EVENTS, proof.eventCount + 1);
  if (KNOWN_OMITTED_STREAM_EVENTS.has(type)) return;
  const boundedType = ALLOWED_STREAM_EVENTS.has(type) ? type : "UNKNOWN";
  if (proof.eventTypes.length < 16 && !proof.eventTypes.includes(boundedType)) proof.eventTypes.push(boundedType);
  if (boundedType === "UNKNOWN") proof.unknownEventCount = Math.min(16, proof.unknownEventCount + 1);
  if (type === "error" || type === "turn.failed") {
    const record = event as unknown as Record<string, unknown>;
    proof.failureCategory = classifySdkFailure(record.error ?? record.message);
  }
}

async function closeStreamWithin(streamed: SdkStreamed, timeoutMs: number): Promise<boolean> {
  const closePromise = Promise.resolve().then(async () => {
    const iterator = streamed.events[Symbol.asyncIterator]();
    if (typeof iterator.return !== "function") return false;
    await iterator.return(undefined);
    return true;
  }).catch(() => false);
  return waitForBoolean(closePromise, timeoutMs);
}

async function waitForBoolean(operation: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function waitForStreamStartCleanup(streamStartPromise: Promise<StreamStartOutcome>, timeoutMs: number): Promise<boolean> {
  const cleanupPromise = streamStartPromise.then(async (outcome) => outcome.kind === "started" ? closeStreamWithin(outcome.streamed, timeoutMs) : true);
  return waitForBoolean(cleanupPromise, timeoutMs);
}

export class CodexSdkRelayClientImpl implements CodexSdkRelayClient {
  private readonly threads = new Map<string, OwnedThread>();
  private readonly ownedCodexThreadIds = new Set<string>();
  private activeStreams = 0;
  private lastProof: SdkStreamProof | undefined;
  private nextThreadId = 1;
  private closed = false;

  private constructor(
    private readonly codex: SdkClient,
    private readonly timeoutMs: number,
    private readonly streamCleanupTimeoutMs: number,
    private readonly sessionDirectory: string,
    private readonly initialSessionFiles: Set<string>,
  ) {}

  static async create(cwd: string, options: CodexSdkRelayOptions = {}): Promise<CodexSdkRelayClientImpl> {
    const environment = options.environment;
    const codexHome = environment?.CODEX_HOME ?? join(homedir(), CODEX_HOME_DIRECTORY);
    const sessionDirectory = join(codexHome, "sessions");
    const initialSessionFiles = await listFiles(sessionDirectory);
    let codex = options.codex;
    if (codex === undefined) {
      const runtimePath = options.codexPathOverride === undefined ? await resolveBundledCodexRuntime() : await canonicalExecutable(options.codexPathOverride);
      codex = (options.codexFactory ?? ((codexOptions) => new Codex(codexOptions)))({
        codexPathOverride: runtimePath,
        ...(environment === undefined ? {} : { env: environment }),
      });
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("SDK_TIMEOUT_INVALID");
    const streamCleanupTimeoutMs = options.streamCleanupTimeoutMs ?? STREAM_CLEANUP_TIMEOUT_MS;
    if (!Number.isSafeInteger(streamCleanupTimeoutMs) || streamCleanupTimeoutMs <= 0) throw new Error("SDK_CLEANUP_TIMEOUT_INVALID");
    return new CodexSdkRelayClientImpl(codex, timeoutMs, streamCleanupTimeoutMs, sessionDirectory, initialSessionFiles);
  }

  async initialize(): Promise<void> {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
  }

  get lastStreamProof(): SdkStreamProof | undefined {
    return this.lastProof === undefined ? undefined : snapshotStreamProof(this.lastProof);
  }

  async startThread(instructions: string, cwd: string): Promise<string> {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
    const threadOptions: ThreadOptions = {
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
    };
    const thread = this.codex.startThread(threadOptions) as SdkThread;
    const id = `sdk-thread-${this.nextThreadId++}`;
    this.threads.set(id, { thread, cwd, instructions, firstTurn: true });
    return id;
  }

  async runTurn(threadId: string, prompt: string, outputSchema?: unknown, signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
    const owned = this.threads.get(threadId);
    if (!owned) throw new AppServerClientError("THREAD_NOT_FOUND");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const turnSignal = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    const turnOptions: TurnOptions = { signal: turnSignal, ...(outputSchema === undefined ? {} : { outputSchema }) };
    let stage: SdkRunStage = "LAUNCH";
    const proof = createStreamProof();
    let terminal: "completed" | "failed" | undefined;
    let finalResponse = "";
    let streamPromise: Promise<void> | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let cancellationListener: (() => void) | undefined;
    let cancellationPromise: Promise<"cancelled"> | undefined;
    try {
      if (signal?.aborted === true) {
        proof.abortRequested = true;
        controller.abort();
        throw new CodexSdkRelayError("SDK_TURN_CANCELLED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
      }
      const input = owned.firstTurn ? `${owned.instructions}\n\n${prompt}` : prompt;
      owned.firstTurn = false;
      if (signal !== undefined) {
        cancellationPromise = new Promise<"cancelled">((resolve) => {
          cancellationListener = () => {
            proof.abortRequested = true;
            controller.abort();
            resolve("cancelled");
          };
          signal.addEventListener("abort", cancellationListener, { once: true });
        });
      }
      const timeoutOutcome = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => {
          stage = "TERMINAL_ABSENT";
          proof.abortRequested = true;
          controller.abort();
          resolve("timeout");
        }, this.timeoutMs);
      });
      const streamStartPromise = owned.thread.runStreamed(input, turnOptions).then(
        (streamed): StreamStartOutcome => ({ kind: "started", streamed }),
        (error: unknown): StreamStartOutcome => ({ kind: "start-error", error }),
      );
      const startOutcome = await Promise.race([
        streamStartPromise,
        timeoutOutcome,
        ...(cancellationPromise === undefined ? [] : [cancellationPromise]),
      ]);
      if (startOutcome === "cancelled" || startOutcome === "timeout") {
        const startedAndClosed = await waitForStreamStartCleanup(streamStartPromise, this.streamCleanupTimeoutMs);
        proof.streamClosed = startedAndClosed;
        if (!startedAndClosed) throw new CodexSdkRelayError("SDK_STREAM_CLEANUP_FAILED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
        throw new CodexSdkRelayError(startOutcome === "cancelled" ? "SDK_TURN_CANCELLED" : "SDK_TURN_TIMEOUT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
      }
      if (startOutcome.kind === "start-error") throw startOutcome.error;
      const streamed = startOutcome.streamed;
      const iterator = streamed.events[Symbol.asyncIterator]();
      this.activeStreams += 1;
      streamPromise = (async () => {
        try {
          for await (const event of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<ThreadEvent>) {
            recordStreamEvent(proof, event);
            proof.streamActive = true;
            if (event.type === "thread.started") {
              proof.threadStarted = true;
              proof.lastLifecycleStage = "THREAD_CREATION";
              stage = "THREAD_CREATION";
              if (owned.thread.id !== null) this.ownedCodexThreadIds.add(owned.thread.id);
            } else if (event.type === "turn.started") {
              proof.turnStarted = true;
              proof.lastLifecycleStage = "TURN_START";
              stage = "TURN_START";
            } else if (event.type === "turn.completed") {
              terminal = "completed";
              proof.terminal = "COMPLETED";
              proof.lastLifecycleStage = "TERMINAL_COMPLETED";
              stage = "TERMINAL_COMPLETED";
            } else if (event.type === "turn.failed") {
              terminal = "failed";
              proof.terminal = "FAILED";
              proof.lastLifecycleStage = "TERMINAL_FAILED";
              stage = "TERMINAL_FAILED";
            } else if (event.type === "item.completed" && event.item.type === "agent_message") {
              finalResponse = event.item.text;
            }
          }
        } finally {
          proof.streamClosed = true;
          this.activeStreams = Math.max(0, this.activeStreams - 1);
        }
      })();
      const streamOutcome = streamPromise.then(
        () => ({ kind: "stream" as const }),
        (error: unknown) => ({ kind: "stream-error" as const, error }),
      );
      const outcome = await Promise.race([
        streamOutcome,
        timeoutOutcome,
        ...(cancellationPromise === undefined ? [] : [cancellationPromise]),
      ]);
      if (outcome === "cancelled" || outcome === "timeout") {
        const settled = await waitForBoolean(streamPromise.then(() => true, () => true), this.streamCleanupTimeoutMs);
        proof.streamClosed = settled;
        if (!settled) throw new CodexSdkRelayError("SDK_STREAM_CLEANUP_FAILED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
        throw new CodexSdkRelayError(outcome === "cancelled" ? "SDK_TURN_CANCELLED" : "SDK_TURN_TIMEOUT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
      }
      if (outcome.kind === "stream-error") throw outcome.error;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (signal !== undefined && signal.aborted && terminal === undefined) throw new CodexSdkRelayError("SDK_TURN_CANCELLED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
      if (terminal === "failed") throw new CodexSdkRelayError("SDK_TURN_FAILED", "TERMINAL_FAILED", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("failed", proof));
      if (terminal !== "completed") throw new CodexSdkRelayError("SDK_TERMINAL_ABSENT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("failed", proof));
      if (typeof finalResponse !== "string" || finalResponse.trim().length === 0) throw new AppServerClientError("SDK_INVALID_RESPONSE", safeSdkDiagnostic("failed", proof));
      if (owned.thread.id !== null) this.ownedCodexThreadIds.add(owned.thread.id);
      return finalResponse;
    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (error instanceof AppServerClientError) {
        if (error.code === "SDK_STREAM_CLEANUP_FAILED") throw error;
        const timeoutOrAbsent = error.code === "SDK_TURN_TIMEOUT" || error.code === "SDK_TERMINAL_ABSENT" || turnSignal.aborted;
        if (streamPromise !== undefined && timeoutOrAbsent) {
          const settled = await waitForBoolean(streamPromise.then(() => true, () => true), this.streamCleanupTimeoutMs);
          proof.streamClosed = settled;
          if (!settled) throw new CodexSdkRelayError("SDK_STREAM_CLEANUP_FAILED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
          throw new CodexSdkRelayError(signal?.aborted === true ? "SDK_TURN_CANCELLED" : "SDK_TURN_TIMEOUT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted", proof));
        }
        throw error;
      }
      const timeoutOrAbort = turnSignal.aborted;
      if (timeoutOrAbort) proof.abortRequested = true;
      throw new CodexSdkRelayError(signal?.aborted === true ? "SDK_TURN_CANCELLED" : timeoutOrAbort ? "SDK_TURN_TIMEOUT" : "SDK_TURN_FAILED", timeoutOrAbort ? "TERMINAL_ABSENT" : stage, proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic(timeoutOrAbort ? "interrupted" : "failed", proof, error));
    } finally {
      this.lastProof = snapshotStreamProof(proof);
      if (owned.thread.id !== null) this.ownedCodexThreadIds.add(owned.thread.id);
      clearTimeout(timer);
      if (signal !== undefined && cancellationListener !== undefined) signal.removeEventListener("abort", cancellationListener);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.threads.delete(threadId) && !this.closed) throw new AppServerClientError("THREAD_NOT_FOUND");
  }

  private async removeOwnedSessionFiles(): Promise<void> {
    if (this.ownedCodexThreadIds.size === 0) return;
    const currentFiles = await listFiles(this.sessionDirectory);
    for (const path of currentFiles) {
      if (this.initialSessionFiles.has(path)) continue;
      let content: string;
      try { content = await readFile(path, "utf8"); }
      catch { continue; }
      if ([...this.ownedCodexThreadIds].some((threadId) => content.includes(threadId))) {
        const fileStats = await stat(path);
        if (fileStats.isFile()) {
          const { unlink } = await import("node:fs/promises");
          await unlink(path);
        }
      }
    }
  }

  async close(): Promise<AppServerCloseResult> {
    if (this.closed) return { exited: true, forced: false };
    this.closed = true;
    const exited = this.activeStreams === 0;
    await this.removeOwnedSessionFiles();
    this.threads.clear();
    return { exited, forced: false };
  }
}

export async function createCodexSdkRelayClient(cwd: string, options: CodexSdkRelayOptions = {}): Promise<CodexSdkRelayClientImpl> {
  return CodexSdkRelayClientImpl.create(cwd, options);
}
