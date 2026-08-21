import { randomUUID } from "node:crypto";
import { RelayFailure } from "../local-relay.js";
import { runPortableRelay, type PortableRelayRunResult } from "../portable-relay.js";
import type { MessageEnvelope } from "../message-contract.js";
import type { PortableRelayConfig } from "../relay-config.js";

export const CONVERSATION_DEFAULT_MAX_CYCLES = 5;
export const CONVERSATION_MAX_CYCLES = 20;
export const CONVERSATION_DEFAULT_CYCLE_TIMEOUT_MS = 600_000;
export const CONVERSATION_DEFAULT_GLOBAL_TIMEOUT_MS = 3_600_000;

export type ConversationState =
  | "IDLE"
  | "CONFIGURING"
  | "READY"
  | "RUNNING"
  | "PAUSE_REQUESTED"
  | "PAUSED"
  | "USER_DECISION_REQUIRED"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED";

export type ConversationCleanup = "UNKNOWN" | "CONFIRMED" | "NOT_CONFIRMED";

export interface ConversationInput {
  projectRoot: string;
  phase: string;
  point: string;
  mission: string;
  maxCycles?: number;
  cycleTimeoutMs?: number;
  globalTimeoutMs?: number;
  workInstructions?: string;
  codexInstructions?: string;
}

export interface ConversationDiagnostic {
  code: string;
  relayStage?: string;
  completedTransmissions: number;
  cleanup: Exclude<ConversationCleanup, "UNKNOWN">;
}

export interface ConversationSnapshot {
  conversationId: string;
  state: ConversationState;
  cycle: number;
  maxCycles: number;
  elapsedMs: number;
  currentSessionId?: string;
  cleanup: ConversationCleanup;
  lastDiagnostic?: ConversationDiagnostic;
}

export type ConversationEvent =
  | { kind: "snapshot"; snapshot: ConversationSnapshot }
  | { kind: "cycle_started"; cycle: number; sessionId: string }
  | { kind: "transmission"; cycle: number; message: MessageEnvelope }
  | { kind: "cycle_completed"; cycle: number; cleanup: "CONFIRMED"; nextPrompt: string }
  | { kind: "diagnostic"; diagnostic: ConversationDiagnostic };

export interface ConversationRelay {
  run(config: PortableRelayConfig, options: { timeoutMs: number; sessionId: string; signal: AbortSignal }): Promise<ConversationRelayResult>;
}

export type ConversationRelayResult = Omit<PortableRelayRunResult, "cleanup"> & { cleanup: "CONFIRMED" | "NOT_CONFIRMED" };

const defaultRelay: ConversationRelay = {
  run: (config, options) => runPortableRelay(config, options),
};

function boundedString(value: unknown, code: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes) throw new RelayFailure(code);
  return value;
}

function boundedInteger(value: unknown, fallback: number, maximum: number, code: string): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) throw new RelayFailure(code);
  return resolved;
}

function diagnosticFrom(error: unknown, fallbackCode: string): ConversationDiagnostic {
  const relayError = error instanceof RelayFailure ? error : undefined;
  return {
    code: relayError?.code ?? fallbackCode,
    ...(relayError?.relayStage === undefined ? {} : { relayStage: relayError.relayStage }),
    completedTransmissions: relayError?.completedTransmissions ?? 0,
    cleanup: relayError && relayError.cleanupErrors.length === 0 ? "CONFIRMED" : "NOT_CONFIRMED",
  };
}

