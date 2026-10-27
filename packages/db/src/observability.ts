import type { LogEvent } from "@off-r39x/observability";
import type { Pool } from "pg";

export type DatabaseLogger = { log(event: LogEvent): void };
const observers = new WeakMap<Pool, DatabaseLogger>();
export function observeDatabase(pool: Pool, logger: DatabaseLogger): void {
  observers.set(pool, logger);
}
export function databaseLogger(pool: Pool): DatabaseLogger | undefined {
  return observers.get(pool);
}
