import { randomUUID } from "node:crypto";
import { AppServerClient, type AppServerCloseResult } from "../app-server-client.js";
import { createMessageOutputSchema, parseMessageText, type MessageEnvelope, type MessageRole, type MessageType } from "../message-contract.js";
import { resolveBundledCodexRuntime } from "../codex-sdk-relay.js";

export type DialogueSpeaker = "WORK" | "CODEX";
export type DialogueState = "IDLE" | "RUNNING" | "PAUSE_REQUESTED" | "PAUSED" | "STOPPING" | "COMPLETED" | "FAILED";

export interface DualDialogueInput {
  workThreadId: string;
  codexThreadId: string;
  projectRoot: string;
  phase: string;
  point: string;
  objective: string;
  firstSpeaker: DialogueSpeaker;
  maxCycles: number;
  cycleTimeoutMs: number;
}

export interface DualDialogueClient {
  initialize(): Promise<void>;
  resumeThread(threadId: string): Promise<{ id: string }>;
  runTurn(threadId: string, prompt: string, outputSchema: unknown, signal?: AbortSignal): Promise<string>;
  close(): Promise<AppServerCloseResult>;
}

export type DualDialogueEvent =
  | { kind: "state"; state: DialogueState; cycle: number }
  | { kind: "message"; cycle: number; message: MessageEnvelope }
  | { kind: "error"; code: string; cycle: number };

export interface DualDialogueSnapshot { state: DialogueState; cycle: number; maxCycles: number; }

export interface DualDialogueResult {
  state: "COMPLETED" | "PAUSED" | "STOPPING" | "FAILED";
  cycles: number;
  messages: MessageEnvelope[];
  cleanup: "CONFIRMED" | "NOT_CONFIRMED";
  createdConversation: false;
}

export interface DualDialogueDependencies {
  createClient(): Promise<DualDialogueClient>;
  randomUUID(): string;
}

const DEFAULT_DEPENDENCIES: DualDialogueDependencies = {
  createClient: async () => {
    const runtime = await resolveBundledCodexRuntime();
    return AppServerClient.spawn({ requestMs: 30_000, turnMs: 600_000, cleanupMs: 5_000 }, runtime);
  },
  randomUUID,
};

function role(speaker: DialogueSpeaker): MessageRole { return speaker === "WORK" ? "WORK_LOCAL" : "CODEX_LOCAL"; }
function opposite(speaker: DialogueSpeaker): DialogueSpeaker { return speaker === "WORK" ? "CODEX" : "WORK"; }
function typeFor(speaker: DialogueSpeaker, first: boolean): MessageType { return speaker === "CODEX" ? "REPORT" : first ? "MISSION" : "NEXT_PROMPT"; }
function promptFor(target: DialogueSpeaker, previous: string, objective: string): string {
  const objectiveText = objective.trim().length === 0 ? "Continue naturally from your existing conversation context." : `Initial objective: ${objective}`;
  return `You are the ${target} conversation in a supervised two-conversation dialogue. ${objectiveText}\nRead the incoming message below, answer it using your existing context, and return exactly one JSON envelope matching the supplied output schema. Do not modify files, request broader permissions, or mention internal identifiers. Incoming message: ${previous}`;
}

export class DualConversationDialogue {
  private readonly listeners = new Set<(event: DualDialogueEvent) => void>();
  private state: DialogueState = "IDLE";
  private cycle = 0;
  private pauseRequested = false;
  private stopRequested = false;
  private activeRun: Promise<DualDialogueResult> | undefined;
  private controller: AbortController | undefined;

  constructor(private readonly input: DualDialogueInput, private readonly dependencies: DualDialogueDependencies = DEFAULT_DEPENDENCIES) {
    if (input.workThreadId === input.codexThreadId) throw new Error("CONVERSATION_DUPLICATE");
    if (!Number.isInteger(input.maxCycles) || input.maxCycles < 1 || input.maxCycles > 10) throw new Error("MAX_CYCLES_INVALID");
  }