export function validateConversationInput(input: ConversationInput): Required<ConversationInput> {
  const workInstructions = input.workInstructions === undefined ? "" : boundedString(input.workInstructions, "WORK_INSTRUCTIONS_INVALID", 16_384);
  const codexInstructions = input.codexInstructions === undefined ? "" : boundedString(input.codexInstructions, "CODEX_INSTRUCTIONS_INVALID", 16_384);
  return {
    projectRoot: boundedString(input.projectRoot, "PROJECT_ROOT_INVALID", 4_096),
    phase: boundedString(input.phase, "PHASE_INVALID", 256),
    point: boundedString(input.point, "POINT_INVALID", 256),
    mission: boundedString(input.mission, "MISSION_INVALID", 16_384),
    maxCycles: boundedInteger(input.maxCycles, CONVERSATION_DEFAULT_MAX_CYCLES, CONVERSATION_MAX_CYCLES, "MAX_CYCLES_INVALID"),
    cycleTimeoutMs: boundedInteger(input.cycleTimeoutMs, CONVERSATION_DEFAULT_CYCLE_TIMEOUT_MS, 3_600_000, "CYCLE_TIMEOUT_INVALID"),
    globalTimeoutMs: boundedInteger(input.globalTimeoutMs, CONVERSATION_DEFAULT_GLOBAL_TIMEOUT_MS, 86_400_000, "GLOBAL_TIMEOUT_INVALID"),
    workInstructions,
    codexInstructions,
  };
}

export class ConversationOrchestrator {
  private readonly conversationId = randomUUID();
  private readonly listeners = new Set<(event: ConversationEvent) => void>();
  private readonly relay: ConversationRelay;
  private input: Required<ConversationInput> | undefined;
  private state: ConversationState = "IDLE";
  private cycle = 0;
  private startedAt = 0;
  private currentSessionId: string | undefined;
  private cleanup: ConversationCleanup = "UNKNOWN";
  private lastDiagnostic: ConversationDiagnostic | undefined;
  private nextMission: string | undefined;
  private pauseRequested = false;
  private stopRequested = false;
  private controller: AbortController | undefined;
  private activeRun: Promise<void> | undefined;

  constructor(relay: ConversationRelay = defaultRelay) {
    this.relay = relay;
  }

