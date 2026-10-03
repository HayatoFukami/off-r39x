import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine, OrderItem, Ref } from "../../../../apps/web/src/api-client/types.ts";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import {
  type CartStorage,
  createCartStore,
} from "../../../../apps/web/src/features/cart/cart-store.ts";

// Contract: tests/contracts/s5-cart.md section 2.3 (SPEC-050 14A.1 Cartの保持 / 26.4, FR-CRT-001 / 003 / 012,
// BR-ORD-020, DEV-TS-004). The store is storage-backed and storage is injected (no window in node).

const OFFERING = "e0000000-0000-4000-8000-000000000001" as Ref<"offering">;
const GOODS = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;
const entry = (quantity: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: OFFERING,
  quantity,
});
const goods = (quantity: number): CartLine => ({ kind: "GOODS", goodsRef: GOODS, quantity });

class MemoryStorage implements CartStorage {
  readonly data = new Map<string, string>();
  readonly writes: [string, string][] = [];
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error("storage read blocked");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error("storage quota");
    this.writes.push([key, value]);
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function setup(initial?: string) {
  const storage = new MemoryStorage();
  if (initial !== undefined) storage.data.set(CART_STORAGE_KEY, initial);
  let externalListener: (() => void) | null = null;
  const external = { subscribed: 0, unsubscribed: 0 };
  const store = createCartStore({
    storage,
    subscribeExternal: (onChange) => {
      external.subscribed += 1;
      externalListener = onChange;
      return () => {
        external.unsubscribed += 1;
        externalListener = null;
      };
    },
  });
  return { storage, store, external, fireExternal: () => externalListener?.() };
}

const stored = (storage: MemoryStorage): unknown => {
  const text = storage.data.get(CART_STORAGE_KEY);
  return text === undefined ? undefined : JSON.parse(text);
};

describe("TC-PG-CRT-001-421 the store reads the persisted Cart and keeps a stable snapshot (SPEC-050 22, 26.4)", () => {
  it("is an empty ready Cart when the key is absent, and reading writes nothing", () => {
    const { store, storage } = setup();
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
    expect(storage.writes).toEqual([]);
  });

  it("reads an existing Cart", () => {
    const { store } = setup(
      JSON.stringify({ version: 1, lines: [{ kind: "GOODS", goodsRef: GOODS, quantity: 2 }] }),
    );
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [goods(2)] } });
  });

  it("returns the same snapshot object while the stored text is unchanged (useSyncExternalStore)", () => {
    const { store } = setup(JSON.stringify({ version: 1, lines: [] }));
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    const absent = setup().store;
    expect(absent.getSnapshot()).toBe(absent.getSnapshot());
  });

  it("returns a new snapshot after the stored text changes", () => {
    const { store } = setup();
    const before = store.getSnapshot();
    store.add(entry(1));
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after).toEqual({ kind: "ready", cart: { version: 1, lines: [entry(1)] } });
  });

  it("sees a change written by another store on the same storage (another tab)", () => {
    const { storage, store } = setup();
    const other = createCartStore({ storage });
    other.add(goods(3));
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [goods(3)] } });
  });
});

