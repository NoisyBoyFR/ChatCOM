import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Codex, type CodexOptions, type Thread, type ThreadEvent, type ThreadOptions, type TurnOptions } from "@openai/codex-sdk";
import { AppServerClientError, type AppServerCloseResult, type SafeTurnDiagnostic } from "./app-server-client.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const STREAM_CLEANUP_TIMEOUT_MS = 5_000;
const CODEX_HOME_DIRECTORY = ".codex";
const EXPECTED_RUNTIME_VERSION = "0.149.0";
const moduleRequire = createRequire(import.meta.url);

export type SdkRunStage = "LAUNCH" | "THREAD_CREATION" | "TURN_START" | "STREAM_ACTIVE" | "TERMINAL_ABSENT" | "TERMINAL_COMPLETED" | "TERMINAL_FAILED";
export type SdkLifecycleStage = "NONE" | "THREAD_CREATION" | "TURN_START" | "TERMINAL_COMPLETED" | "TERMINAL_FAILED";
export type SdkStreamTerminal = "ABSENT" | "COMPLETED" | "FAILED";
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
}

const MAX_STREAM_EVENTS = 64;
const ALLOWED_STREAM_EVENTS = new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", "error"]);
const KNOWN_OMITTED_STREAM_EVENTS = new Set(["item.started", "item.updated", "item.completed"]);

type SdkThread = Pick<Thread, "runStreamed"> & { id: string | null };
type SdkClient = Pick<Codex, "startThread">;

export class CodexSdkRelayError extends AppServerClientError {
  constructor(code: string, readonly sdkStage: SdkRunStage, readonly sdkLastStage: SdkLifecycleStage, readonly streamProof?: SdkStreamProof, diagnostic?: SafeTurnDiagnostic) {
    super(code, { ...diagnostic, sdkStage, sdkLastStage });
  }
}

export interface CodexSdkRelayOptions {
  timeoutMs?: number;
  environment?: Record<string, string>;
  codexPathOverride?: string;
  codex?: SdkClient;
  codexFactory?: (options?: CodexOptions) => SdkClient;
}

export interface CodexSdkRelayClient {
  initialize(): Promise<void>;
  startThread(instructions: string, cwd: string): Promise<string>;
  runTurn(threadId: string, prompt: string, outputSchema?: unknown): Promise<string>;
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
  try {
    const packageJsonPath = moduleRequire.resolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
    if (typeof packageJson.version !== "string" || !(packageJson.version === EXPECTED_RUNTIME_VERSION || packageJson.version.startsWith(`${EXPECTED_RUNTIME_VERSION}-`))) throw new Error("runtime-version");
    return await canonicalExecutable(join(dirname(packageJsonPath), "vendor", targetTriple, "bin", executableName));
  } catch (error) {
    if (error instanceof AppServerClientError) throw error;
    throw new AppServerClientError("SDK_RUNTIME_NOT_FOUND");
  }
}

function safeSdkDiagnostic(finalStatus: SafeTurnDiagnostic["finalStatus"]): SafeTurnDiagnostic {
  return { method: "codex-sdk", categoryUnknown: true, finalStatus };
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
  };
}

function snapshotStreamProof(proof: SdkStreamProof): SdkStreamProof {
  return { ...proof, eventTypes: [...proof.eventTypes] };
}

function recordStreamEvent(proof: SdkStreamProof, type: string): void {
  proof.eventCount = Math.min(MAX_STREAM_EVENTS, proof.eventCount + 1);
  if (KNOWN_OMITTED_STREAM_EVENTS.has(type)) return;
  const boundedType = ALLOWED_STREAM_EVENTS.has(type) ? type : "UNKNOWN";
  if (proof.eventTypes.length < 16 && !proof.eventTypes.includes(boundedType)) proof.eventTypes.push(boundedType);
  if (boundedType === "UNKNOWN") proof.unknownEventCount = Math.min(16, proof.unknownEventCount + 1);
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
    return new CodexSdkRelayClientImpl(codex, timeoutMs, sessionDirectory, initialSessionFiles);
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

  async runTurn(threadId: string, prompt: string, outputSchema?: unknown): Promise<string> {
    if (this.closed) throw new AppServerClientError("PROCESS_CLOSED");
    const owned = this.threads.get(threadId);
    if (!owned) throw new AppServerClientError("THREAD_NOT_FOUND");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const turnOptions: TurnOptions = { signal: controller.signal, ...(outputSchema === undefined ? {} : { outputSchema }) };
    let stage: SdkRunStage = "LAUNCH";
    const proof = createStreamProof();
    let terminal: "completed" | "failed" | undefined;
    let finalResponse = "";
    let streamPromise: Promise<void> | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const input = owned.firstTurn ? `${owned.instructions}\n\n${prompt}` : prompt;
      owned.firstTurn = false;
      const streamed = await owned.thread.runStreamed(input, turnOptions);
      const iterator = streamed.events[Symbol.asyncIterator]();
      this.activeStreams += 1;
      streamPromise = (async () => {
        try {
          for await (const event of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<ThreadEvent>) {
            recordStreamEvent(proof, event.type);
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
      const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => {
        stage = "TERMINAL_ABSENT";
        proof.abortRequested = true;
        controller.abort();
        reject(new AppServerClientError("SDK_TURN_TIMEOUT"));
      }, this.timeoutMs); });
      await Promise.race([streamPromise, timeout]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (terminal === "failed") throw new CodexSdkRelayError("SDK_TURN_FAILED", "TERMINAL_FAILED", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("failed"));
      if (terminal !== "completed") throw new CodexSdkRelayError("SDK_TERMINAL_ABSENT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("failed"));
      if (typeof finalResponse !== "string" || finalResponse.trim().length === 0) throw new AppServerClientError("SDK_INVALID_RESPONSE", safeSdkDiagnostic("failed"));
      if (owned.thread.id !== null) this.ownedCodexThreadIds.add(owned.thread.id);
      return finalResponse;
    } catch (error) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (error instanceof AppServerClientError) {
        const timeoutOrAbsent = error.code === "SDK_TURN_TIMEOUT" || error.code === "SDK_TERMINAL_ABSENT" || controller.signal.aborted;
        if (streamPromise !== undefined && timeoutOrAbsent) {
          const settled = await Promise.race([streamPromise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STREAM_CLEANUP_TIMEOUT_MS))]);
          proof.streamClosed = settled;
          if (!settled) throw new CodexSdkRelayError("SDK_STREAM_CLEANUP_FAILED", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted"));
          throw new CodexSdkRelayError("SDK_TURN_TIMEOUT", "TERMINAL_ABSENT", proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic("interrupted"));
        }
        throw error;
      }
      const timeoutOrAbort = controller.signal.aborted;
      if (timeoutOrAbort) proof.abortRequested = true;
      throw new CodexSdkRelayError(timeoutOrAbort ? "SDK_TURN_TIMEOUT" : "SDK_TURN_FAILED", timeoutOrAbort ? "TERMINAL_ABSENT" : stage, proof.lastLifecycleStage, snapshotStreamProof(proof), safeSdkDiagnostic(timeoutOrAbort ? "interrupted" : "failed"));
    } finally {
      this.lastProof = snapshotStreamProof(proof);
      if (owned.thread.id !== null) this.ownedCodexThreadIds.add(owned.thread.id);
      clearTimeout(timer);
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
