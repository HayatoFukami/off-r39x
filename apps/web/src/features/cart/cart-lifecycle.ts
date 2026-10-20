import { z } from "zod";
import { CART_STORAGE_KEY } from "./cart-count";
import { type CartStorage, type CartStore, getBrowserCartStore } from "./cart-store";

export const CART_LIFECYCLE_STORAGE_KEY = "r39x.cart-lifecycle.v1";

export type CartProvenance = "guest" | "authenticated" | "unknown";
export type CartLifecycleSnapshot = { kind: "ready" } | { kind: "blocked" };
const READY: CartLifecycleSnapshot = { kind: "ready" };
const BLOCKED: CartLifecycleSnapshot = { kind: "blocked" };

const metadataSchema = z.union([
  z.strictObject({ version: z.literal(1), provenance: z.enum(["guest", "authenticated"]) }),
  z.strictObject({
    version: z.literal(1),
    provenance: z.enum(["guest", "authenticated", "unknown"]),
    transitioning: z.literal(true),
  }),
]);
type Metadata = z.infer<typeof metadataSchema>;
const isTransitioning = (metadata: Metadata | null): boolean =>
  metadata !== null && "transitioning" in metadata;

export interface CartLifecycle {
  initializeGuestIfEmpty(sessionKind?: "guest" | "authenticated"): void;
  markAuthenticated(): void;
  beginTransition(): { kind: "ready"; provenance: CartProvenance } | { kind: "blocked" };
  finishLogin(provenance: CartProvenance): void;
  abortTransition(provenance: CartProvenance): void;
  finishLogout(): void;
  expireAuthenticatedCart(): boolean;
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
    const parsed = metadataSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
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
    notify();
  };
  const clearCart = (): void => {
    if (cart.clear().kind !== "ok") throw new Error("Cart storage unavailable");
  };

  return {
    initializeGuestIfEmpty(sessionKind = "guest") {
      if (blocked) return;
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
      if (blocked) return;
      try {
        const metadata = readMetadata(storage);
        // Another tab may still be settling authentication. Only completion or recovery releases it.
        if (isTransitioning(metadata)) return;
        if (metadata?.provenance === "authenticated") return;
        if (metadata?.provenance !== "guest") clearCart();
        write("authenticated");
      } catch {
        blocked = true;
        notify();
      }
    },
    beginTransition() {
      if (blocked) return { kind: "blocked" };
      try {
        const metadata = readMetadata(storage);
        if (isTransitioning(metadata)) return { kind: "blocked" };
        const provenance = metadata?.provenance ?? "unknown";
        write(provenance, true);
        return { kind: "ready", provenance };
      } catch {
        blocked = true;
        notify();
        return { kind: "blocked" };
      }
    },
    finishLogin(provenance) {
      if (blocked) return;
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
      if (blocked) return;
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
      if (blocked) return false;
      try {
        const metadata = readMetadata(storage);
        if (isTransitioning(metadata)) return false;
        if (metadata?.provenance === "guest") return true;
        clearCart();
        write("guest");
        return true;
      } catch {
        blocked = true;
        notify();
        return false;
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
        blocked = false;
        notify();
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
        return isTransitioning(metadata) ? BLOCKED : READY;
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
