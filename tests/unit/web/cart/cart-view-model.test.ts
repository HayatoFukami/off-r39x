import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type {
  CartLine,
  CartLineResolution,
  PurchaseEligibility,
  Ref,
  SaleAvailability,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { canProceed } from "../../../../apps/web/src/features/cart/can-proceed.ts";
import {
  buildCartPageModel,
  type CartInput,
} from "../../../../apps/web/src/features/cart/cart-view-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import {
  presentAvailability,
  presentPurchaseReasons,
} from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

// Contract: tests/contracts/s5-cart.md section 3.2 (SPEC-050 9, 14A.1 Fields / Summary / State, 21, 26.4,
// FR-CRT-005, DEV-TS-006 / 007). Pure view-model builder: lines + resolutions -> display rows.

const OFFERING = "e0000000-0000-4000-8000-000000000001" as Ref<"offering">;
const GOODS = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;
const GOODS_2 = "a0000000-0000-4000-8000-000000000002" as Ref<"goods">;
const SOON = "2027-03-04T03:00:00Z" as UtcInstant;

const entry = (quantity: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: OFFERING,
  quantity,
});
const goods = (quantity: number, ref: Ref<"goods"> = GOODS): CartLine => ({
  kind: "GOODS",
  goodsRef: ref,
  quantity,
});

const resolved = (
  line: CartLine,
  name: string,
  amount: string,
  availability: SaleAvailability = { kind: "ON_SALE", maxSelectableQuantity: null },
): CartLineResolution => ({
  lineKey: cartLineKey(line),
  status: "resolved",
  name,
  unitPrice: { amount, currency: "JPY" },
  availability,
});

const ready = (lines: CartLine[]): CartInput["cart"] => ({
  kind: "ready",
  cart: { version: 1, lines },
});
const ok = (data: CartLineResolution[]): CartInput["resolutions"] => ({ kind: "ok", data });

const input = (patch: Partial<CartInput> & Pick<CartInput, "cart">): CartInput => ({
  resolutions: { kind: "loading" },
  refreshing: false,
  // Guest and unverified users read the public conditions only; the existing cases keep that meaning.
  eligibility: { kind: "not_applicable" },
  ...patch,
});

describe("TC-PG-CRT-001-441 the Cart page model separates loading, corrupted and a verified empty Cart (SPEC-050 9, 14A.1 State, 26.4)", () => {
  it("is loading while the browser Cart has not been read", () => {
    expect(buildCartPageModel(input({ cart: { kind: "loading" } }))).toEqual({ kind: "loading" });
  });

  it("is corrupted for a damaged Cart whatever the resolutions are (never empty)", () => {
    for (const resolutions of [{ kind: "loading" }, ok([]), { kind: "unavailable" }] as const) {
      expect(buildCartPageModel(input({ cart: { kind: "corrupted" }, resolutions }))).toEqual({
        kind: "corrupted",
      });
    }
  });

  it("is empty only for a verified empty Cart, whatever the resolution state is", () => {
    for (const resolutions of [
      { kind: "loading" },
      ok([]),
      { kind: "unavailable" },
      { kind: "not_found" },
    ] as const) {
      for (const refreshing of [false, true]) {
        expect(buildCartPageModel(input({ cart: ready([]), resolutions, refreshing }))).toEqual({
          kind: "empty",
        });
      }
    }
  });

  it("is loading while the lines are being resolved and exposes no row and no amount", () => {
    const model = buildCartPageModel(
      input({ cart: ready([entry(1)]), resolutions: { kind: "loading" } }),
    );
    expect(model).toEqual({ kind: "loading" });
  });
});

