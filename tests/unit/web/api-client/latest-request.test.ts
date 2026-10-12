import { describe, expect, it } from "vitest";
import {
  applyIfLatest,
  invalidateRequests,
  type RequestCounter,
} from "../../../../apps/web/src/api-client/latest-request.ts";
import { settleRead } from "../../../../apps/web/src/api-client/settle-read.ts";
import type { Read } from "../../../../apps/web/src/api-client/types.ts";

// Contract: tests/contracts/s8-mypage.md sections 1 and 4.1, tests/contracts/s7a-purchase.md section 6
// (DEV-WEB-009, SPEC-050 9.1 / 22). Only the last-started read is reflected. Promises are settled by hand:
// no timers, no clock, no randomness.

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recorder<T>(): { applied: T[]; apply: (value: T) => void } {
  const applied: T[] = [];
  return {
    applied,
    apply: (value) => {
      applied.push(value);
    },
  };
}

const newCounter = (): RequestCounter => ({ current: 0 });

describe("TC-DEV-WEB-009-601 only the last-started read is applied (DEV-WEB-009, SPEC-050 9.1 / 22, PG-MYP-001, PG-XFN-001)", () => {
  it("applies a single request exactly once and resolves true", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const request = deferred<string>();
    const outcome = applyIfLatest(counter, request.promise, apply);
    expect(applied).toEqual([]);
    request.resolve("A");
    await expect(outcome).resolves.toBe(true);
    expect(applied).toEqual(["A"]);
  });

  it("applies both of two sequential, non-overlapping requests", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstOutcome = applyIfLatest(counter, first.promise, apply);
    first.resolve("A");
    await expect(firstOutcome).resolves.toBe(true);
    const secondOutcome = applyIfLatest(counter, second.promise, apply);
    second.resolve("B");
    await expect(secondOutcome).resolves.toBe(true);
    expect(applied).toEqual(["A", "B"]);
  });

  it("discards the earlier of two overlapping requests that complete in start order", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    const outcomeA = applyIfLatest(counter, a.promise, apply);
    const outcomeB = applyIfLatest(counter, b.promise, apply);
    a.resolve("A");
    await expect(outcomeA).resolves.toBe(false);
    expect(applied).toEqual([]);
    b.resolve("B");
    await expect(outcomeB).resolves.toBe(true);
    expect(applied).toEqual(["B"]);
  });

  it("keeps the later request result when the earlier one completes last (reverse completion)", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    const outcomeA = applyIfLatest(counter, a.promise, apply);
    const outcomeB = applyIfLatest(counter, b.promise, apply);
    b.resolve("B");
    await expect(outcomeB).resolves.toBe(true);
    a.resolve("A");
    await expect(outcomeA).resolves.toBe(false);
    expect(applied).toEqual(["B"]);
  });

  it("still applies a delayed latest request after earlier requests were discarded", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    const c = deferred<string>();
    const outcomeA = applyIfLatest(counter, a.promise, apply);
    const outcomeB = applyIfLatest(counter, b.promise, apply);
    const outcomeC = applyIfLatest(counter, c.promise, apply);
    a.resolve("A");
    b.resolve("B");
    await expect(outcomeA).resolves.toBe(false);
    await expect(outcomeB).resolves.toBe(false);
    expect(applied).toEqual([]);
    c.resolve("C");
    await expect(outcomeC).resolves.toBe(true);
    expect(applied).toEqual(["C"]);
  });

  it("discards a response that arrives after the counter was invalidated (unmount)", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const outcome = applyIfLatest(counter, a.promise, apply);
    invalidateRequests(counter);
    a.resolve("A");
    await expect(outcome).resolves.toBe(false);
    expect(applied).toEqual([]);
  });

  it("reflects only the last effect when effect, reload and a dependency change overlap, in every completion order", async () => {
    const orders: readonly (readonly ("A" | "B" | "C")[])[] = [
      ["C", "B", "A"],
      ["C", "A", "B"],
      ["A", "B", "C"],
      ["B", "C", "A"],
      ["A", "C", "B"],
      ["B", "A", "C"],
    ];
    for (const order of orders) {
      const counter = newCounter();
      const { applied, apply } = recorder<string>();
      const requests = { A: deferred<string>(), B: deferred<string>(), C: deferred<string>() };
      // effect A, then reload B, then the dependency changes: cleanup invalidates and effect C starts.
      const outcomeA = applyIfLatest(counter, requests.A.promise, apply);
      const outcomeB = applyIfLatest(counter, requests.B.promise, apply);
      invalidateRequests(counter);
      const outcomeC = applyIfLatest(counter, requests.C.promise, apply);
      for (const name of order) requests[name].resolve(name);
      const results = await Promise.all([outcomeA, outcomeB, outcomeC]);
      expect(results, order.join(">")).toEqual([false, false, true]);
      expect(applied, order.join(">")).toEqual(["C"]);
    }
  });

  it("does not let separate counters interfere with each other", async () => {
    const one = newCounter();
    const two = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const b = deferred<string>();
    const outcomeA = applyIfLatest(one, a.promise, apply);
    const outcomeB = applyIfLatest(two, b.promise, apply);
    invalidateRequests(two);
    a.resolve("A");
    b.resolve("B");
    await expect(outcomeA).resolves.toBe(true);
    await expect(outcomeB).resolves.toBe(false);
    expect(applied).toEqual(["A"]);
  });

  it("propagates a rejection without applying anything", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<string>();
    const a = deferred<string>();
    const outcome = applyIfLatest(counter, a.promise, apply);
    const failure = new Error("failed read");
    a.reject(failure);
    await expect(outcome).rejects.toBe(failure);
    expect(applied).toEqual([]);
  });

  it("applies an unavailable result when the request is wrapped with settleRead (a rejected read is a failed read)", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<Read<string>>();
    const a = deferred<Read<string>>();
    const outcome = applyIfLatest(counter, settleRead(a.promise), apply);
    a.reject(new Error("failed read"));
    await expect(outcome).resolves.toBe(true);
    expect(applied).toEqual([{ kind: "unavailable" }]);
  });

  it("advances the counter by exactly one per request and per invalidation, and applies each request at most once", async () => {
    const counter = newCounter();
    const { applied, apply } = recorder<number>();
    const start = counter.current;
    const a = deferred<number>();
    const outcomeA = applyIfLatest(counter, a.promise, apply);
    expect(counter.current).toBe(start + 1);
    invalidateRequests(counter);
    expect(counter.current).toBe(start + 2);
    const b = deferred<number>();
    const outcomeB = applyIfLatest(counter, b.promise, apply);
    expect(counter.current).toBe(start + 3);
    a.resolve(1);
    b.resolve(2);
    await Promise.all([outcomeA, outcomeB]);
    expect(counter.current).toBe(start + 3);
    expect(applied).toEqual([2]);
  });
});
