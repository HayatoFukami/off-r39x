import { CART_STORAGE_KEY } from "./cart-count";
import { type CartStorage, type CartStore, getBrowserCartStore } from "./cart-store";

export const CART_LIFECYCLE_STORAGE_KEY = "r39x.cart-lifecycle.v1";

export type CartProvenance = "guest" | "authenticated" | "unknown";
export type CartLifecycleSnapshot = { kind: "ready" } | { kind: "blocked" };
const READY: CartLifecycleSnapshot = { kind: "ready" };
const BLOCKED: CartLifecycleSnapshot = { kind: "blocked" };

type Metadata = { version: 1; provenance: CartProvenance; transitioning?: true };

export interface CartLifecycle {
  initializeGuestIfEmpty(sessionKind?: "guest" | "authenticated"): void;
  markAuthenticated(): void;
  beginTransition(): CartProvenance;
  finishLogin(provenance: CartProvenance): void;
  abortTransition(provenance: CartProvenance): void;
  finishLogout(): void;
  expireAuthenticatedCart(): void;
  block(): void;
  recover(provenance: CartProvenance): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CartLifecycleSnapshot;
}

function readMetadata(storage: CartStorage): Metadata | null {
  const raw = storage.getItem(CART_LIFECYCLE_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const data = value as Record<string, unknown>;
    if (data.version !== 1) return null;
    if (
      data.provenance !== "guest" &&
      data.provenance !== "authenticated" &&
      !(data.provenance === "unknown" && data.transitioning === true)
    )
      return null;
    if (data.transitioning !== undefined && data.transitioning !== true) return null;
    return data.transitioning === true
      ? { version: 1, provenance: data.provenance, transitioning: true }
      : { version: 1, provenance: data.provenance };
  } catch {
    return null;
  }
}

export function createCartLifecycle(
  storage: CartStorage,
  cart: CartStore,
  subscribeExternal?: (onChange: () => void) => () => void,
): CartLifecycle {
  const listeners = new Set<() => void>();
  let blocked = false;
  let releaseExternal: (() => void) | null = null;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const write = (provenance: CartProvenance, transitioning = false): void => {
    if (provenance === "unknown" && !transitioning) {
      storage.removeItem(CART_LIFECYCLE_STORAGE_KEY);
    } else {
      storage.setItem(
        CART_LIFECYCLE_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          provenance,
          ...(transitioning ? { transitioning: true } : {}),
        }),
      );
    }
    blocked = transitioning;
    notify();
  };
  const clearCart = (): void => {
    if (cart.clear().kind !== "ok") throw new Error("Cart storage unavailable");
  };

  return {
    initializeGuestIfEmpty(sessionKind = "guest") {
      try {
        if (readMetadata(storage) !== null) return;
        const rawCart = storage.getItem(CART_STORAGE_KEY);
        if (rawCart !== null) return;
        write(sessionKind);
      } catch {
        blocked = true;
        notify();
      }
    },
    markAuthenticated() {
      try {
        const metadata = readMetadata(storage);
        if (metadata?.provenance === "guest" && !metadata.transitioning) write("authenticated");
        else this.initializeGuestIfEmpty("authenticated");
      } catch {
        blocked = true;
        notify();
      }
    },
    beginTransition() {
      let provenance: CartProvenance = "unknown";
      try {
        const metadata = readMetadata(storage);
        if (metadata !== null)
          provenance = metadata.transitioning ? "unknown" : metadata.provenance;
        write(provenance, true);
      } catch {
        blocked = true;
        notify();
      }
      return provenance;
    },
    finishLogin(provenance) {
      try {
        if (provenance !== "guest") clearCart();
        write("authenticated");
      } catch (error) {
        blocked = true;
        notify();
        throw error;
      }
    },
    abortTransition(provenance) {
      try {
        write(provenance);
      } catch {
        blocked = true;
        notify();
      }
    },
    finishLogout() {
      try {
        clearCart();
        write("guest");
      } catch (error) {
        blocked = true;
        notify();
        throw error;
      }
    },
    expireAuthenticatedCart() {
      try {
        if (readMetadata(storage)?.provenance !== "authenticated") return;
        clearCart();
        write("guest");
      } catch {
        blocked = true;
        notify();
      }
    },
    block() {
      blocked = true;
      notify();
    },
    recover(provenance) {
      try {
        clearCart();
        write(provenance);
        return true;
      } catch {
        blocked = true;
        notify();
        return false;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && subscribeExternal !== undefined) {
        releaseExternal = subscribeExternal(notify);
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0 && releaseExternal !== null) {
          releaseExternal();
          releaseExternal = null;
        }
      };
    },
    getSnapshot() {
      if (blocked) return BLOCKED;
      try {
        const metadata = readMetadata(storage);
        return metadata?.transitioning ? BLOCKED : READY;
      } catch {
        blocked = true;
        return BLOCKED;
      }
    },
  };
}

let browserLifecycle: CartLifecycle | null = null;

export function getBrowserCartLifecycle(): CartLifecycle | null {
  if (browserLifecycle !== null) return browserLifecycle;
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const store = getBrowserCartStore();
    if (store === null) return null;
    const lifecycle = createCartLifecycle(storage, store, (onChange) => {
      const handler = (event: StorageEvent): void => {
        if (event.key === CART_LIFECYCLE_STORAGE_KEY || event.key === null) onChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    });
    browserLifecycle = lifecycle;
    return browserLifecycle;
  } catch {
    return null;
  }
}