describe("TC-PG-CRT-001-442 a failed resolution is 'unknown', never purchasable and never empty (FR-CRT-005, SPEC-050 14A.1 Failure)", () => {
  it.each([["unavailable"], ["not_found"], ["auth_required"], ["email_unverified"]] as const)(
    "a %s read keeps the lines as unresolved rows and blocks proceeding",
    (kind) => {
      const lines = [entry(2), goods(1)];
      const model = buildCartPageModel(input({ cart: ready(lines), resolutions: { kind } }));
      expect(model.kind).toBe("unavailable");
      if (model.kind !== "unavailable") return;
      expect(model.rows).toHaveLength(2);
      const unknown = presentAvailability({ kind: "unavailable" });
      expect(model.rows.map((row) => row.lineKey)).toEqual(lines.map(cartLineKey));
      expect(model.rows.map((row) => row.quantity)).toEqual([2, 1]);
      expect(model.rows.map((row) => row.kind)).toEqual(["ENTRY_TICKET", "GOODS"]);
      for (const row of model.rows) {
        expect(row.name).toBeNull();
        expect(row.unitPriceText).toBeNull();
        expect(row.subtotalText).toBeNull();
        expect(row.status).toEqual(unknown);
        expect(row.status.purchasable).toBe(false);
      }
      expect(model.proceed).toEqual({ canProceed: false, reasons: [{ kind: "unresolved" }] });
    },
  );
});

describe("TC-PG-CRT-001-443 ready rows show the current name, unit price, quantity, subtotal and availability from the port (SPEC-050 14A.1 Fields, FR-CRT-005)", () => {
  it("builds one row per line in Cart order with bigint money", () => {
    const e = entry(2);
    const g = goods(3);
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([resolved(g, "Towel", "1800"), resolved(e, "Regular", "3000")]),
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows).toEqual([
      {
        lineKey: cartLineKey(e),
        kind: "ENTRY_TICKET",
        kindLabel: copy.cart.kind.ENTRY_TICKET,
        quantity: 2,
        name: "Regular",
        unitPriceText: "¥3,000",
        subtotalText: "¥6,000",
        status: presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: null }),
      },
      {
        lineKey: cartLineKey(g),
        kind: "GOODS",
        kindLabel: copy.cart.kind.GOODS,
        quantity: 3,
        name: "Towel",
        unitPriceText: "¥1,800",
        subtotalText: "¥5,400",
        status: presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: null }),
      },
    ]);
    expect(model.totalText).toBe("¥11,400");
    expect(model.proceed).toEqual({ canProceed: true });
  });

  it("keeps Entry and Goods kind labels distinct", () => {
    expect(copy.cart.kind.ENTRY_TICKET).not.toBe(copy.cart.kind.GOODS);
  });

  it("is exact beyond double precision (unit price and total)", () => {
    const g = goods(3);
    const model = buildCartPageModel(
      input({ cart: ready([g]), resolutions: ok([resolved(g, "Big", "9007199254740993")]) }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows[0]?.unitPriceText).toBe(
      formatMoney({ amount: "9007199254740993", currency: "JPY" }),
    );
    expect(model.rows[0]?.subtotalText).toBe("¥27,021,597,764,222,979");
    expect(model.totalText).toBe("¥27,021,597,764,222,979");
  });

  it("presents each unavailable reason through the S1 availability mapping and blocks proceeding", () => {
    const cases: [CartLine, SaleAvailability][] = [
      [entry(1), { kind: "BEFORE_SALES", startsAt: SOON }],
      [goods(1), { kind: "SALES_ENDED" }],
      [goods(1, GOODS_2), { kind: "SUSPENDED" }],
    ];
    const lines = cases.map(([line]) => line);
    const model = buildCartPageModel(
      input({
        cart: ready(lines),
        resolutions: ok(
          cases.map(([line, availability]) => resolved(line, "Item", "500", availability)),
        ),
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows.map((row) => row.status)).toEqual(
      cases.map(([, availability]) => presentAvailability(availability)),
    );
    expect(model.rows.every((row) => !row.status.purchasable)).toBe(true);
    expect(model.proceed.canProceed).toBe(false);
    // Blocked rows still carry their (server-side) price and are part of the display total.
    expect(model.totalText).toBe("¥1,500");
  });

  it("shows a not-public line without a name or an amount and with its own reason", () => {
    const e = entry(1);
    const g = goods(1);
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([
          resolved(e, "Regular", "3000"),
          { lineKey: cartLineKey(g), status: "not_public" },
        ]),
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    const row = model.rows[1];
    expect(row?.name).toBeNull();
    expect(row?.unitPriceText).toBeNull();
    expect(row?.subtotalText).toBeNull();
    expect(row?.status).toEqual(presentAvailability({ kind: "not_public" }));
    expect(model.totalText).toBeNull();
    expect(model.proceed).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(g), reason: "not_public" }],
    });
  });

  it("shows a partially failed resolution per line: the unresolved line is unknown, the rest is normal", () => {
    const e = entry(1);
    const g = goods(2);
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([
          { lineKey: cartLineKey(e), status: "unavailable" },
          resolved(g, "Towel", "1800"),
        ]),
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows[0]?.status).toEqual(presentAvailability({ kind: "unavailable" }));
    expect(model.rows[0]?.name).toBeNull();
    expect(model.rows[1]?.name).toBe("Towel");
    expect(model.rows[1]?.subtotalText).toBe("¥3,600");
    expect(model.totalText).toBeNull();
    expect(model.proceed.canProceed).toBe(false);
  });

  it("treats a line without any resolution as unknown, and ignores resolutions of other lines", () => {
    const e = entry(1);
    const model = buildCartPageModel(
      input({ cart: ready([e]), resolutions: ok([resolved(goods(1), "Stray", "100")]) }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.name).toBeNull();
    expect(model.rows[0]?.status).toEqual(presentAvailability({ kind: "unavailable" }));
    expect(model.totalText).toBeNull();
  });

  it("uses canProceed for the proceed decision", () => {
    const e = entry(1);
    const g = goods(1);
    const resolutions = [
      resolved(e, "Regular", "3000"),
      resolved(g, "Towel", "1800", { kind: "SOLD_OUT" }),
    ];
    const model = buildCartPageModel(input({ cart: ready([e, g]), resolutions: ok(resolutions) }));
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.proceed).toEqual(canProceed([e, g], resolutions));
  });
});

