import type {
  EmailLookup,
  EmailRequest,
  EmailSender,
  EmailSendResult,
} from "@off-r39x/application";
import type { LogEvent } from "@off-r39x/observability";
import { TIMEOUTS, withDeadline } from "@off-r39x/reliability";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Logger = { log(event: LogEvent): void };
const endpoint = "https://api.resend.com/emails";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const mailbox = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const messageId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function snapshotBody(input: unknown): { key: string; body: string } | null {
  if (!isRecord(input) || Object.keys(input).some((key) => !["key", "payload"].includes(key)))
    return null;
  const { key, payload } = input;
  if (typeof key !== "string" || !key || key.length > 256 || /[^\x21-\x7e]/.test(key)) return null;
  if (
    !isRecord(payload) ||
    Object.keys(payload).some(
      (field) => !["from", "to", "subject", "text", "html", "replyTo"].includes(field),
    )
  )
    return null;
  if (
    !mailbox(payload.from) ||
    !mailbox(payload.to) ||
    (payload.replyTo !== undefined && !mailbox(payload.replyTo))
  )
    return null;
  if (
    typeof payload.subject !== "string" ||
    !payload.subject.trim() ||
    /[\r\n]/.test(payload.subject) ||
    typeof payload.text !== "string" ||
    !payload.text.trim()
  )
    return null;
  if (payload.html !== undefined && typeof payload.html !== "string") return null;
  return {
    key,
    body: JSON.stringify({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      ...(payload.html === undefined ? {} : { html: payload.html }),
      ...(payload.replyTo === undefined ? {} : { reply_to: payload.replyTo }),
    }),
  };
}
function snapshot(input: unknown): { key: string; body: string } | null {
  try {
    return snapshotBody(input);
  } catch {
    return null;
  }
}
function recordFailure(
  logger: Logger | undefined,
  kind: "UNKNOWN_RESULT" | "TEMPORARY_FAILURE" | "BLOCKED",
) {
  logger?.log({
    event_name:
      kind === "UNKNOWN_RESULT"
        ? "reliability.unknown_result.opened"
        : "email.delivery.provider_call",
    level: "WARN",
    result: kind === "UNKNOWN_RESULT" ? "PENDING" : "FAILED",
    is_retry: false,
    provider: "RESEND",
    failure_class: kind === "BLOCKED" ? "PERMANENT_FAILURE" : kind,
  });
}
async function request(
  transport: Transport,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  return withDeadline(async (signal) => {
    const response = await transport(url, { ...init, signal });
    const data: unknown = await response.json().catch(() => null);
    return { response, body: isRecord(data) ? data : {} };
  }, TIMEOUTS.resendMs);
}
/** One POST per call, including explicit recovery. Caller must persist the immutable
 * same-attempt key+payload and enforce the provider retention window externally.
 * No process-memory cache is authority; no new key, retry loop or fictional GET probe. */
export function createResendSender(
  apiKey: string,
  transport: Transport = fetch,
  logger?: Logger,
): EmailSender {
  return {
    async send(input: EmailRequest): Promise<EmailSendResult> {
      let result: EmailSendResult;
      try {
        const immutable = snapshot(input);
        if (!immutable) result = { kind: "BLOCKED" };
        else {
          const { response, body } = await request(transport, endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": immutable.key,
            },
            body: immutable.body,
          });
          if (response.ok && messageId(body.id)) result = { kind: "ACCEPTED", messageId: body.id };
          else if (response.status === 429) result = { kind: "TEMPORARY_FAILURE" };
          else if (
            response.status >= 500 ||
            (response.status === 409 && body.name !== "invalid_idempotent_request") ||
            response.ok
          )
            result = { kind: "UNKNOWN_RESULT" };
          else result = { kind: "BLOCKED" };
        }
      } catch {
        result = { kind: "UNKNOWN_RESULT" };
      }
      if (result.kind !== "ACCEPTED") recordFailure(logger, result.kind);
      return result;
    },
  };
}
/** Read capability cannot send or recover an unknown send. */
export function createResendLookup(
  apiKey: string,
  transport: Transport = fetch,
  logger?: Logger,
): EmailLookup {
  return {
    async lookup(id) {
      if (!messageId(id)) return { kind: "BLOCKED" };
      try {
        const { response, body } = await request(
          transport,
          `${endpoint}/${encodeURIComponent(id)}`,
          { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (
          response.ok &&
          body.id === id &&
          typeof body.last_event === "string" &&
          /^[a-z_]{1,64}$/.test(body.last_event)
        )
          return { kind: "FOUND", messageId: id, status: body.last_event };
        const kind =
          response.status >= 500 || response.status === 429 || response.ok
            ? "TEMPORARY_FAILURE"
            : "BLOCKED";
        recordFailure(logger, kind);
        return { kind };
      } catch {
        recordFailure(logger, "TEMPORARY_FAILURE");
        return { kind: "TEMPORARY_FAILURE" };
      }
    },
  };
}
