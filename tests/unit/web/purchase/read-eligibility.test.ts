import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import { eligibilityTargetKey } from "../../../../apps/web/src/api-client/eligibility-target-key.ts";
import type {
  CartLine,
  EligibilityTarget,
  PurchaseEligibility,
  PurchaseEligibilityRead,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  chunkEligibilityTargets,
  MAX_ELIGIBILITY_ITEMS,
} from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import { readEligibilityOf } from "../../../../apps/web/src/features/purchase/read-eligibility.ts";

// Contract: tests/contracts/s5-cart.md section 3.3 / 5.1 (API-PUR-ELG-001 accepts 1..50 items per request;
// SPEC-110). A longer list is read in requests of at most 50 items and is used only when every request
// succeeded; any failure is a failure of the whole read (fail closed, SPEC-050 12.1 / 14A.1).

const entry = (index: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}` as Ref<"offering">,
  quantity: 1,
});
const lines = (count: number): CartLine[] => Array.from({ length: count }, (_, i) => entry(i + 1));

const answer = (target: EligibilityTarget): PurchaseEligibility => ({
  lineKey: eligibilityTargetKey(target),
  purchasable: true,
  reasons: [],
  maxPurchasableQuantity: 3,
});

/** A port double that records the size of every request and answers each item in the input order. */
function recordingPort(failOn?: number, failWith?: PurchaseEligibilityRead | "throw") {
  const sizes: number[] = [];
  const read = async (chunk: readonly EligibilityTarget[]): Promise<PurchaseEligibilityRead> => {
    sizes.push(chunk.length);
    if (failOn !== undefined && sizes.length === failOn) {
      if (failWith === "throw") throw new Error("boom");
      return failWith ?? { kind: "unavailable" };
    }
    return { kind: "ok", data: chunk.map(answer) };
  };
  return { read, sizes };
}

describe("TC-PG-CRT-001-626 chunkEligibilityTargets: a list is split into requests of at most 50 items in order (API-PUR-ELG-001, SPEC-110)", () => {
  it("the limit is the 50 items of the API", () => {
    expect(MAX_ELIGIBILITY_ITEMS).toBe(50);
  });

  it("an empty list gives no request", () => {
    expect(chunkEligibilityTargets([])).toEqual([]);
  });

  it("50 items stay in one request; 51 items give 50 and 1; 101 items give 50, 50 and 1", () => {
    expect(chunkEligibilityTargets(lines(50)).map((chunk) => chunk.length)).toEqual([50]);
    expect(chunkEligibilityTargets(lines(51)).map((chunk) => chunk.length)).toEqual([50, 1]);
    expect(chunkEligibilityTargets(lines(101)).map((chunk) => chunk.length)).toEqual([50, 50, 1]);
  });

  it("keeps every item once and in the input order, and does not change the input", () => {
    const input = lines(120);
    const snapshot = JSON.stringify(input);
    const joined = chunkEligibilityTargets(input).flat();
    expect(joined).toEqual(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("TC-PG-CRT-001-626 readEligibilityOf: every request carries at most 50 items and all must succeed (fail closed)", () => {
  it("reads nothing for no line and answers an empty ok", async () => {
    const port = recordingPort();
    expect(await readEligibilityOf(port.read, [])).toEqual({ kind: "ok", data: [] });
    expect(port.sizes).toEqual([]);
  });

  it("50 lines are one request", async () => {
    const port = recordingPort();
    const result = await readEligibilityOf(port.read, lines(50));
    expect(port.sizes).toEqual([50]);
    expect(result.kind).toBe("ok");
  });

  it("51 lines are read in two requests of 50 and 1 and the answers are joined in the input order", async () => {
    const input = lines(51);
    const port = recordingPort();
    const result = await readEligibilityOf(port.read, input);
    expect(port.sizes.slice().sort((a, b) => a - b)).toEqual([1, 50]);
    expect(Math.max(...port.sizes)).toBeLessThanOrEqual(MAX_ELIGIBILITY_ITEMS);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.map((item) => item.lineKey)).toEqual(input.map(cartLineKey));
    }
  });

  it("a failed later request makes the whole read unavailable, never a partial ok", async () => {
    const port = recordingPort(2);
    expect(await readEligibilityOf(port.read, lines(120))).toEqual({ kind: "unavailable" });
  });

  it("a failed first request makes the whole read unavailable", async () => {
    const port = recordingPort(1);
    expect(await readEligibilityOf(port.read, lines(120))).toEqual({ kind: "unavailable" });
  });

  it("auth_required and email_unverified answers of any request are a failure, not an ok", async () => {
    for (const failure of [
      { kind: "auth_required" },
      { kind: "email_unverified" },
    ] as const satisfies readonly PurchaseEligibilityRead[]) {
      const port = recordingPort(2, failure);
      expect(await readEligibilityOf(port.read, lines(60))).toEqual({ kind: "unavailable" });
    }
  });

  it("a rejected request is a failure, not an exception", async () => {
    const port = recordingPort(2, "throw");
    expect(await readEligibilityOf(port.read, lines(60))).toEqual({ kind: "unavailable" });
  });
});

describe("TC-PG-CRT-001-626 readEligibilityOf: a Karaoke Slot target is read like a Cart line (API-PUR-ELG-001, B4c)", () => {
  const slot: EligibilityTarget = {
    kind: "KARAOKE",
    slotRef: "a0000000-0000-4000-8000-000000000001" as Ref<"slot">,
    quantity: 1,
  };

  it("one Karaoke target is one request and its answer is used", async () => {
    const sizes: number[] = [];
    const read = async (chunk: readonly EligibilityTarget[]): Promise<PurchaseEligibilityRead> => {
      sizes.push(chunk.length);
      return {
        kind: "ok",
        data: chunk.map((target) => ({
          lineKey: eligibilityTargetKey(target),
          purchasable: true,
          reasons: [],
          maxPurchasableQuantity: 1,
        })),
      };
    };
    const result = await readEligibilityOf(read, [slot]);
    expect(sizes).toEqual([1]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.map((item) => item.lineKey)).toEqual([eligibilityTargetKey(slot)]);
    }
  });

  it("a rejected request for a Karaoke target is a failure, not an exception", async () => {
    const read = async (): Promise<PurchaseEligibilityRead> => {
      throw new Error("boom");
    };
    expect(await readEligibilityOf(read, [slot])).toEqual({ kind: "unavailable" });
  });
});
