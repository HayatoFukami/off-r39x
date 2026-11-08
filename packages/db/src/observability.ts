import type { LogEvent } from "@off-r39x/observability";
import type { Pool } from "pg";

export type DatabaseLogger = { log(event: LogEvent): void };
/** Observability failures must never alter database outcomes or cleanup. */
export function logDatabase(logger: DatabaseLogger | undefined, event: LogEvent): void {
  try {
    logger?.log(event);
  } catch {
    // Logging is best-effort at the DB boundary; the logger itself remains strict.
  }
}
const observers = new WeakMap<Pool, DatabaseLogger>();
export function observeDatabase(pool: Pool, logger: DatabaseLogger): void {
  observers.set(pool, logger);
}
export function databaseLogger(pool: Pool): DatabaseLogger | undefined {
  return observers.get(pool);
}
