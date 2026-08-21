import { createCodexSdkRelayClient, type CodexSdkRelayClient } from "./codex-sdk-relay.js";
import { RelayFailure, runLocalRelay, type RelayAgent, type RelayResult } from "./local-relay.js";
import type { PortableRelayConfig } from "./relay-config.js";

export interface PortableRelayRunOptions {
  timeoutMs?: number;
  sessionId?: string;
  signal?: AbortSignal;
  createClient?: (projectRoot: string, timeoutMs: number) => Promise<CodexSdkRelayClient>;
}

export interface PortableRelayRunResult {
  relay: RelayResult;
  cleanup: "CONFIRMED";
}

class StructuredRelayAgent implements RelayAgent {
  constructor(private readonly client: CodexSdkRelayClient) {}

  startThread(instructions: string, cwd: string): Promise<string> {
    return this.client.startThread(instructions, cwd);
  }

  runTurn(threadId: string, prompt: string, outputSchema?: unknown, signal?: AbortSignal): Promise<string> {
    return this.client.runTurn(threadId, prompt, outputSchema, signal);
  }

  deleteThread(threadId: string): Promise<void> {
    return this.client.deleteThread(threadId);
  }
}

export async function runPortableRelay(config: PortableRelayConfig, options: PortableRelayRunOptions = {}): Promise<PortableRelayRunResult> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000) throw new RelayFailure("PORTABLE_TIMEOUT_INVALID");
  if (options.signal?.aborted) throw new RelayFailure("RELAY_CANCELLED");
  const createClient = options.createClient ?? ((projectRoot: string, configuredTimeout: number) => createCodexSdkRelayClient(projectRoot, { timeoutMs: configuredTimeout }));
  let client: CodexSdkRelayClient | undefined;
  let result: RelayResult | undefined;
  let primaryError: unknown;
  let cleanupConfirmed = false;
  try {
    client = await createClient(config.projectRoot, timeoutMs);
    await client.initialize();
    result = await runLocalRelay(new StructuredRelayAgent(client), {
      cwd: config.projectRoot,
      phase: config.phase,
      point: config.point,
      mission: config.mission,
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(config.workInstructions === undefined ? {} : { workInstructions: config.workInstructions }),
      ...(config.codexInstructions === undefined ? {} : { codexInstructions: config.codexInstructions }),
    }, { signal: options.signal });
  } catch (error) {
    primaryError = error;
  } finally {
    if (client !== undefined) {
      try {
        const closeResult = await client.close();
        cleanupConfirmed = closeResult.exited && !closeResult.forced;
      } catch {
        cleanupConfirmed = false;
      }
    }
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof RelayFailure) {
      if (!cleanupConfirmed) primaryError.cleanupErrors.push("CLIENT_CLOSE_UNCONFIRMED");
      throw primaryError;
    }
    throw new RelayFailure(cleanupConfirmed ? "PORTABLE_RELAY_FAILED" : "PORTABLE_CLEANUP_FAILED");
  }
  if (!result || !cleanupConfirmed) throw new RelayFailure("PORTABLE_CLEANUP_FAILED");
  return { relay: result, cleanup: "CONFIRMED" };
}
