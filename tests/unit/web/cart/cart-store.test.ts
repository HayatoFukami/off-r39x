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
  failRemove = false;
  readonly removals: string[] = [];
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
    if (this.failRemove) throw new Error("storage remove blocked");
    this.removals.push(key);
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

describe("TC-PG-CRT-001-425 an add that overflows the quantity is reported as quantity_overflow and changes nothing (SPEC-050 9.3, FR-CRT-001)", () => {
  const FULL = JSON.stringify({
    version: 1,
    lines: [{ kind: "ENTRY_TICKET", offeringRef: OFFERING, quantity: Number.MAX_SAFE_INTEGER }],
  });
  const item = (quantity: number): Extract<OrderItem, { kind: "ENTRY_TICKET" }> => {
    const money = { amount: "1000", currency: "JPY" };
    return {
      kind: "ENTRY_TICKET",
      offeringRef: OFFERING,
      name: "Regular",
      quantity,
      unitPrice: money,
      subtotal: money,
    };
  };

  it("add() returns quantity_overflow without writing, notifying or replacing the snapshot", () => {
    const { store, storage } = setup(FULL);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    expect(store.add(entry(1))).toEqual({ kind: "quantity_overflow" });
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(CART_STORAGE_KEY)).toBe(FULL);
    expect(notified).toBe(0);
    expect(store.getSnapshot()).toBe(before);
  });

  it("addFromOrder() returns quantity_overflow the same way", () => {
    const { store, storage } = setup(FULL);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    expect(store.addFromOrder([item(1)])).toEqual({ kind: "quantity_overflow" });
    expect(storage.writes).toEqual([]);
    expect(notified).toBe(0);
    expect(store.getSnapshot()).toBe(before);
  });

  it("aborts the whole addFromOrder when a later item overflows (nothing is written)", () => {
    const { store, storage } = setup(FULL);
    expect(
      store.addFromOrder([
        { ...item(1), offeringRef: "e0000000-0000-4000-8000-000000000099" as Ref<"offering"> },
        item(1),
      ]),
    ).toEqual({
      kind: "quantity_overflow",
    });
    expect(storage.writes).toEqual([]);
  });

  it("a Cart that is not full still adds up to the largest safe quantity", () => {
    const { store } = setup(
      JSON.stringify({
        version: 1,
        lines: [
          { kind: "ENTRY_TICKET", offeringRef: OFFERING, quantity: Number.MAX_SAFE_INTEGER - 1 },
        ],
      }),
    );
    expect(store.add(entry(1))).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [entry(Number.MAX_SAFE_INTEGER)] },
    });
  });

  it("a damaged Cart is reported as corrupted before anything is computed", () => {
    const { store, storage } = setup("not-json");
    expect(store.add(entry(1))).toEqual({ kind: "corrupted" });
    expect(store.addFromOrder([item(1)])).toEqual({ kind: "corrupted" });
    expect(storage.writes).toEqual([]);
  });

  it("an invalid line still throws a RangeError that is not a quantity_overflow result", () => {
    const { store, storage } = setup(FULL);
    expect(() => store.add(entry(0))).toThrow(RangeError);
    expect(() => store.add({ ...entry(1), unitPrice: 1 } as unknown as CartLine)).toThrow(
      RangeError,
    );
    expect(storage.writes).toEqual([]);
  });
});