  subscribe(listener: (event: DualDialogueEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot(): DualDialogueSnapshot { return { state: this.state, cycle: this.cycle, maxCycles: this.input.maxCycles }; }

  async start(): Promise<DualDialogueResult> {
    if (this.activeRun !== undefined || !["IDLE", "PAUSED"].includes(this.state)) throw new Error("DIALOGUE_START_INVALID");
    this.pauseRequested = false;
    this.stopRequested = false;
    this.controller = new AbortController();
    this.activeRun = this.run(this.controller.signal).finally(() => { this.activeRun = undefined; this.controller = undefined; });
    return this.activeRun;
  }

  requestPause(): void { if (this.state !== "RUNNING") throw new Error("DIALOGUE_PAUSE_INVALID"); this.pauseRequested = true; this.state = "PAUSE_REQUESTED"; this.emit({ kind: "state", state: this.state, cycle: this.cycle }); }
  async resume(): Promise<DualDialogueResult> { if (this.state !== "PAUSED") throw new Error("DIALOGUE_RESUME_INVALID"); return this.start(); }
  async stop(): Promise<void> { this.stopRequested = true; this.state = "STOPPING"; this.controller?.abort(); if (this.activeRun) await this.activeRun; }

  private emit(event: DualDialogueEvent): void { for (const listener of this.listeners) listener(event); }

  private async run(signal: AbortSignal): Promise<DualDialogueResult> {
    const messages: MessageEnvelope[] = [];
    const sessionId = this.dependencies.randomUUID();
    let client: DualDialogueClient | undefined;
    let result: DualDialogueResult = { state: "FAILED", cycles: 0, messages, cleanup: "NOT_CONFIRMED", createdConversation: false };
    try {
      client = await this.dependencies.createClient();
      await client.initialize();
      await client.resumeThread(this.input.workThreadId);
      await client.resumeThread(this.input.codexThreadId);
      let speaker = this.input.firstSpeaker;
      let previous = this.input.objective.trim().length === 0 ? "Continue from the current supervised conversation context." : this.input.objective;
      let correlationId = sessionId;
      let sequence = 0;
      let paused = false;
      for (this.cycle = 1; this.cycle <= this.input.maxCycles && !this.stopRequested; this.cycle += 1) {
        this.state = "RUNNING";
        this.emit({ kind: "state", state: this.state, cycle: this.cycle });
        const turns = this.cycle === 1 ? 3 : 2;
        const cycleController = new AbortController();
        const forwardAbort = () => cycleController.abort();
        const cycleTimer = setTimeout(() => cycleController.abort(), this.input.cycleTimeoutMs);
        signal.addEventListener("abort", forwardAbort, { once: true });
        try {
          for (let turn = 0; turn < turns && !this.stopRequested; turn += 1) {
            const target = opposite(speaker);
            sequence += 1;
            const expected = { sessionId, sequence, sender: role(speaker), recipient: role(target), type: typeFor(speaker, sequence === 1), correlationId, phase: this.input.phase, point: this.input.point, userActionNeeded: false } as const;
            const raw = await client.runTurn(speaker === "WORK" ? this.input.workThreadId : this.input.codexThreadId, promptFor(speaker, previous, this.input.objective), createMessageOutputSchema(expected), cycleController.signal);
            const message = parseMessageText(raw);
            if (message.session_id !== sessionId || message.sequence !== sequence || message.sender !== expected.sender || message.recipient !== expected.recipient || message.type !== expected.type || message.correlation_id !== correlationId || message.phase !== expected.phase || message.point !== expected.point) throw new Error("DIALOGUE_ROUTE_INVALID");
            messages.push(message);
            this.emit({ kind: "message", cycle: this.cycle, message });
            previous = message.content;
            correlationId = message.message_id;
            speaker = target;
            if (this.pauseRequested) { paused = true; break; }
          }
        } finally {
          clearTimeout(cycleTimer);
          signal.removeEventListener("abort", forwardAbort);
        }
        if (paused) break;
      }
      if (paused) {
        this.state = "PAUSED";
        this.emit({ kind: "state", state: this.state, cycle: this.cycle });
        result = { state: "PAUSED", cycles: this.cycle, messages, cleanup: "NOT_CONFIRMED", createdConversation: false };
      } else {
        this.state = this.stopRequested ? "STOPPING" : "COMPLETED";
        this.emit({ kind: "state", state: this.state, cycle: Math.min(this.cycle, this.input.maxCycles) });
        result = { state: this.state, cycles: Math.min(this.cycle, this.input.maxCycles), messages, cleanup: "NOT_CONFIRMED", createdConversation: false };
      }
    } catch (error) {
      this.state = this.stopRequested ? "STOPPING" : "FAILED";
      this.emit({ kind: "error", code: error instanceof Error ? error.message : "DIALOGUE_FAILED", cycle: this.cycle });
      result = { state: this.state, cycles: Math.min(this.cycle, this.input.maxCycles), messages, cleanup: "NOT_CONFIRMED", createdConversation: false };
    } finally {
      if (client !== undefined) {
        const closed = await client.close().catch(() => ({ exited: false, forced: true }));
        result = { ...result, cleanup: closed.exited && !closed.forced ? "CONFIRMED" : "NOT_CONFIRMED" };
      }
    }
    return result;
  }
}
