import type { Read } from "../../api-client/types";

// Loading, empty and unavailable are three different states (SPEC-050 9.1, 9.2, 21).

export type Loadable<T> = Read<T> | { kind: "loading" };

export type ListState<T> =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "items"; items: readonly T[] };

export function toListState<S, T>(
  input: Loadable<readonly S[]>,
  map: (source: S) => T,
): ListState<T> {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "ok":
      return input.data.length === 0
        ? { kind: "empty" }
        : { kind: "items", items: input.data.map((item) => map(item)) };
    case "not_found":
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      // A failed read is never empty.
      return { kind: "unavailable" };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