describe("TC-PG-CRT-001-444 while the lines are being re-resolved the rows stay but proceeding is blocked (Design 6, SPEC-050 22)", () => {
  it("keeps the previous rows and amounts, and blocks proceeding as unresolved", () => {
    const e = entry(2);
    const resolutions = ok([resolved(e, "Regular", "3000")]);
    const settled = buildCartPageModel(input({ cart: ready([e]), resolutions, refreshing: false }));
    const refreshing = buildCartPageModel(
      input({ cart: ready([e]), resolutions, refreshing: true }),
    );
    expect(settled.kind).toBe("ready");
    expect(refreshing.kind).toBe("ready");
    if (settled.kind !== "ready" || refreshing.kind !== "ready") return;
    expect(settled.proceed).toEqual({ canProceed: true });
    expect(refreshing.rows).toEqual(settled.rows);
    expect(refreshing.proceed).toEqual({ canProceed: false, reasons: [{ kind: "unresolved" }] });
  });
});

describe("TC-PG-CRT-001-445 the builder does not mutate its input and does not read price from the Cart (FR-CRT-003)", () => {
  it("leaves frozen inputs untouched", () => {
    const e = entry(1);
    const cart = Object.freeze({
      kind: "ready" as const,
      cart: Object.freeze({ version: 1 as const, lines: Object.freeze([Object.freeze(e)]) }),
    });
    const resolutions = Object.freeze({
      kind: "ok" as const,
      data: Object.freeze([Object.freeze(resolved(e, "Regular", "3000"))]),
    });
    const model = buildCartPageModel({
      cart,
      resolutions,
      refreshing: false,
      eligibility: { kind: "not_applicable" },
    });
    expect(model.kind).toBe("ready");
  });
});

