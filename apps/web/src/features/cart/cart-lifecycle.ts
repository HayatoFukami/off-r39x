import { z } from "zod";
import { CART_STORAGE_KEY } from "./cart-count";
import { type CartStorage, type CartStore, getBrowserCartStore } from "./cart-store";
import {
  type CartTransitionCoordinator,
  createMemoryCartTransitionCoordinator,
  getBrowserCartTransitionCoordinator,
} from "./cart-transition-lock";

export const CART_LIFECYCLE_STORAGE_KEY = "r39x.cart-lifecycle.v1";

export type CartProvenance = "guest" | "authenticated" | "unknown";
export type CartLifecycleSnapshot = { kind: "ready" } | { kind: "busy" } | { kind: "blocked" };
export type CartLifecycleResult = "done" | "busy" | "blocked";
export type CartRecoveryResult = "recovered" | "busy" | "failed";
const READY: CartLifecycleSnapshot = { kind: "ready" };
const BUSY: CartLifecycleSnapshot = { kind: "busy" };
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
  initializeGuestIfEmpty(): void;
  markAuthenticated(): void;
  beginTransition(
    lockAcquired?: boolean,
  ): { kind: "ready"; provenance: CartProvenance } | { kind: "busy" } | { kind: "blocked" };
  finishLogin(provenance: CartProvenance): void;
  abortTransition(provenance: CartProvenance): void;
  finishLogout(): void;
  expireAuthenticatedCart(): CartLifecycleResult;
  block(): void;
  recover(provenance: CartProvenance): Promise<CartRecoveryResult>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CartLifecycleSnapshot;
}

