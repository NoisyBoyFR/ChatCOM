import { randomUUID } from "node:crypto";
import { AppServerClientError, type SafeTurnDiagnostic } from "./app-server-client.js";
import { createMessage, createMessageOutputSchema, MAX_ROUTE_BYTES, MessageContractError, MessageLedger, MESSAGE_OUTPUT_SCHEMA, parseMessageText, type MessageEnvelope } from "./message-contract.js";

export const DEFAULT_WORK_LOCAL_INSTRUCTIONS = "You are WORK_LOCAL, a local review role distinct from the current user conversation. Do not change files, act as the user, or invent user decisions. Return exactly one JSON message envelope and no markdown.";
export const DEFAULT_CODEX_LOCAL_INSTRUCTIONS = "You are CODEX_LOCAL, a local technical role. Stay read-only, do not change files, and do not invent user authority. Return exactly one JSON message envelope and no markdown.";

const MAX_MISSION_BYTES = 16_384;
const MAX_INSTRUCTIONS_BYTES = 16_384;

export interface LocalRelayRequest {
  cwd: string;
  phase: string;
  point: string;
  mission: string;
  sessionId?: string;
  workInstructions?: string;
  codexInstructions?: string;
}

export interface RelayAgent {
  startThread(instructions: string, cwd: string): Promise<string>;
  runTurn(threadId: string, prompt: string, outputSchema?: unknown, signal?: AbortSignal): Promise<string>;
  deleteThread(threadId: string): Promise<void>;
}

export interface LocalRelayRunOptions {
  signal?: AbortSignal;
}

export interface RelayResult {
  sessionId: string;
  threadIds: string[];
  deletedThreadIds: string[];
  messages: readonly [MessageEnvelope, MessageEnvelope, MessageEnvelope];
  messageIds: string[];
  sequence: number[];
  transmissions: number;
  completedTransmissions: number;
  stoppedBeforeSecondCodexMission: boolean;
  cleanupFailures: string[];
  cleanupErrors: string[];
}

export class RelayFailure extends Error {
  readonly code: string;
  readonly cleanupFailures: string[];
  readonly cleanupErrors: string[];
  readonly threadIds: string[];
  readonly deletedThreadIds: string[];
  readonly primaryDiagnostic?: SafeTurnDiagnostic;
  readonly relayStage?: RelayStage;
  readonly completedTransmissions: number;

  constructor(code: string, cleanupFailures: string[] = [], threadIds: string[] = [], deletedThreadIds: string[] = [], cleanupErrors: string[] = [], primaryDiagnostic?: SafeTurnDiagnostic, relayStage?: RelayStage, completedTransmissions = 0) {
    super(code);
    this.name = "RelayFailure";
    this.code = code;
    this.cleanupFailures = cleanupFailures;
    this.cleanupErrors = cleanupErrors;
    this.threadIds = threadIds;
    this.deletedThreadIds = deletedThreadIds;
    this.primaryDiagnostic = primaryDiagnostic;
    this.relayStage = relayStage;
    this.completedTransmissions = completedTransmissions;
  }
}

export type RelayStage = "WORK_MISSION" | "CODEX_REPORT" | "WORK_NEXT_PROMPT";

type ValidatedRelayRequest = Required<Pick<LocalRelayRequest, "cwd" | "phase" | "point" | "mission" | "workInstructions" | "codexInstructions">> & { sessionId: string };

function boundedText(value: unknown, code: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new RelayFailure(code);
  }
  return value;
}

export function validateLocalRelayRequest(request: LocalRelayRequest): ValidatedRelayRequest {
  const sessionId = request.sessionId ?? randomUUID();
  createMessage({
    session_id: sessionId,
    correlation_id: sessionId,
    sequence: 1,
    sender: "WORK_LOCAL",
    recipient: "CODEX_LOCAL",
    type: "MISSION",
    phase: boundedText(request.phase, "INVALID_RELAY_PHASE", MAX_ROUTE_BYTES),
    point: boundedText(request.point, "INVALID_RELAY_POINT", MAX_ROUTE_BYTES),
    content: boundedText(request.mission, "INVALID_RELAY_MISSION", MAX_MISSION_BYTES),
    user_action_needed: false,
  });
  return {
    cwd: boundedText(request.cwd, "INVALID_RELAY_CWD", 4_096),
    phase: request.phase,
    point: request.point,
    mission: request.mission,
    sessionId,
    workInstructions: boundedText(request.workInstructions ?? DEFAULT_WORK_LOCAL_INSTRUCTIONS, "INVALID_WORK_INSTRUCTIONS", MAX_INSTRUCTIONS_BYTES),
    codexInstructions: boundedText(request.codexInstructions ?? DEFAULT_CODEX_LOCAL_INSTRUCTIONS, "INVALID_CODEX_INSTRUCTIONS", MAX_INSTRUCTIONS_BYTES),
  };
}

