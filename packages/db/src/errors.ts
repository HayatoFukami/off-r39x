import { type DatabaseRetryState, isDatabaseRetryable } from "@off-r39x/reliability";

export class TransactionDeadlineError extends Error {
  constructor() {
    super("Database transaction deadline exceeded");
  }
}

/**
 * The database could not be reached or a connection was lost, and the failure carried no SQLSTATE
 * (a Node errno such as ECONNRESET, or no code at all, for example a pool acquisition timeout). The
 * DB boundary types it so the API layer answers 503 without trusting a bare errno. The fixed message
 * never repeats the original error; that stays only in `cause` (REL-DB-009, SEC-ERR-003).
 */
export class DatabaseUnavailableError extends Error {
  constructor(options: { readonly cause: unknown }) {
    super("Database unavailable", { cause: options.cause });
    this.name = "DatabaseUnavailableError";
  }
}

export function sqlState(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/** A server SQLSTATE: five characters of `[0-9A-Z]`; `EPIPE` is a Node errno that happens to fit. */
export function isSqlstate(code: string | undefined): code is string {
  return code !== undefined && code !== "EPIPE" && /^[0-9A-Z]{5}$/.test(code);
}

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "57P01",
  "57P02",
  "57P03",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);
/**
 * Transaction-internal judgement: connection-class SQLSTATE (`08xxx`), server shutdown
 * (`57P01`-`57P03`) and Node connection errno. Not the API classification, which accepts only
 * typed errors and SQLSTATE (see `isUnavailableSqlstate`).
 */
export function isDatabaseUnavailableCode(code: string): boolean {
  return code.startsWith("08") || UNAVAILABLE_CODES.has(code);
}

function isUnavailableSqlstate(code: string): boolean {
  return (
    isSqlstate(code) &&
    (code.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03")
  );
}

export type ConstraintSqlstate = "23505" | "23P01" | "23503" | "23514";
const CONSTRAINT_CODES: ReadonlySet<string> = new Set(["23505", "23P01", "23503", "23514"]);
function isConstraintSqlstate(code: string): code is ConstraintSqlstate {
  return CONSTRAINT_CODES.has(code);
}

/** A database vocabulary only (DEV-DB-007); mapping to HTTP is the API layer's job. */
export type DatabaseErrorClass =
  | { readonly kind: "retryable"; readonly sqlstate: DatabaseRetryState }
  | { readonly kind: "deadline" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "statement_timeout" }
  | {
      readonly kind: "constraint";
      readonly sqlstate: ConstraintSqlstate;
      readonly constraint?: string;
    }
  | { readonly kind: "other" };

export function classifyDatabaseError(error: unknown): DatabaseErrorClass {
  if (error instanceof DatabaseUnavailableError) return { kind: "unavailable" };
  if (error instanceof TransactionDeadlineError) return { kind: "deadline" };
  if (isDatabaseRetryable(error)) return { kind: "retryable", sqlstate: error.code };
  const code = sqlState(error);
  if (code === undefined) return { kind: "other" };
  if (isUnavailableSqlstate(code)) return { kind: "unavailable" };
  if (code === "57014") return { kind: "statement_timeout" };
  if (isConstraintSqlstate(code)) {
    const constraint =
      typeof error === "object" && error !== null && "constraint" in error
        ? error.constraint
        : undefined;
    return {
      kind: "constraint",
      sqlstate: code,
      ...(typeof constraint === "string" ? { constraint } : {}),
    };
  }
  return { kind: "other" };
}
