import { ORDER_PURPOSES, type OrderPurpose } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  presentPurpose,
  presentQrTitle,
  purchaseAgainTarget,
} from "../../../../apps/web/src/presentation/state-mapping/purpose.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

describe("TC-PG-MYP-003-001 presentPurpose (SPEC-050 18.3 / 16.5, BR-ORD-013)", () => {
  it("returns the included entitlement kinds per purpose", () => {
    expect(presentPurpose("ENTRY_TICKET_PURCHASE")).toMatchObject({
      includes: ["ENTRY_TICKET"],
      isComposite: false,
    });
    expect(presentPurpose("KARAOKE_PURCHASE")).toMatchObject({
      includes: ["KARAOKE"],
      isComposite: false,
    });
    expect(presentPurpose("GOODS_PURCHASE")).toMatchObject({
      includes: ["GOODS"],
      isComposite: false,
    });
    expect(presentPurpose("ENTRY_GOODS_PURCHASE")).toMatchObject({
      includes: ["ENTRY_TICKET", "GOODS"],
      isComposite: true,
    });
  });

  it("gives the 4 purposes distinct, dictionary-backed labels", () => {
    const labels = ORDER_PURPOSES.map((p) => presentPurpose(p).label);
    expect(new Set(labels).size).toBe(4);
    const dictionary = new Set(stringLeaves(copy));
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      expect(dictionary.has(label), label).toBe(true);
    }
  });

  it("names the right kinds in each label, and both kinds for the combined order", () => {
    const entry = presentPurpose("ENTRY_TICKET_PURCHASE").label;
    const karaoke = presentPurpose("KARAOKE_PURCHASE").label;
    const goods = presentPurpose("GOODS_PURCHASE").label;
    const combined = presentPurpose("ENTRY_GOODS_PURCHASE").label;
    expect(entry).toContain("Entry");
    expect(entry).not.toContain("Goods");
    expect(karaoke).toContain("Karaoke");
    expect(goods).toContain("Goods");
    expect(goods).not.toContain("Entry");
    expect(combined).toContain("Entry");
    expect(combined).toContain("Goods");
  });

  it("fails closed on an unknown purpose", () => {
    expect(() => presentPurpose("SOMETHING_NEW" as OrderPurpose)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-MYP-010-001 presentQrTitle (SPEC-050 18.7 / 18.10 / 24.2)", () => {
  it("uses the fixed, mutually different titles for Entry and Karaoke", () => {
    expect(presentQrTitle("ENTRY")).toBe("Entry Ticket / 入場受付用");
    expect(presentQrTitle("KARAOKE")).toBe("Karaoke Ticket / Karaoke受付用");
    expect(presentQrTitle("ENTRY")).not.toBe(presentQrTitle("KARAOKE"));
  });

  it("takes both titles from the copy dictionary", () => {
    const dictionary = new Set(stringLeaves(copy));
    expect(dictionary.has(presentQrTitle("ENTRY"))).toBe(true);
    expect(dictionary.has(presentQrTitle("KARAOKE"))).toBe(true);
  });

  it("fails closed on an unknown QR purpose", () => {
    expect(() => presentQrTitle("STAFF" as never)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-XFN-001-004 purchaseAgainTarget (SPEC-050 16.4)", () => {
  it.each([
    ["ENTRY_TICKET_PURCHASE", "cart"],
    ["GOODS_PURCHASE", "cart"],
    ["ENTRY_GOODS_PURCHASE", "cart"],
    ["KARAOKE_PURCHASE", "karaoke"],
  ] as const)("%s -> %s", (purpose, target) => {
    expect(purchaseAgainTarget(purpose)).toBe(target);
  });

  it("fails closed on an unknown purpose", () => {
    expect(() => purchaseAgainTarget("SOMETHING_NEW" as OrderPurpose)).toThrow(/Unexpected value/);
  });
});