function promptForWorkMission(request: ValidatedRelayRequest): string {
  return `Create the first mission for this relay configuration. Mission intent: ${JSON.stringify(request.mission)}. Return a valid JSON envelope with version 1.0, session_id ${request.sessionId}, sequence 1, sender WORK_LOCAL, recipient CODEX_LOCAL, type MISSION, phase ${JSON.stringify(request.phase)}, point ${JSON.stringify(request.point)}, concise non-sensitive content, delivery_status CREATED, user_action_needed false, correlation_id ${request.sessionId}, and a fresh UUID message_id. Return JSON only.`;
}

function promptForCodexReport(mission: MessageEnvelope): string {
  return `Review this automatically transmitted mission without changing the project: ${JSON.stringify(mission)}. Return a valid JSON envelope with session_id ${mission.session_id}, sequence 2, sender CODEX_LOCAL, recipient WORK_LOCAL, type REPORT, correlation_id ${mission.message_id}, phase ${JSON.stringify(mission.phase)}, point ${JSON.stringify(mission.point)}, concise non-sensitive content, delivery_status CREATED, user_action_needed false, and a fresh UUID message_id. Return JSON only.`;
}

function promptForWorkNextPrompt(report: MessageEnvelope): string {
  return `Analyze this automatically transmitted technical report: ${JSON.stringify(report)}. Return a valid JSON envelope with session_id ${report.session_id}, sequence 3, sender WORK_LOCAL, recipient CODEX_LOCAL, type NEXT_PROMPT, correlation_id ${report.message_id}, phase ${JSON.stringify(report.phase)}, point ${JSON.stringify(report.point)}, concise non-sensitive content, delivery_status CREATED, user_action_needed false, and a fresh UUID message_id. This prompt must stop for user authority when a product decision, side effect, or permission is required. Return JSON only.`;
}

function assertExpected(message: MessageEnvelope, expected: { sessionId: string; sequence: number; sender: MessageEnvelope["sender"]; recipient: MessageEnvelope["recipient"]; type: MessageEnvelope["type"]; correlationId: string; phase: string; point: string }): void {
  if (message.session_id !== expected.sessionId || message.sequence !== expected.sequence || message.sender !== expected.sender || message.recipient !== expected.recipient || message.type !== expected.type || message.correlation_id !== expected.correlationId || message.phase !== expected.phase || message.point !== expected.point) {
    throw new RelayFailure("UNEXPECTED_MESSAGE_ROUTE");
  }
}

