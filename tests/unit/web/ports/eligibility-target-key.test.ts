import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import { eligibilityTargetKey } from "../../../../apps/web/src/api-client/eligibility-target-key.ts";
import type {
  CartLine,
  EligibilityTarget,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";

// Contract: tests/contracts/s2-mock-backend.md section 2 (eligibilityTargetKey; SPEC-110 API-PUR-ELG-001 Body: ENTRY / GOODS /
// KARAOKE, SPEC-020 FR-CRT-002). The key of a Cart line stays cartLineKey; a Karaoke Slot is keyed KARAOKE:<slotRef>.

const SAME_UUID = "5a000000-0000-4000-8000-000000000001";
const SLOT_REF = SAME_UUID as Ref<"slot">;
const entry: CartLine = {
  kind: "ENTRY_TICKET",
  offeringRef: SAME_UUID as Ref<"offering">,
  quantity: 1,
};
const goods: CartLine = { kind: "GOODS", goodsRef: SAME_UUID as Ref<"goods">, quantity: 1 };
const karaoke: EligibilityTarget = { kind: "KARAOKE", slotRef: SLOT_REF, quantity: 1 };

const keyModule = fileURLToPath(
  new URL("../../../../apps/web/src/api-client/eligibility-target-key.ts", import.meta.url),
);

describe("TC-PG-KRK-003-617 eligibilityTargetKey keys a Cart line by cartLineKey and a Karaoke Slot by KARAOKE:<slotRef> (API-PUR-ELG-001, FR-CRT-002)", () => {
  it("lives in api-client/eligibility-target-key.ts and exports eligibilityTargetKey, importing only the api-client layer", () => {
    expect(existsSync(keyModule), "apps/web/src/api-client/eligibility-target-key.ts").toBe(true);
    const source = existsSync(keyModule) ? readFileSync(keyModule, "utf8") : "";
    expect(source).toMatch(/export\s+function\s+eligibilityTargetKey\s*\(/);
    // api-client layer only: types, the Cart line key and the domain assertNever (no React, storage, mock or presentation).
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of imports) {
      expect(["./types", "./cart-line-key", "@off-r39x/domain"], String(specifier)).toContain(
        specifier,
      );
    }
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|fetch|console)\b/);
  });

  it("keys a Karaoke Slot as KARAOKE:<slotRef>", () => {
    expect(eligibilityTargetKey(karaoke)).toBe(`KARAOKE:${SAME_UUID}`);
  });

  it("keys an Entry ticket and a Goods item exactly as cartLineKey does", () => {
    expect(eligibilityTargetKey(entry)).toBe(cartLineKey(entry));
    expect(eligibilityTargetKey(goods)).toBe(cartLineKey(goods));
  });

  it("gives three different keys when the same UUID string is used for the three kinds", () => {
    const keys = [entry, goods, karaoke].map(eligibilityTargetKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("is stable for equal targets and does not depend on the Karaoke quantity field being read twice", () => {
    expect(eligibilityTargetKey({ ...karaoke })).toBe(eligibilityTargetKey(karaoke));
  });

  it("does not mutate its input", () => {
    const frozen = Object.freeze({ ...karaoke });
    const before = JSON.stringify(frozen);
    eligibilityTargetKey(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
