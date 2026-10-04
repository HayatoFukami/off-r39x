import type { CartLine, OrderItem } from "../../api-client/types";
import { CART_STORAGE_KEY } from "./cart-count";
import {
  addFromOrder,
  addLine,
  type Cart,
  EMPTY_CART,
  parseCart,
  removeLine,
  removeLines,
  serializeCart,
  setLineQuantity,
} from "./cart-model";

// Browser Cart store (SPEC-050 14A.1 Cartの保持, 22, 26.4). The persisted text is the only state; the
// store never writes a damaged Cart over (it may still be recoverable) and never reports a write that
// did not happen. It has no business effect (FR-CRT-001, BR-ORD-020) and knows no account (FR-CRT-012).

export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CartSnapshot =
  | { readonly kind: "ready"; readonly cart: Cart }
  | { readonly kind: "corrupted" };

export type CartWriteResult =
  | { kind: "ok"; cart: Cart }
  | { kind: "corrupted" }
  | { kind: "storage_unavailable" };

export interface CartStore {
  getSnapshot(): CartSnapshot;
  subscribe(listener: () => void): () => void;
  add(line: CartLine): CartWriteResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartWriteResult;
  reset(): CartWriteResult;
}

export type CartStoreDeps = {
  storage: CartStorage;
  subscribeExternal?: (onChange: () => void) => () => void;
};

const CORRUPTED: CartSnapshot = { kind: "corrupted" };

export function createCartStore(deps: CartStoreDeps): CartStore {
  const { storage } = deps;
  const listeners = new Set<() => void>();
  let releaseExternal: (() => void) | null = null;
  // `undefined` = unreadable. The snapshot is rebuilt only when the stored text changes.
  let cache: { raw: string | null | undefined; snapshot: CartSnapshot } | null = null;

  function readRaw(): string | null | undefined {
    try {
      return storage.getItem(CART_STORAGE_KEY);
    } catch {
      return undefined;
    }
  }

  function getSnapshot(): CartSnapshot {
    const raw = readRaw();
    if (cache !== null && cache.raw === raw) return cache.snapshot;
    let snapshot: CartSnapshot = CORRUPTED;
    if (raw !== undefined) {
      const load = parseCart(raw);
      snapshot = load.kind === "ok" ? { kind: "ready", cart: load.cart } : CORRUPTED;
    }
    cache = { raw, snapshot };
    return snapshot;
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function write(cart: Cart): CartWriteResult {
    try {
      storage.setItem(CART_STORAGE_KEY, serializeCart(cart));
    } catch {
      return { kind: "storage_unavailable" };
    }
    notify();
    return { kind: "ok", cart };
  }

  function change(update: (cart: Cart) => Cart): CartWriteResult {
    const snapshot = getSnapshot();
    if (snapshot.kind === "corrupted") return { kind: "corrupted" };
    return write(update(snapshot.cart));
  }

  return {
    getSnapshot,
    subscribe(listener) {
      const entry = (): void => listener();
      listeners.add(entry);
      if (listeners.size === 1 && deps.subscribeExternal !== undefined) {
        releaseExternal = deps.subscribeExternal(notify);
      }
      return () => {
        if (!listeners.delete(entry)) return;
        if (listeners.size === 0 && releaseExternal !== null) {
          releaseExternal();
          releaseExternal = null;
        }
      };
    },
    add: (line) => change((cart) => addLine(cart, line)),
    setQuantity: (lineKey, quantity) => change((cart) => setLineQuantity(cart, lineKey, quantity)),
    remove: (lineKey) => change((cart) => removeLine(cart, lineKey)),
    removeLines: (lineKeys) => change((cart) => removeLines(cart, lineKeys)),
    addFromOrder: (items) => change((cart) => addFromOrder(cart, items)),
    reset: () => write(EMPTY_CART),
  };
}

let browserStore: CartStore | null = null;

/** One store per tab, so that the Header and the Cart page update at once (`storage` events skip the writing tab). */
export function getBrowserCartStore(): CartStore | null {
  if (browserStore !== null) return browserStore;
  if (typeof window === "undefined") return null;
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return null;
  }
  browserStore = createCartStore({
    storage,
    subscribeExternal: (onChange) => {
      const handler = (event: StorageEvent): void => {
        if (event.key === CART_STORAGE_KEY || event.key === null) onChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  });
  return browserStore;
}