export async function runLocalRelay(agent: RelayAgent, relayRequest: LocalRelayRequest, options: LocalRelayRunOptions = {}): Promise<RelayResult> {
  const request = validateLocalRelayRequest(relayRequest);
  const signal = options.signal;
  if (signal?.aborted) throw new RelayFailure("RELAY_CANCELLED");
  const { cwd, sessionId } = request;
  const ledger = new MessageLedger();
  let workThreadId: string | undefined;
  let codexThreadId: string | undefined;
  const deleted: string[] = [];
  const cleanupFailures: string[] = [];
  const cleanupErrors: string[] = [];
  let failure: RelayFailure | undefined;
  let result: RelayResult | undefined;
  let relayStage: RelayStage | undefined;
  let completedTransmissions = 0;

  const executeTransmission = async (stage: RelayStage, threadId: string, prompt: string, failureCode: string, outputSchema: unknown): Promise<MessageEnvelope> => {
    relayStage = stage;
    try {
      if (signal?.aborted) throw new RelayFailure("RELAY_CANCELLED", [], [], [], [], undefined, stage, completedTransmissions);
      const message = parseMessageText(await agent.runTurn(threadId, prompt, outputSchema, signal));
      completedTransmissions += 1;
      return message;
    } catch (error) {
      throw new RelayFailure(error instanceof RelayFailure || error instanceof MessageContractError || error instanceof AppServerClientError ? error.code : failureCode, [], [], [], [], error instanceof AppServerClientError ? error.diagnostic : undefined, stage, completedTransmissions);
    }
  };

  try {
    if (signal?.aborted) throw new RelayFailure("RELAY_CANCELLED");
    workThreadId = await agent.startThread(request.workInstructions, cwd);
    codexThreadId = await agent.startThread(request.codexInstructions, cwd);

    const mission = await executeTransmission(
      "WORK_MISSION",
      workThreadId,
      promptForWorkMission(request),
      "WORK_MISSION_FAILED",
      createMessageOutputSchema({
        sessionId,
        sequence: 1,
        sender: "WORK_LOCAL",
        recipient: "CODEX_LOCAL",
        type: "MISSION",
        correlationId: sessionId,
        phase: request.phase,
        point: request.point,
      }),
    );
    assertExpected(mission, { sessionId, sequence: 1, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "MISSION", correlationId: sessionId, phase: request.phase, point: request.point });
    ledger.accept(mission);

    const report = await executeTransmission(
      "CODEX_REPORT",
      codexThreadId,
      promptForCodexReport(mission),
      "CODEX_REPORT_FAILED",
      createMessageOutputSchema({
        sessionId,
        sequence: 2,
        sender: "CODEX_LOCAL",
        recipient: "WORK_LOCAL",
        type: "REPORT",
        correlationId: mission.message_id,
        phase: request.phase,
        point: request.point,
      }),
    );
    assertExpected(report, { sessionId, sequence: 2, sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", type: "REPORT", correlationId: mission.message_id, phase: request.phase, point: request.point });
    ledger.accept(report);

    const nextPrompt = await executeTransmission(
      "WORK_NEXT_PROMPT",
      workThreadId,
      promptForWorkNextPrompt(report),
      "WORK_NEXT_PROMPT_FAILED",
      createMessageOutputSchema({
        sessionId,
        sequence: 3,
        sender: "WORK_LOCAL",
        recipient: "CODEX_LOCAL",
        type: "NEXT_PROMPT",
        correlationId: report.message_id,
        phase: request.phase,
        point: request.point,
      }),
    );
    assertExpected(nextPrompt, { sessionId, sequence: 3, sender: "WORK_LOCAL", recipient: "CODEX_LOCAL", type: "NEXT_PROMPT", correlationId: report.message_id, phase: request.phase, point: request.point });
    ledger.accept(nextPrompt);
    if (nextPrompt.type === "USER_DECISION_REQUIRED" || nextPrompt.user_action_needed) throw new RelayFailure("USER_DECISION_REQUIRED");

    result = {
      sessionId,
      threadIds: [workThreadId, codexThreadId],
      deletedThreadIds: [],
      messages: [mission, report, nextPrompt],
      messageIds: [mission.message_id, report.message_id, nextPrompt.message_id],
      sequence: [mission.sequence, report.sequence, nextPrompt.sequence],
      transmissions: 3,
      completedTransmissions,
      stoppedBeforeSecondCodexMission: true,
      cleanupFailures,
      cleanupErrors,
    };
  } catch (error) {
    failure = error instanceof RelayFailure ? error : new RelayFailure("RELAY_FAILED");
  } finally {
    for (const threadId of [codexThreadId, workThreadId]) {
      if (!threadId) continue;
      try { await agent.deleteThread(threadId); deleted.push(threadId); }
      catch (error) {
        cleanupFailures.push(threadId);
        cleanupErrors.push(error instanceof AppServerClientError ? error.code : "THREAD_DELETE_FAILED");
      }
    }
  }

  if (failure) throw new RelayFailure(failure.code, cleanupFailures, [workThreadId, codexThreadId].filter((id): id is string => typeof id === "string"), deleted, cleanupErrors, failure.primaryDiagnostic, failure.relayStage ?? relayStage, failure.completedTransmissions || completedTransmissions);
  if (cleanupFailures.length > 0) throw new RelayFailure("CLEANUP_FAILED", cleanupFailures, [workThreadId, codexThreadId].filter((id): id is string => typeof id === "string"), deleted, cleanupErrors, undefined, relayStage, completedTransmissions);
  if (!result) throw new RelayFailure("NO_RESULT", cleanupFailures, [workThreadId, codexThreadId].filter((id): id is string => typeof id === "string"), deleted, cleanupErrors, undefined, relayStage, completedTransmissions);
  result.cleanupFailures = cleanupFailures;
  result.cleanupErrors = cleanupErrors;
  result.deletedThreadIds = deleted;
  return result;
}

export function createMessageForTests(
  input: Omit<MessageEnvelope, "version" | "message_id" | "created_at" | "delivery_status"> &
    Partial<Pick<MessageEnvelope, "message_id" | "created_at" | "delivery_status">>,
): MessageEnvelope {
  return createMessage(input);
}

export { MESSAGE_OUTPUT_SCHEMA };