describe("TC-PG-CRT-001-422 a damaged Cart is reported, never emptied, and only reset explicitly (SPEC-050 26.4, Design 4)", () => {
  it.each([
    ["not JSON", "not-json"],
    [
      "a price on a line",
      JSON.stringify({
        version: 1,
        lines: [{ kind: "GOODS", goodsRef: GOODS, quantity: 1, unitPrice: 4000 }],
      }),
    ],
    [
      "a Karaoke line",
      JSON.stringify({ version: 1, lines: [{ kind: "KARAOKE", slotRef: GOODS, quantity: 1 }] }),
    ],
    [
      "a zero quantity",
      JSON.stringify({ version: 1, lines: [{ kind: "GOODS", goodsRef: GOODS, quantity: 0 }] }),
    ],
    ["an unknown version", JSON.stringify({ version: 9, lines: [] })],
  ])("reports corrupted for %s and leaves the stored text alone on read", (_label, text) => {
    const { store, storage } = setup(text);
    expect(store.getSnapshot()).toEqual({ kind: "corrupted" });
    expect(storage.data.get(CART_STORAGE_KEY)).toBe(text);
    expect(storage.writes).toEqual([]);
  });

  it("refuses every change while corrupted and never writes (the damaged text may still be recoverable)", () => {
    const { store, storage } = setup("not-json");
    expect(store.add(entry(1))).toEqual({ kind: "corrupted" });
    expect(store.setQuantity(cartLineKey(entry(1)), 2)).toEqual({ kind: "corrupted" });
    expect(store.remove(cartLineKey(entry(1)))).toEqual({ kind: "corrupted" });
    expect(store.removeLines([cartLineKey(entry(1))])).toEqual({ kind: "corrupted" });
    expect(store.addFromOrder([])).toEqual({ kind: "corrupted" });
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(CART_STORAGE_KEY)).toBe("not-json");
    expect(store.getSnapshot()).toEqual({ kind: "corrupted" });
  });

  it("reset() writes an explicit empty Cart from a corrupted state and notifies subscribers", () => {
    const { store, storage } = setup("not-json");
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.reset()).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(stored(storage)).toEqual({ version: 1, lines: [] });
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
    expect(notified).toBe(1);
  });

  it("an unreadable storage (getItem throws) is corrupted, not an empty Cart", () => {
    const { store, storage } = setup();
    storage.failRead = true;
    expect(store.getSnapshot()).toEqual({ kind: "corrupted" });
  });

  it("reports storage_unavailable when a write fails, keeps the snapshot and does not notify", () => {
    const { store, storage } = setup(JSON.stringify({ version: 1, lines: [] }));
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    storage.failWrite = true;
    expect(store.add(entry(1))).toEqual({ kind: "storage_unavailable" });
    expect(store.reset()).toEqual({ kind: "storage_unavailable" });
    expect(store.getSnapshot()).toBe(before);
    expect(notified).toBe(0);
  });
});

