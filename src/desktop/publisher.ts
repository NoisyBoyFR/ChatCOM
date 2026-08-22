declare const __CHATCOM_APPROVED_PUBLISHER_SUBJECT__: unknown;

const MAX_PUBLISHER_SUBJECT_LENGTH = 512;

export function normalizeApprovedPublisherSubject(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PUBLISHER_SUBJECT_LENGTH) return undefined;
  if (value !== value.trim() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n\t]/u.test(value)) return undefined;
  if (value === "UNKNOWN" || value === "UNAVAILABLE") return undefined;
  return value;
}

const embeddedSubject = typeof __CHATCOM_APPROVED_PUBLISHER_SUBJECT__ === "string"
  ? __CHATCOM_APPROVED_PUBLISHER_SUBJECT__
  : undefined;

export const APPROVED_PUBLISHER_SUBJECT = normalizeApprovedPublisherSubject(embeddedSubject) ?? "";