function parseMetadata(raw: string | null): Metadata | null {
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
  coordinator: CartTransitionCoordinator = createMemoryCartTransitionCoordinator(),
): CartLifecycle {
  const listeners = new Set<() => void>();
  let blocked = false;
  let localTransition = false;
  let externalTransition = false;
  let orphanedTransition = false;
  let releaseExternal: (() => void) | null = null;
  let releaseCoordinator: (() => void) | null = null;
  let cachedMetadata: { raw: string | null; value: Metadata | null } | null = null;
  let transitionProbe: Promise<void> | null = null;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const readMetadata = (): Metadata | null => {
    const raw = storage.getItem(CART_LIFECYCLE_STORAGE_KEY);
    if (cachedMetadata !== null && cachedMetadata.raw === raw) return cachedMetadata.value;
    const value = parseMetadata(raw);
    cachedMetadata = { raw, value };
    return value;
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
    cachedMetadata = null;
    notify();
  };
  const clearCart = (): void => {
    if (cart.clear().kind !== "ok") throw new Error("Cart storage unavailable");
  };

  const reconcileTransition = (): void => {
    if (localTransition || blocked) return;
    let metadata: Metadata | null;
    try {
      metadata = readMetadata();
    } catch {
      blocked = true;
      notify();
      return;
    }
    if (!isTransitioning(metadata)) {
      externalTransition = false;
      orphanedTransition = false;
      notify();
      return;
    }
    if (!coordinator.crossTab) {
      externalTransition = false;
      orphanedTransition = true;
      notify();
      return;
    }
    if (transitionProbe !== null) return;
    transitionProbe = coordinator
      .isHeld()
      .then((held) => {
        const latestMetadata = readMetadata();
        if (!isTransitioning(latestMetadata)) {
          externalTransition = false;
          orphanedTransition = false;
        } else {
          externalTransition = held;
          orphanedTransition = !held;
        }
        notify();
      })
      .catch(() => {
        blocked = true;
        notify();
      })
      .finally(() => {
        transitionProbe = null;
      });
  };

  return {
    initializeGuestIfEmpty() {
      if (blocked) return;
      try {
        if (readMetadata() !== null) return;
        const rawCart = storage.getItem(CART_STORAGE_KEY);
        if (rawCart !== null) return;
        write("guest");
      } catch {
        blocked = true;
        notify();
      }
    },
    markAuthenticated() {
      if (blocked) return;
      try {
        const metadata = readMetadata();
        if (isTransitioning(metadata)) {
          reconcileTransition();
          return;
        }
        if (metadata?.provenance === "authenticated") return;
        if (metadata?.provenance !== "guest") clearCart();
        write("authenticated");
      } catch {
        blocked = true;
        notify();
      }
    },
    beginTransition(lockAcquired = false) {
      if (blocked || orphanedTransition) return { kind: "blocked" };
      if (localTransition || externalTransition) return { kind: "busy" };
      try {
        const metadata = readMetadata();
        if (isTransitioning(metadata)) {
          if (lockAcquired) {
            orphanedTransition = true;
            notify();
            return { kind: "blocked" };
          }
          if (coordinator.crossTab) {
            reconcileTransition();
            return { kind: "busy" };
          }
          orphanedTransition = true;
          notify();
          return { kind: "blocked" };
        }
        const provenance = metadata?.provenance ?? "unknown";
        localTransition = true;
        externalTransition = false;
        orphanedTransition = false;
        // Without Web Locks, transition ownership is intentionally memory-only.
        if (coordinator.crossTab) write(provenance, true);
        else notify();
        return { kind: "ready", provenance };
      } catch {
        localTransition = false;
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
        localTransition = false;
        externalTransition = false;
        orphanedTransition = false;
        notify();
      } catch (error) {
        blocked = true;
        localTransition = false;
        notify();
        throw error;
      }
    },
    abortTransition(provenance) {
      if (blocked) return;
      try {
        write(provenance);
        localTransition = false;
        externalTransition = false;
        orphanedTransition = false;
        notify();
      } catch {
        localTransition = false;
        blocked = true;
        notify();
      }
    },
    finishLogout() {
      try {
        clearCart();
        write("guest");
        blocked = false;
        localTransition = false;
        externalTransition = false;
        orphanedTransition = false;
      } catch (error) {
        blocked = true;
        localTransition = false;
        notify();
        throw error;
      }
    },
    expireAuthenticatedCart() {
      if (blocked || orphanedTransition) return "blocked";
      if (localTransition || externalTransition) return "busy";
      try {
        const metadata = readMetadata();
        if (isTransitioning(metadata)) {
          reconcileTransition();
          return coordinator.crossTab ? "busy" : "blocked";
        }
        if (metadata?.provenance === "guest") return "done";
        clearCart();
        write("guest");
        return "done";
      } catch {
        blocked = true;
        notify();
        return "blocked";
      }
    },
    block() {
      blocked = true;
      notify();
    },
    async recover(provenance) {
      const lock = await coordinator.acquire();
      if (lock.kind === "busy") return "busy";
      if (lock.kind === "unavailable") return "failed";
      try {
        if (localTransition || externalTransition) return "busy";
        clearCart();
        write(provenance);
        blocked = false;
        localTransition = false;
        externalTransition = false;
        orphanedTransition = false;
        notify();
        return "recovered";
      } catch {
        blocked = true;
        notify();
        return "failed";
      } finally {
        lock.release();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const externalStop = subscribeExternal?.(() => {
          notify();
          reconcileTransition();
        });
        const coordinatorStop = coordinator.subscribe(() => reconcileTransition());
        releaseExternal = () => externalStop?.();
        releaseCoordinator = coordinatorStop;
        reconcileTransition();
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) {
          releaseExternal?.();
          releaseExternal = null;
          releaseCoordinator?.();
          releaseCoordinator = null;
        }
      };
    },
    getSnapshot() {
      if (blocked || orphanedTransition) return BLOCKED;
      try {
        const metadata = readMetadata();
        if (isTransitioning(metadata) && !coordinator.crossTab && !localTransition) {
          orphanedTransition = true;
          return BLOCKED;
        }
        if (localTransition || externalTransition || isTransitioning(metadata)) return BUSY;
        return READY;
      } catch {
        blocked = true;
        return BLOCKED;
      }
    },
  };
}

// undefined = not initialized, null = initial Browser storage acquisition failed.
// Keep that failure for this document: Auth may already be running without Cart decoration.
let browserLifecycle: CartLifecycle | null | undefined;

export function getBrowserCartLifecycle(): CartLifecycle | null {
  if (typeof window === "undefined") return null;
  if (browserLifecycle === undefined) browserLifecycle = createBrowserCartLifecycle();
  return browserLifecycle;
}

/** Initial denial recovery is private until reload reinitializes Auth and Cart together. */
export async function recoverBrowserCartLifecycle(
  provenance: CartProvenance,
): Promise<CartRecoveryResult> {
  const lifecycle = getBrowserCartLifecycle() ?? createBrowserCartLifecycle();
  return lifecycle === null ? "failed" : lifecycle.recover(provenance);
}

function createBrowserCartLifecycle(): CartLifecycle | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const store = getBrowserCartStore();
    if (store === null) return null;
    const coordinator = getBrowserCartTransitionCoordinator();
    if (coordinator === null) return null;
    return createCartLifecycle(
      storage,
      store,
      (onChange) => {
        const handler = (event: StorageEvent): void => {
          if (event.key === CART_LIFECYCLE_STORAGE_KEY || event.key === null) onChange();
        };
        const refresh = (): void => onChange();
        window.addEventListener("storage", handler);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
          window.removeEventListener("storage", handler);
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", refresh);
        };
      },
      coordinator,
    );
  } catch {
    return null;
  }
}
