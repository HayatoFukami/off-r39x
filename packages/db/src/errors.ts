import { type DatabaseRetryState, isDatabaseRetryable } from "@off-r39x/reliability";

export class TransactionDeadlineError extends Error {
  constructor() {
    super("Database transaction deadline exceeded");
  }
}

/**
 * The database could not be reached or a connection was lost, and the failure carried no SQLSTATE
 * (a Node errno such as ECONNRESET, or no code at all, for example a pool acquisition timeout). The
 * DB boundary types it only when a database operation raised it (connect, transaction control, or
 * the callback client's query) or the connection itself reported loss; an errno thrown by the
 * callback's own code on a healthy connection is not typed. The API layer answers 503 without
 * trusting a bare errno. The fixed message never repeats the original error; that stays only in
 * `cause` (REL-DB-009, SEC-ERR-003).
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

/**
 * A server SQLSTATE: five characters of `[0-9A-Z]` whose class does not start with "E". Node errno
 * names all start with "E" and several have five characters (EPIPE, EBADF, EPERM, EBUSY, ...), while
 * no PostgreSQL SQLSTATE class starts with "E" (Appendix A of the PostgreSQL manual).
 */
export function isSqlstate(code: string | undefined): code is string {
  return code !== undefined && /^[0-9A-DF-Z][0-9A-Z]{4}$/.test(code);
}

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "53300",
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
 * Transaction-internal judgement: connection-class SQLSTATE (`08xxx`), a connection refused for
 * want of slots (`53300`), server shutdown (`57P01`-`57P03`) and Node connection errno. Not the API classification, which accepts only
 * typed errors and SQLSTATE (see `isUnavailableSqlstate`).
 */
export function isDatabaseUnavailableCode(code: string): boolean {
  return code.startsWith("08") || UNAVAILABLE_CODES.has(code);
}

/**
 * SQLSTATEs that mean the database connection failed or was refused (SPEC-110 section 51):
 * connection exceptions (`08xxx`), `53300` too_many_connections, which PostgreSQL raises while
 * starting a new connection when the connection slots are used up, and `57P01`-`57P03` (shutdown,
 * cannot connect now). The other `53xxx` resource errors (disk full, out of memory, configuration
 * limit) are raised on an open connection and are not connection failures.
 */
function isUnavailableSqlstate(code: string): boolean {
  return (
    isSqlstate(code) &&
    (code.startsWith("08") ||
      code === "53300" ||
      code === "57P01" ||
      code === "57P02" ||
      code === "57P03")
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

/**
 * True for the classes the API answers with a retryable 503 `DATABASE_TEMPORARY_FAILURE`
 * (SPEC-110 sections 50-51, REL-DB-009): an exhausted retryable SQLSTATE, the transaction deadline,
 * and unavailability. Statement timeout (`57014`), constraint and every other error are not. A
 * repository that turns a temporary failure into a result value uses this, so its answer matches the
 * HTTP boundary's `errorFromException`.
 */
export function isDatabaseTemporaryFailure(error: unknown): boolean {
  const { kind } = classifyDatabaseError(error);
  return kind === "retryable" || kind === "deadline" || kind === "unavailable";
}

/**
 * Types a rejection of one statement sent on the pool outside `transaction()` (a single read): the
 * driver raised it, so without a server SQLSTATE (no code, or a Node errno such as EAI_AGAIN) no
 * server answer was received and it is a `DatabaseUnavailableError` with the original as `cause`,
 * as `transaction()` types a database-originated failure. An error with a SQLSTATE is returned as it
 * is. Only for errors that came out of the database call itself, never the caller's own throws.
 */
export function typeDirectQueryFailure(error: unknown): unknown {
  return isSqlstate(sqlState(error)) ? error : new DatabaseUnavailableError({ cause: error });
}

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
