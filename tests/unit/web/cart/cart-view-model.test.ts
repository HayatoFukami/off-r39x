import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type {
  CartLine,
  CartLineResolution,
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
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { presentAvailability } from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

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
    const model = buildCartPageModel({ cart, resolutions, refreshing: false });
    expect(model.kind).toBe("ready");
  });
});
