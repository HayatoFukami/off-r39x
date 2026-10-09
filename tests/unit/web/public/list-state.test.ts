import { describe, expect, it } from "vitest";
import type { Read } from "../../../../apps/web/src/api-client/types.ts";
import {
  type Loadable,
  toListState,
} from "../../../../apps/web/src/presentation/components/list-state.ts";

// Contract: tests/contracts/s4-public.md section 2.3 (SPEC-050 9.1, 9.2, 21, 33).

const double = (n: number): number => n * 2;

describe("TC-PG-PUB-002-601 toListState keeps loading, empty and unavailable apart", () => {
  it("returns loading without mapping anything", () => {
    let calls = 0;
    const state = toListState<number, number>({ kind: "loading" }, (n) => {
      calls += 1;
      return n;
    });
    expect(state).toEqual({ kind: "loading" });
    expect(calls).toBe(0);
  });

  it("returns empty only for a successful read of zero items", () => {
    expect(toListState<number, number>({ kind: "ok", data: [] }, double)).toEqual({
      kind: "empty",
    });
  });

  it("maps successful items in order and does not re-sort", () => {
    const input: Loadable<readonly number[]> = { kind: "ok", data: [3, 1, 2] };
    expect(toListState(input, double)).toEqual({ kind: "items", items: [6, 2, 4] });
  });

  it("never turns a failed read into empty (every non-ok Read kind is unavailable)", () => {
    const failures: Read<readonly number[]>[] = [
      { kind: "unavailable" },
      { kind: "not_found" },
      { kind: "auth_required" },
      { kind: "email_unverified" },
    ];
    for (const failure of failures) {
      expect(toListState(failure, double), failure.kind).toEqual({ kind: "unavailable" });
    }
  });

  it("does not mutate the input array", () => {
    const data = [1, 2, 3] as const;
    const snapshot = [...data];
    toListState({ kind: "ok", data }, double);
    expect([...data]).toEqual(snapshot);
  });
});