describe("TC-PG-CRT-001-426 clear() removes the stored Cart whatever its state, and a failed removal is reported without a change (FR-CRT-012, AR-SES-009, UF-AUTH-004)", () => {
  it("removes the key, leaves a ready empty snapshot, notifies once and writes nothing", () => {
    const { store, storage } = setup(
      JSON.stringify({ version: 1, lines: [{ kind: "GOODS", goodsRef: GOODS, quantity: 2 }] }),
    );
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [goods(2)] } });
    expect(store.clear()).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(storage.removals).toEqual([CART_STORAGE_KEY]);
    expect(storage.writes).toEqual([]);
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
    expect(notified).toBe(1);
  });

  it("succeeds on a damaged Cart (a damaged Cart is removed by Logout, never reported as corrupted)", () => {
    const { store, storage } = setup("not-json");
    expect(store.getSnapshot()).toEqual({ kind: "corrupted" });
    expect(store.clear()).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
  });

  it("succeeds on an unreadable storage as long as removal works (it does not read the snapshot)", () => {
    const { store, storage } = setup("not-json");
    storage.failRead = true;
    expect(store.clear()).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
  });

  it("clearing an absent Cart is an ok empty Cart", () => {
    const { store, storage } = setup();
    expect(store.clear()).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
  });

  it("a Cart added after clear() starts from empty", () => {
    const { store } = setup(JSON.stringify({ version: 1, lines: [entry(3)] }));
    store.clear();
    expect(store.add(goods(1))).toEqual({ kind: "ok", cart: { version: 1, lines: [goods(1)] } });
  });

  it("reports storage_unavailable when removal throws, keeps the stored Cart and snapshot and does not notify", () => {
    const text = JSON.stringify({ version: 1, lines: [entry(2)] });
    const { store, storage } = setup(text);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    storage.failRemove = true;
    expect(store.clear()).toEqual({ kind: "storage_unavailable" });
    expect(storage.data.get(CART_STORAGE_KEY)).toBe(text);
    expect(store.getSnapshot()).toBe(before);
    expect(notified).toBe(0);
  });

  it("is seen by another store on the same storage (another tab)", () => {
    const { storage, store } = setup(JSON.stringify({ version: 1, lines: [goods(3)] }));
    const other = createCartStore({ storage });
    expect(other.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [goods(3)] } });
    store.clear();
    expect(other.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
  });
});

describe("TC-PG-CRT-001-427 subtractLines on the store subtracts the ordered quantity from the latest persisted Cart in one write (FR-CRT-011, FR-CRT-012, SPEC-050 14A.1)", () => {
  const persisted = (...lines: CartLine[]): string => JSON.stringify({ version: 1, lines });

  it("persists the remainder with one write and one notification", () => {
    const { store, storage } = setup(persisted(entry(2), goods(1)));
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.getSnapshot();
    expect(store.subtractLines([entry(1), goods(1)])).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [entry(1)] },
    });
    expect(storage.writes).toHaveLength(1);
    expect(stored(storage)).toEqual({ version: 1, lines: [entry(1)] });
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [entry(1)] } });
  });

  it("applies to what another store (another tab) saved last, whether it raised a line or added one", () => {
    const { store, storage } = setup(persisted(entry(1)));
    expect(store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [entry(1)] } });
    const other = createCartStore({ storage });
    other.getSnapshot();
    other.setQuantity(cartLineKey(entry(1)), 3);
    other.add(goods(2));
    expect(store.subtractLines([entry(1)])).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [entry(2), goods(2)] },
    });
    expect(stored(storage)).toEqual({ version: 1, lines: [entry(2), goods(2)] });
  });

  it("does not write or notify when nothing changes, and keeps an absent key absent", () => {
    const { store, storage } = setup();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.subtractLines([entry(1)])).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [] },
    });
    expect(store.subtractLines([])).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(storage.writes).toEqual([]);
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(notified).toBe(0);
  });

  it("does not write or notify when the ordered key is not in a stored Cart", () => {
    const text = persisted(goods(2));
    const { store, storage } = setup(text);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.subtractLines([entry(1)])).toEqual({
      kind: "ok",
      cart: { version: 1, lines: [goods(2)] },
    });
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(CART_STORAGE_KEY)).toBe(text);
    expect(notified).toBe(0);
  });

  it("reports corrupted without writing, notifying or changing the stored text", () => {
    const { store, storage } = setup("not-json");
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.subtractLines([entry(1)])).toEqual({ kind: "corrupted" });
    expect(storage.writes).toEqual([]);
    expect(storage.removals).toEqual([]);
    expect(storage.data.get(CART_STORAGE_KEY)).toBe("not-json");
    expect(notified).toBe(0);
  });

  it("reports storage_unavailable when the write throws, without notifying or changing anything", () => {
    const text = persisted(entry(2));
    const { store, storage } = setup(text);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    storage.failWrite = true;
    expect(store.subtractLines([entry(1)])).toEqual({ kind: "storage_unavailable" });
    expect(storage.data.get(CART_STORAGE_KEY)).toBe(text);
    expect(store.getSnapshot()).toBe(before);
    expect(notified).toBe(0);
  });
});
