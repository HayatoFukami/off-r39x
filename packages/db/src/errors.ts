import { type DatabaseRetryState, isDatabaseRetryable } from "@off-r39x/reliability";

export class TransactionDeadlineError extends Error {
  constructor() {
    super("Database transaction deadline exceeded");
  }
}

/**
 * The database could not be reached or a connection was lost, and the failure carried no SQLSTATE or
 * errno of its own (for example a pool acquisition timeout). The fixed message never repeats the
 * original error; that stays only in `cause` (REL-DB-009, SEC-ERR-003).
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
]);
/** Connection-class SQLSTATE (`08xxx`), server shutdown (`57P01`-`57P03`) and Node connection errno. */
export function isDatabaseUnavailableCode(code: string): boolean {
  return code.startsWith("08") || UNAVAILABLE_CODES.has(code);
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
  if (isDatabaseUnavailableCode(code)) return { kind: "unavailable" };
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
