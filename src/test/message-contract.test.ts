import assert from "node:assert/strict";
import { test } from "node:test";
import { createMessage, createMessageOutputSchema, MAX_CONTENT_BYTES, MAX_ROUTE_BYTES, MESSAGE_DATE_PATTERN, MessageContractError, MessageLedger, MESSAGE_OUTPUT_SCHEMA, parseMessageText, validateMessage, validateRelayMessages, type MessageEnvelope } from "../message-contract.js";

const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function envelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return createMessage({
    session_id: UUIDS[0],
    correlation_id: UUIDS[0],
    sequence: 1,
    sender: "WORK_LOCAL",
    recipient: "CODEX_LOCAL",
    type: "MISSION",
    phase: "CHATCOM-TEST",
    point: "RELAY-1",
    content: "synthetic",
    user_action_needed: false,
    message_id: UUIDS[1],
    created_at: "2026-08-18T12:00:00.000Z",
    ...overrides,
  });
}

test("accepts the strict version 1.0 envelope", () => {
  assert.equal(validateMessage(envelope()).version, "1.0");
  assert.equal(parseMessageText(JSON.stringify(envelope())).message_id, UUIDS[1]);
});

test("uses a singleton enum for the structured output version", () => {
  const versionSchema = MESSAGE_OUTPUT_SCHEMA.properties.version;
  assert.deepEqual(versionSchema.enum, ["1.0"]);
  assert.equal("const" in versionSchema, false);
});

test("creates exact route schemas with independent session and correlation constants", () => {
  const schema = createMessageOutputSchema({
    sessionId: UUIDS[0],
    sequence: 2,
    sender: "CODEX_LOCAL",
    recipient: "WORK_LOCAL",
    type: "REPORT",
    correlationId: UUIDS[1],
    phase: "PHASE-B",
    point: "POINT-2",
  });
  const properties = schema.properties;
  assert.equal(properties.version.const, "1.0");
  assert.equal(properties.session_id.const, UUIDS[0]);
  assert.equal(properties.sequence.const, 2);
  assert.equal(properties.sender.const, "CODEX_LOCAL");
  assert.equal(properties.recipient.const, "WORK_LOCAL");
  assert.equal(properties.type.const, "REPORT");
  assert.equal(properties.correlation_id.const, UUIDS[1]);
  assert.equal(properties.phase.const, "PHASE-B");
  assert.equal(properties.point.const, "POINT-2");
  assert.equal(properties.delivery_status.const, "CREATED");
  assert.equal(properties.user_action_needed.const, false);
  assert.equal(properties.message_id.pattern, MESSAGE_OUTPUT_SCHEMA.properties.message_id.pattern);
  assert.equal(schema.additionalProperties, false);
});

test("rejects unknown and missing keys", () => {
  const value = { ...envelope(), extra: true };
  assert.throws(() => validateMessage(value), (error) => error instanceof MessageContractError && error.code === "UNKNOWN_OR_MISSING_KEY");
  const { content: _content, ...missing } = envelope();
  assert.throws(() => validateMessage(missing), (error) => error instanceof MessageContractError && error.code === "UNKNOWN_OR_MISSING_KEY");
});

test("rejects malformed identifiers and dates", () => {
  assert.throws(() => validateMessage(envelope({ session_id: "not-a-uuid" })), /INVALID_SESSION_ID/);
  assert.throws(() => validateMessage(envelope({ created_at: "not-a-date" })), /INVALID_DATE/);
});

test("rejects empty and oversized content", () => {
  assert.throws(() => validateMessage(envelope({ content: "  " })), /EMPTY_CONTENT/);
  assert.equal(validateMessage(envelope({ content: "x".repeat(MAX_CONTENT_BYTES) })).content.length, MAX_CONTENT_BYTES);
  const multibyteAtLimit = "é".repeat(MAX_CONTENT_BYTES / 2);
  assert.equal(Buffer.byteLength(multibyteAtLimit, "utf8"), MAX_CONTENT_BYTES);
  assert.equal(validateMessage(envelope({ content: multibyteAtLimit })).content, multibyteAtLimit);
  assert.throws(() => validateMessage(envelope({ content: `${multibyteAtLimit}é` })), /CONTENT_TOO_LARGE/);
});

test("bounds route text by UTF-8 bytes", () => {
  const base = envelope();
  assert.doesNotThrow(() => validateMessage({ ...base, phase: "é".repeat(MAX_ROUTE_BYTES / 2) }));
  assert.throws(() => validateMessage({ ...base, point: "é".repeat(MAX_ROUTE_BYTES / 2 + 1) }), /POINT_TOO_LARGE/);
});

test("uses the canonical ISO instant date in both runtime and schema", () => {
  const canonical = "2026-08-18T12:00:00.000Z";
  assert.equal(MESSAGE_DATE_PATTERN.test(canonical), true);
  assert.equal(validateMessage(envelope({ created_at: canonical })).created_at, canonical);
  assert.throws(() => validateMessage(envelope({ created_at: "2026-08-18T12:00:00Z" })), /INVALID_DATE/);
  assert.equal((MESSAGE_OUTPUT_SCHEMA.properties.created_at as { pattern?: string }).pattern, MESSAGE_DATE_PATTERN.source);
});

test("validates the complete relay route before returning it", () => {
  const first = envelope();
  const report = envelope({ message_id: UUIDS[2], sequence: 2, type: "REPORT", sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", correlation_id: first.message_id });
  const next = envelope({ message_id: UUIDS[3], sequence: 3, type: "NEXT_PROMPT", correlation_id: report.message_id });
  assert.deepEqual(validateRelayMessages([first, report, next]), [first, report, next]);
  assert.throws(() => validateRelayMessages([first, next, report]), /INVALID_RELAY_ROUTE|OUT_OF_ORDER_MESSAGE/);
  assert.throws(() => validateRelayMessages([envelope({ correlation_id: UUIDS[2] }), report, next]), /INVALID_RELAY_ROUTE/);
});

test("rejects invalid sequence, enum and role combinations", () => {
  assert.throws(() => validateMessage(envelope({ sequence: 0 })), /INVALID_SEQUENCE/);
  assert.throws(() => validateMessage(envelope({ type: "REPORT" })), /ROLE_TYPE_MISMATCH/);
  assert.throws(() => validateMessage(envelope({ recipient: "USER" })), /ROLE_TYPE_MISMATCH/);
});

test("accepts a user decision message with the USER recipient", () => {
  const value = envelope({ type: "USER_DECISION_REQUIRED", recipient: "USER", user_action_needed: true });
  assert.equal(value.recipient, "USER");
});

test("enforces idempotency and sequence order", () => {
  const ledger = new MessageLedger();
  const first = envelope();
  const second = envelope({ message_id: UUIDS[2], sequence: 2, type: "REPORT", sender: "CODEX_LOCAL", recipient: "WORK_LOCAL", correlation_id: first.message_id });
  ledger.accept(first);
  assert.throws(() => ledger.accept(first), /DUPLICATE_MESSAGE/);
  assert.throws(() => ledger.accept(envelope({ message_id: UUIDS[3], sequence: 3 })), /OUT_OF_ORDER_MESSAGE/);
  assert.equal(ledger.accept(second).sequence, 2);
});

test("rejects invalid JSON text", () => {
  assert.throws(() => parseMessageText("not json"), /INVALID_MESSAGE_JSON/);
});
