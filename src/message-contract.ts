import { randomUUID } from "node:crypto";

export const MESSAGE_VERSION = "1.0" as const;
export const MAX_MESSAGE_BYTES = 65_536;
export const MAX_CONTENT_BYTES = 32_768;

export const MESSAGE_ROLES = ["WORK_LOCAL", "CODEX_LOCAL", "USER"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_TYPES = [
  "MISSION",
  "REPORT",
  "NEXT_PROMPT",
  "USER_DECISION_REQUIRED",
  "ERROR",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const DELIVERY_STATUSES = [
  "CREATED",
  "SENT",
  "RECEIVED",
  "PROCESSED",
  "FAILED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface MessageEnvelope {
  version: typeof MESSAGE_VERSION;
  session_id: string;
  message_id: string;
  correlation_id: string;
  sequence: number;
  sender: MessageRole;
  recipient: MessageRole;
  type: MessageType;
  phase: string;
  point: string;
  content: string;
  created_at: string;
  delivery_status: DeliveryStatus;
  user_action_needed: boolean;
}

export class MessageContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "MessageContractError";
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MESSAGE_KEYS = [
  "version",
  "session_id",
  "message_id",
  "correlation_id",
  "sequence",
  "sender",
  "recipient",
  "type",
  "phase",
  "point",
  "content",
  "created_at",
  "delivery_status",
  "user_action_needed",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) {
    throw new MessageContractError(code);
  }
}

function assertEnum<T extends readonly string[]>(value: unknown, values: T, code: string): asserts value is T[number] {
  assert(typeof value === "string" && values.includes(value), code);
}

function assertUuid(value: unknown, code: string): asserts value is string {
  assert(typeof value === "string" && UUID_PATTERN.test(value), code);
}

function assertRoleCoherence(message: MessageEnvelope): void {
  const expected: Record<MessageType, readonly [MessageRole, MessageRole][]> = {
    MISSION: [["WORK_LOCAL", "CODEX_LOCAL"]],
    REPORT: [["CODEX_LOCAL", "WORK_LOCAL"]],
    NEXT_PROMPT: [["WORK_LOCAL", "CODEX_LOCAL"]],
    USER_DECISION_REQUIRED: [
      ["WORK_LOCAL", "USER"],
      ["CODEX_LOCAL", "USER"],
    ],
    ERROR: [
      ["WORK_LOCAL", "CODEX_LOCAL"],
      ["CODEX_LOCAL", "WORK_LOCAL"],
      ["WORK_LOCAL", "USER"],
      ["CODEX_LOCAL", "USER"],
    ],
  };
  assert(
    expected[message.type].some(([sender, recipient]) => sender === message.sender && recipient === message.recipient),
    "ROLE_TYPE_MISMATCH",
  );
}

export function validateMessage(value: unknown): MessageEnvelope {
  assert(isRecord(value), "ROOT_NOT_OBJECT");
  const keys = Object.keys(value);
  assert(keys.length === MESSAGE_KEYS.length && keys.every((key) => MESSAGE_KEYS.includes(key as (typeof MESSAGE_KEYS)[number])), "UNKNOWN_OR_MISSING_KEY");
  for (const key of MESSAGE_KEYS) {
    assert(Object.prototype.hasOwnProperty.call(value, key), "UNKNOWN_OR_MISSING_KEY");
  }

  assert(value.version === MESSAGE_VERSION, "UNSUPPORTED_VERSION");
  assertUuid(value.session_id, "INVALID_SESSION_ID");
  assertUuid(value.message_id, "INVALID_MESSAGE_ID");
  assertUuid(value.correlation_id, "INVALID_CORRELATION_ID");
  assert(typeof value.sequence === "number" && Number.isInteger(value.sequence) && value.sequence > 0, "INVALID_SEQUENCE");
  assertEnum(value.sender, MESSAGE_ROLES, "INVALID_SENDER");
  assertEnum(value.recipient, MESSAGE_ROLES, "INVALID_RECIPIENT");
  assertEnum(value.type, MESSAGE_TYPES, "INVALID_TYPE");
  assert(typeof value.phase === "string" && value.phase.trim().length > 0, "INVALID_PHASE");
  assert(typeof value.point === "string" && value.point.trim().length > 0, "INVALID_POINT");
  assert(typeof value.content === "string" && value.content.trim().length > 0, "EMPTY_CONTENT");
  assert(Buffer.byteLength(value.content, "utf8") <= MAX_CONTENT_BYTES, "CONTENT_TOO_LARGE");
  assert(typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)), "INVALID_DATE");
  assertEnum(value.delivery_status, DELIVERY_STATUSES, "INVALID_DELIVERY_STATUS");
  assert(typeof value.user_action_needed === "boolean", "INVALID_USER_ACTION_FLAG");

  const message = value as unknown as MessageEnvelope;
  assertRoleCoherence(message);
  assert(Buffer.byteLength(JSON.stringify(message), "utf8") <= MAX_MESSAGE_BYTES, "MESSAGE_TOO_LARGE");
  return message;
}

export function parseMessageText(text: string): MessageEnvelope {
  assert(Buffer.byteLength(text, "utf8") <= MAX_MESSAGE_BYTES, "MESSAGE_TOO_LARGE");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MessageContractError("INVALID_MESSAGE_JSON");
  }
  return validateMessage(value);
}

export function createMessage(
  input: Omit<MessageEnvelope, "version" | "message_id" | "created_at" | "delivery_status"> &
    Partial<Pick<MessageEnvelope, "message_id" | "created_at" | "delivery_status">>,
): MessageEnvelope {
  const message: MessageEnvelope = {
    version: MESSAGE_VERSION,
    message_id: input.message_id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    delivery_status: input.delivery_status ?? "CREATED",
    session_id: input.session_id,
    correlation_id: input.correlation_id,
    sequence: input.sequence,
    sender: input.sender,
    recipient: input.recipient,
    type: input.type,
    phase: input.phase,
    point: input.point,
    content: input.content,
    user_action_needed: input.user_action_needed,
  };
  return validateMessage(message);
}

export class MessageLedger {
  private readonly messageIds = new Set<string>();
  private lastSequence = 0;

  accept(message: MessageEnvelope): MessageEnvelope {
    validateMessage(message);
    assert(!this.messageIds.has(message.message_id), "DUPLICATE_MESSAGE");
    assert(message.sequence === this.lastSequence + 1, "OUT_OF_ORDER_MESSAGE");
    this.messageIds.add(message.message_id);
    this.lastSequence = message.sequence;
    return message;
  }
}

export const MESSAGE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...MESSAGE_KEYS],
  properties: {
    version: { type: "string", enum: [MESSAGE_VERSION] },
    session_id: { type: "string" },
    message_id: { type: "string" },
    correlation_id: { type: "string" },
    sequence: { type: "integer", minimum: 1 },
    sender: { enum: [...MESSAGE_ROLES] },
    recipient: { enum: [...MESSAGE_ROLES] },
    type: { enum: [...MESSAGE_TYPES] },
    phase: { type: "string" },
    point: { type: "string" },
    content: { type: "string" },
    created_at: { type: "string" },
    delivery_status: { enum: [...DELIVERY_STATUSES] },
    user_action_needed: { type: "boolean" },
  },
} as const;