describe("TC-PG-CRT-001-423 operations persist references and quantities only and are business-effect free (FR-CRT-001, 003, BR-ORD-020)", () => {
  it("add persists the line, then sums the same line", () => {
    const { store, storage } = setup();
    expect(store.add(entry(1))).toEqual({ kind: "ok", cart: { version: 1, lines: [entry(1)] } });
    expect(store.add(entry(2))).toEqual({ kind: "ok", cart: { version: 1, lines: [entry(3)] } });
    expect(stored(storage)).toEqual({
      version: 1,
      lines: [{ kind: "ENTRY_TICKET", offeringRef: OFFERING, quantity: 3 }],
    });
  });

  it("writes only to the Cart key, and the stored text contains no price, stock or owner field", () => {
    const { store, storage } = setup();
    store.add(entry(2));
    store.add(goods(1));
    store.setQuantity(cartLineKey(goods(1)), 4);
    expect(storage.writes.every(([key]) => key === CART_STORAGE_KEY)).toBe(true);
    const text = storage.data.get(CART_STORAGE_KEY) ?? "";
    expect(text).not.toMatch(
      /price|amount|currency|JPY|remaining|stock|availability|owner|email|name/i,
    );
  });

  it("setQuantity / remove / removeLines change the persisted Cart", () => {
    const { store, storage } = setup();
    store.add(entry(1));
    store.add(goods(2));
    expect(store.setQuantity(cartLineKey(goods(1)), 5)).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [entry(1), goods(5)] },
    });
    expect(store.remove(cartLineKey(entry(1)))).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [goods(5)] },
    });
    expect(store.removeLines([cartLineKey(goods(1))])).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [] },
    });
    expect(stored(storage)).toEqual({ version: 1, lines: [] });
  });

  it("addFromOrder persists references and quantities from order items and skips Karaoke", () => {
    const { store, storage } = setup();
    const money = { amount: "1000", currency: "JPY" };
    const items: OrderItem[] = [
      {
        kind: "ENTRY_TICKET",
        offeringRef: OFFERING,
        name: "Regular",
        quantity: 2,
        unitPrice: money,
        subtotal: money,
      },
      {
        kind: "GOODS",
        goodsRef: GOODS,
        name: "Towel",
        quantity: 1,
        unitPrice: money,
        subtotal: money,
      },
      {
        kind: "KARAOKE",
        slotRef: "5a000000-0000-4000-8000-000000011000" as Ref<"slot">,
        name: "Karaoke",
        usageStart: "2027-03-08T01:00:00Z" as never,
        usageEnd: "2027-03-08T01:15:00Z" as never,
        quantity: 1,
        unitPrice: money,
        subtotal: money,
      },
    ];
    expect(store.addFromOrder(items)).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [entry(2), goods(1)] },
    });
    expect(storage.data.get(CART_STORAGE_KEY)).not.toMatch(/Regular|Towel|Karaoke|KARAOKE|JPY/);
  });

  it("throws a RangeError for an invalid quantity and writes nothing", () => {
    const { store, storage } = setup();
    store.add(entry(1));
    const writes = storage.writes.length;
    expect(() => store.setQuantity(cartLineKey(entry(1)), 0)).toThrow(RangeError);
    expect(() => store.setQuantity(cartLineKey(entry(1)), 1.5)).toThrow(RangeError);
    expect(() => store.add(entry(0))).toThrow(RangeError);
    expect(storage.writes).toHaveLength(writes);
  });

  it("cannot take a Karaoke line or a price (FR-CRT-002 / 003) even through a type escape", () => {
    const { store, storage } = setup();
    const karaoke = { kind: "KARAOKE", slotRef: GOODS, quantity: 1 } as unknown as CartLine;
    const priced = {
      ...entry(1),
      unitPrice: { amount: "1", currency: "JPY" },
    } as unknown as CartLine;
    expect(() => store.add(karaoke)).toThrow(RangeError);
    expect(() => store.add(priced)).toThrow(RangeError);
    expect(storage.writes).toEqual([]);
  });
});

describe("TC-PG-CRT-001-424 subscribers hear local writes and external changes, and the store never depends on a session (FR-CRT-012)", () => {
  it("notifies after every successful local write, once per write", () => {
    const { store } = setup();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.add(entry(1));
    store.setQuantity(cartLineKey(entry(1)), 2);
    store.remove(cartLineKey(entry(1)));
    expect(notified).toBe(3);
  });

  it("stops notifying after unsubscribe", () => {
    const { store } = setup();
    let notified = 0;
    const off = store.subscribe(() => {
      notified += 1;
    });
    store.add(entry(1));
    off();
    store.add(entry(1));
    expect(notified).toBe(1);
  });

  it("subscribes to the external source on the first listener only and releases it after the last", () => {
    const { store, external } = setup();
    expect(external.subscribed).toBe(0);
    const offA = store.subscribe(() => {});
    const offB = store.subscribe(() => {});
    expect(external.subscribed).toBe(1);
    offA();
    expect(external.unsubscribed).toBe(0);
    offB();
    expect(external.unsubscribed).toBe(1);
  });

  it("notifies every listener when another tab changes the storage", () => {
    const { store, storage, fireExternal } = setup();
    let a = 0;
    let b = 0;
    store.subscribe(() => {
      a += 1;
    });
    store.subscribe(() => {
      b += 1;
    });
    storage.data.set(
      CART_STORAGE_KEY,
      JSON.stringify({ version: 1, lines: [{ kind: "GOODS", goodsRef: GOODS, quantity: 6 }] }),
    );
    fireExternal();
    expect([a, b]).toEqual([1, 1]);
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [goods(6)] } });
  });

  it("does not notify for a refused change (corrupted)", () => {
    const { store } = setup("not-json");
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.add(entry(1));
    expect(notified).toBe(0);
  });
});