describe("TC-PG-CRT-001-446 the Cart page model shows the owner-scoped eligibility per line and never shows an unconfirmed line as on sale (API-PUR-ELG-001, SPEC-050 12.1 / 14A.1 / 21, FR-CRT-005)", () => {
  const e = entry(2);
  const g = goods(1);
  const soon = goods(1, GOODS_2);
  const lines = [e, g, soon];
  const publicResolutions = (): CartLineResolution[] => [
    resolved(e, "Regular", "3000", { kind: "ON_SALE", maxSelectableQuantity: 4 }),
    resolved(g, "Towel", "1800"),
    resolved(soon, "Poster", "500", { kind: "BEFORE_SALES", startsAt: SOON }),
  ];
  const eligible = (
    line: CartLine,
    patch: Partial<PurchaseEligibility> = {},
  ): PurchaseEligibility => ({
    lineKey: cartLineKey(line),
    purchasable: true,
    reasons: [],
    maxPurchasableQuantity: 4,
    ...patch,
  });
  const unknown = presentAvailability({ kind: "unavailable" });

  it("is loading while the eligibility is being read (the resolutions alone are not enough)", () => {
    const model = buildCartPageModel(
      input({
        cart: ready(lines),
        resolutions: ok(publicResolutions()),
        eligibility: { kind: "loading" },
      }),
    );
    expect(model).toEqual({ kind: "loading" });
  });

  it("ignores the eligibility in the states that come before it: corrupted, empty, loading and failed resolutions", () => {
    for (const eligibility of [
      { kind: "loading" },
      { kind: "unavailable" },
      { kind: "not_applicable" },
    ] as const) {
      expect(buildCartPageModel(input({ cart: { kind: "corrupted" }, eligibility }))).toEqual({
        kind: "corrupted",
      });
      expect(
        buildCartPageModel(
          input({ cart: ready([]), resolutions: ok(publicResolutions()), eligibility }),
        ),
      ).toEqual({ kind: "empty" });
      expect(
        buildCartPageModel(
          input({ cart: ready(lines), resolutions: { kind: "loading" }, eligibility }),
        ),
      ).toEqual({ kind: "loading" });
    }
    const failed = buildCartPageModel(
      input({
        cart: ready(lines),
        resolutions: { kind: "unavailable" },
        eligibility: { kind: "ok", data: [] },
      }),
    );
    expect(failed.kind).toBe("unavailable");
  });

  it("keeps the names and amounts when the eligibility failed; unconfirmed lines say so and proceeding is blocked", () => {
    const model = buildCartPageModel(
      input({
        cart: ready(lines),
        resolutions: ok(publicResolutions()),
        eligibility: { kind: "unavailable" },
      }),
    );
    expect(model.kind).toBe("unavailable");
    if (model.kind !== "unavailable") return;
    expect(model.rows.map((row) => row.lineKey)).toEqual(lines.map(cartLineKey));
    expect(model.rows.map((row) => row.name)).toEqual(["Regular", "Towel", "Poster"]);
    expect(model.rows.map((row) => row.unitPriceText)).toEqual(["¥3,000", "¥1,800", "¥500"]);
    expect(model.rows.map((row) => row.subtotalText)).toEqual(["¥6,000", "¥1,800", "¥500"]);
    // Purchasable on the public conditions, but not confirmed for the owner: "cannot confirm".
    expect(model.rows[0]?.status).toEqual(unknown);
    expect(model.rows[1]?.status).toEqual(unknown);
    // Not purchasable on the public conditions: the public answer, with the configured start time.
    expect(model.rows[2]?.status).toEqual(
      presentAvailability({ kind: "BEFORE_SALES", startsAt: SOON }),
    );
    expect(model.rows[2]?.status.description).toContain(formatJstDateTime(SOON));
    for (const row of model.rows) {
      expect(row.status.label).not.toBe(copy.availability.label.ON_SALE);
      expect(row.status.purchasable).toBe(false);
    }
    expect(model.proceed).toEqual(canProceed(lines, publicResolutions(), { kind: "unavailable" }));
    expect(model.proceed.canProceed).toBe(false);
  });

  it("asks only for the unknown reason when the eligibility failed and no line is blocked on the public conditions", () => {
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([resolved(e, "Regular", "3000"), resolved(g, "Towel", "1800")]),
        eligibility: { kind: "unavailable" },
      }),
    );
    expect(model.kind).toBe("unavailable");
    if (model.kind !== "unavailable") return;
    expect(model.proceed).toEqual({ canProceed: false, reasons: [{ kind: "unresolved" }] });
  });

  it("shows each line from its own eligibility once it is ok: on sale with the maximum, or the reasons", () => {
    const refused = eligible(g, {
      purchasable: false,
      reasons: ["INSUFFICIENT_QUANTITY", "PURCHASE_LIMIT_EXCEEDED"],
      maxPurchasableQuantity: 1,
    });
    const model = buildCartPageModel(
      input({
        cart: ready(lines),
        resolutions: ok(publicResolutions()),
        eligibility: { kind: "ok", data: [refused, eligible(e, { maxPurchasableQuantity: 4 })] },
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows[0]?.status).toEqual(
      presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: 4 }),
    );
    expect(model.rows[1]?.status).toEqual(presentPurchaseReasons(refused.reasons, 1));
    expect(model.rows[1]?.status.label).toBe(copy.availability.label.INSUFFICIENT_QUANTITY);
    expect(model.rows[1]?.status.description).toContain(
      copy.availability.description.PURCHASE_LIMIT_EXCEEDED,
    );
    // A line that is not purchasable publicly keeps its public answer: the eligibility is not read for it.
    expect(model.rows[2]?.status).toEqual(
      presentAvailability({ kind: "BEFORE_SALES", startsAt: SOON }),
    );
    expect(model.proceed.canProceed).toBe(false);
    expect(model.totalText).toBe("¥8,300");
  });

  it("is purchasable only when every public-purchasable line is purchasable for the owner", () => {
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([resolved(e, "Regular", "3000"), resolved(g, "Towel", "1800")]),
        eligibility: { kind: "ok", data: [eligible(e), eligible(g)] },
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    for (const row of model.rows) {
      expect(row.status.label).toBe(copy.availability.label.ON_SALE);
      expect(row.status.purchasable).toBe(true);
    }
    expect(model.proceed).toEqual({ canProceed: true });
    expect(model.totalText).toBe("¥7,800");
  });

  it("shows a line without an eligibility entry as cannot-confirm, never as on sale", () => {
    const model = buildCartPageModel(
      input({
        cart: ready([e, g]),
        resolutions: ok([resolved(e, "Regular", "3000"), resolved(g, "Towel", "1800")]),
        eligibility: { kind: "ok", data: [eligible(e)] },
      }),
    );
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.rows[0]?.status.label).toBe(copy.availability.label.ON_SALE);
    expect(model.rows[1]?.status).toEqual(unknown);
    expect(model.proceed.canProceed).toBe(false);
  });

  it("keeps the previous rows and blocks proceeding while the lines are re-read, with the eligibility too", () => {
    const base = {
      cart: ready([e, g]),
      resolutions: ok([resolved(e, "Regular", "3000"), resolved(g, "Towel", "1800")]),
      eligibility: { kind: "ok", data: [eligible(e), eligible(g)] } as const,
    };
    const settled = buildCartPageModel(input({ ...base, refreshing: false }));
    const refreshing = buildCartPageModel(input({ ...base, refreshing: true }));
    if (settled.kind !== "ready" || refreshing.kind !== "ready") throw new Error("expected ready");
    expect(settled.proceed).toEqual({ canProceed: true });
    expect(refreshing.rows).toEqual(settled.rows);
    expect(refreshing.proceed).toEqual({ canProceed: false, reasons: [{ kind: "unresolved" }] });
  });

  it("does not mutate the eligibility input", () => {
    const data = Object.freeze([Object.freeze(eligible(e))]);
    const model = buildCartPageModel(
      input({
        cart: ready([e]),
        resolutions: ok([resolved(e, "Regular", "3000")]),
        eligibility: { kind: "ok", data },
      }),
    );
    expect(model.kind).toBe("ready");
  });
});
