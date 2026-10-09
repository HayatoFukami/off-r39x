import type { Read } from "./types";

/** A rejected read is a failed read (`unavailable`): it is never shown as empty or Not Found. */
export function settleRead<T>(promise: Promise<Read<T>>): Promise<Read<T>> {
  return promise.catch((): Read<T> => ({ kind: "unavailable" }));
}