  subscribe(listener: (event: ConversationEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ kind: "snapshot", snapshot: this.snapshot() });
    return () => this.listeners.delete(listener);
  }

  configure(input: ConversationInput): ConversationSnapshot {
    if (this.activeRun !== undefined) throw new RelayFailure("CONFIGURATION_WHILE_RUNNING");
    this.state = "CONFIGURING";
    this.input = validateConversationInput(input);
    this.cycle = 0;
    this.currentSessionId = undefined;
    this.cleanup = "UNKNOWN";
    this.lastDiagnostic = undefined;
    this.nextMission = this.input.mission;
    this.state = "READY";
    this.emitSnapshot();
    return this.snapshot();
  }

  snapshot(): ConversationSnapshot {
    return {
      conversationId: this.conversationId,
      state: this.state,
      cycle: this.cycle,
      maxCycles: this.input?.maxCycles ?? CONVERSATION_DEFAULT_MAX_CYCLES,
      elapsedMs: this.startedAt === 0 ? 0 : Date.now() - this.startedAt,
      ...(this.currentSessionId === undefined ? {} : { currentSessionId: this.currentSessionId }),
      cleanup: this.cleanup,
      ...(this.lastDiagnostic === undefined ? {} : { lastDiagnostic: this.lastDiagnostic }),
    };
  }

  async start(): Promise<void> {
    if (this.state !== "READY" && this.state !== "PAUSED") throw new RelayFailure("START_STATE_INVALID");
    if (!this.input || this.activeRun !== undefined) throw new RelayFailure("START_STATE_INVALID");
    this.pauseRequested = false;
    this.stopRequested = false;
    this.controller = new AbortController();
    if (this.startedAt === 0 || this.state === "READY") this.startedAt = Date.now();
    this.activeRun = this.runLoop(this.controller).finally(() => {
      this.activeRun = undefined;
      this.controller = undefined;
      this.emitSnapshot();
    });
    await this.activeRun;
  }

  requestPause(): ConversationSnapshot {
    if (this.state !== "RUNNING") throw new RelayFailure("PAUSE_STATE_INVALID");
    this.pauseRequested = true;
    this.state = "PAUSE_REQUESTED";
    this.emitSnapshot();
    return this.snapshot();
  }

  async resume(): Promise<void> {
    if (this.state !== "PAUSED") throw new RelayFailure("RESUME_STATE_INVALID");
    await this.start();
  }

  async stop(): Promise<void> {
    if (this.state === "IDLE" || this.state === "STOPPED" || this.state === "COMPLETED") {
      this.state = "STOPPED";
      this.emitSnapshot();
      return;
    }
    this.stopRequested = true;
    this.pauseRequested = false;
    if (this.activeRun === undefined) {
      this.state = "STOPPED";
      this.cleanup = "CONFIRMED";
      this.emitSnapshot();
      return;
    }
    this.state = "STOPPING";
    this.emitSnapshot();
    this.controller?.abort();
    await this.activeRun;
  }

  async exportReport(): Promise<string> {
    return JSON.stringify({ generatedAt: new Date().toISOString(), snapshot: this.snapshot() }, null, 2);
  }

  private async runLoop(controller: AbortController): Promise<void> {
    const input = this.input as Required<ConversationInput>;
    const globalTimer = setTimeout(() => controller.abort(), input.globalTimeoutMs);
    try {
      while (!this.stopRequested && this.cycle < input.maxCycles) {
        this.cycle += 1;
        this.currentSessionId = randomUUID();
        const sessionId = this.currentSessionId;
        this.state = "RUNNING";
        this.cleanup = "UNKNOWN";
        this.emit({ kind: "cycle_started", cycle: this.cycle, sessionId });
        this.emitSnapshot();
        const config: PortableRelayConfig = {
          version: "1.0",
          projectRoot: input.projectRoot,
          phase: input.phase,
          point: input.point,
          mission: this.nextMission as string,
          ...(input.workInstructions.length === 0 ? {} : { workInstructions: input.workInstructions }),
          ...(input.codexInstructions.length === 0 ? {} : { codexInstructions: input.codexInstructions }),
        };
        let result: ConversationRelayResult;
        try {
          result = await this.relay.run(config, { timeoutMs: input.cycleTimeoutMs, sessionId, signal: controller.signal });
        } catch (error) {
          const diagnostic = diagnosticFrom(error, controller.signal.aborted ? "RELAY_CANCELLED" : "RELAY_FAILED");
          this.lastDiagnostic = diagnostic;
          this.cleanup = diagnostic.cleanup;
          this.emit({ kind: "diagnostic", diagnostic });
          this.state = this.stopRequested ? "STOPPED" : "FAILED";
          this.emitSnapshot();
          return;
        }
        if (result.cleanup !== "CONFIRMED") {
          const diagnostic: ConversationDiagnostic = { code: "CLEANUP_NOT_CONFIRMED", completedTransmissions: result.relay.completedTransmissions, cleanup: "NOT_CONFIRMED" };
          this.lastDiagnostic = diagnostic;
          this.cleanup = "NOT_CONFIRMED";
          this.emit({ kind: "diagnostic", diagnostic });
          this.state = "FAILED";
          this.emitSnapshot();
          return;
        }
        this.cleanup = "CONFIRMED";
        for (const message of result.relay.messages) this.emit({ kind: "transmission", cycle: this.cycle, message });
        const nextPrompt = result.relay.messages[2];
        this.nextMission = nextPrompt.content;
        this.emit({ kind: "cycle_completed", cycle: this.cycle, cleanup: "CONFIRMED", nextPrompt: nextPrompt.content });
        this.emitSnapshot();
        if (nextPrompt.user_action_needed || nextPrompt.type === "USER_DECISION_REQUIRED") {
          this.state = "USER_DECISION_REQUIRED";
          this.emitSnapshot();
          return;
        }
        if (this.pauseRequested) {
          this.state = "PAUSED";
          this.emitSnapshot();
          return;
        }
      }
      if (this.stopRequested) this.state = "STOPPED";
      else if (this.cycle >= input.maxCycles) this.state = "COMPLETED";
      this.emitSnapshot();
    } finally {
      clearTimeout(globalTimer);
    }
  }

  private emit(event: ConversationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitSnapshot(): void {
    this.emit({ kind: "snapshot", snapshot: this.snapshot() });
  }
}
