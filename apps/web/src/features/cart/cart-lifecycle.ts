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

// FR-CRT-012 external-completion record: `pending` from the start of an external sign-in, `superseded`
// once another method established a Session while it was pending. It holds no Account information. The record
// also rides on a Cart of unknown provenance, and only then is a non-transition `provenance: "unknown"` stored.
const externalSchema = z.enum(["pending", "superseded"]);
type ExternalRecord = z.infer<typeof externalSchema>;

const metadataSchema = z.union([
  z.strictObject({
    version: z.literal(1),
    provenance: z.enum(["guest", "authenticated"]),
    external: externalSchema.optional(),
  }),
  z.strictObject({
    version: z.literal(1),
    provenance: z.literal("unknown"),
    external: externalSchema,
  }),
  z.strictObject({
    version: z.literal(1),
    provenance: z.enum(["guest", "authenticated", "unknown"]),
    transitioning: z.literal(true),
    external: externalSchema.optional(),
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
  /**
   * The start of an external-completion sign-in (FR-CRT-012 external completion rule steps 2-4): cleans
   * the Cart by provenance, then records `pending`. It is not a transition: nothing stays in flight.
   */
  beginExternalAuthentication(lockAcquired?: boolean): CartLifecycleSnapshot;
  /**
   * The screen shown by the return of an external sign-in received a Session (steps 6 and 9). Decides on
   * the metadata read when this lifecycle was created, once. Never throws.
   */
  completeExternalAuthentication(): void;
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
  // Steps 6 and 9 decide on the metadata as it was when this document's lifecycle was created, not on
  // what a later Session observation wrote. An unreadable or invalid value is of unknown provenance.
  let initialMetadata: Metadata | null = null;
  try {
    initialMetadata = parseMetadata(storage.getItem(CART_LIFECYCLE_STORAGE_KEY));
  } catch {
    initialMetadata = null;
  }
  let externalCompleted = false;

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
  const write = (
    provenance: CartProvenance,
    options: { transitioning?: boolean; external?: ExternalRecord | undefined } = {},
  ): void => {
    const { transitioning = false, external } = options;
    if (provenance === "unknown" && !transitioning && external === undefined) {
      storage.removeItem(CART_LIFECYCLE_STORAGE_KEY);
    } else {
      storage.setItem(
        CART_LIFECYCLE_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          provenance,
          ...(transitioning ? { transitioning: true } : {}),
          ...(external === undefined ? {} : { external }),
        }),
      );
    }
    cachedMetadata = null;
    notify();
  };
  // The record that is stored now; a metadata that cannot be read has none to keep.
  const currentExternal = (): ExternalRecord | undefined => {
    try {
      return readMetadata()?.external;
    } catch {
      return undefined;
    }
  };
  const clearCart = (): void => {
    if (cart.clear().kind !== "ok") throw new Error("Cart storage unavailable");
  };
  /**
   * FR-CRT-012: a Cart that cannot be read safely stops the Cart, whatever the metadata says. The store
   * reports a getItem throw as `corrupted`; the lifecycle treats it as a stop. Reads only (the value is
   * not used or kept); a throw is handled by the caller like a metadata fault.
   */
  const assertCartReadable = (): void => {
    storage.getItem(CART_STORAGE_KEY);
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
        assertCartReadable();
        const metadata = readMetadata();
        // The non-transition unknown form (it only carries a record) is read like a missing key.
        const unknownForm =
          metadata !== null && metadata.provenance === "unknown" && !isTransitioning(metadata);
        if (metadata !== null && !unknownForm) return;
        const rawCart = storage.getItem(CART_STORAGE_KEY);
        if (rawCart !== null) return;
        write("guest", { external: metadata?.external });
      } catch {
        blocked = true;
        notify();
      }
    },
    markAuthenticated() {
      if (blocked) return;
      try {
        assertCartReadable();
        const metadata = readMetadata();
        if (isTransitioning(metadata)) {
          reconcileTransition();
          return;
        }
        if (metadata?.provenance === "authenticated") return;
        if (metadata?.provenance !== "guest") clearCart();
        // An observation never resolves the external-completion record (steps 6 and 9).
        write("authenticated", { external: metadata?.external });
      } catch {
        blocked = true;
        notify();
      }
    },
    beginTransition(lockAcquired = false) {
      if (blocked || orphanedTransition) return { kind: "blocked" };
      if (localTransition || externalTransition) return { kind: "busy" };
      try {
        assertCartReadable();
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
        if (coordinator.crossTab)
          write(provenance, { transitioning: true, external: metadata?.external });
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
      // Step 5: while a record exists, another method's success turns it into `superseded`, even when the
      // Cart cannot be cleared or the lifecycle is already stopped (the result is then judged by it).
      if (blocked) {
        try {
          const metadata = readMetadata();
          if (metadata?.external !== undefined) {
            write(metadata.provenance, {
              transitioning: isTransitioning(metadata),
              external: "superseded",
            });
          }
        } catch {
          // Metadata that cannot be written cannot record anything; the lifecycle stays stopped.
        }
        return;
      }
      let recorded: ExternalRecord | undefined;
      try {
        recorded = currentExternal();
        if (provenance !== "guest") clearCart();
        write("authenticated", { external: recorded === undefined ? undefined : "superseded" });
        localTransition = false;
        externalTransition = false;
        orphanedTransition = false;
        notify();
      } catch (error) {
        blocked = true;
        localTransition = false;
        if (recorded !== undefined) {
          try {
            write(provenance, { external: "superseded" });
          } catch {
            // The original error is the one reported.
          }
        }
        notify();
        throw error;
      }
    },
    abortTransition(provenance) {
      if (blocked) return;
      try {
        write(provenance, { external: currentExternal() });
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
        write("guest", { external: metadata?.external });
        return "done";
      } catch {
        blocked = true;
        notify();
        return "blocked";
      }
    },
    beginExternalAuthentication(lockAcquired = false) {
      if (blocked || orphanedTransition) return BLOCKED;
      if (localTransition || externalTransition) return BUSY;
      try {
        assertCartReadable();
        const metadata = readMetadata();
        if (isTransitioning(metadata)) {
          if (lockAcquired) {
            orphanedTransition = true;
            notify();
            return BLOCKED;
          }
          if (coordinator.crossTab) {
            reconcileTransition();
            return BUSY;
          }
          orphanedTransition = true;
          notify();
          return BLOCKED;
        }
        // Step 2: a Cart of unknown or authenticated provenance is cleared first; a Guest Cart is kept.
        // Step 3: only after that, and before the request, the record is written (replacing any record).
        if (metadata?.provenance !== "guest") clearCart();
        write("guest", { external: "pending" });
        return READY;
      } catch {
        blocked = true;
        notify();
        return BLOCKED;
      }
    },
    completeExternalAuthentication() {
      // One receipt per return: the lifecycle of one document is created once per return.
      if (externalCompleted) return;
      externalCompleted = true;
      if (blocked || orphanedTransition) return;
      try {
        const external = initialMetadata?.external;
        // Step 6: with a record, `superseded` (another method succeeded) clears and `pending` keeps.
        // Step 9: without one, the provenance before this return decides.
        const keep =
          external === undefined ? initialMetadata?.provenance === "guest" : external === "pending";
        if (!keep) clearCart();
        write("authenticated");
      } catch {
        blocked = true;
        notify();
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
        const recorded = currentExternal();
        clearCart();
        write(provenance, { external: recorded });
        assertCartReadable();
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
        assertCartReadable();
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
    const coordinator = getBrowserCartTransitionCoordinator(() => {
      const raw = storage.getItem(CART_LIFECYCLE_STORAGE_KEY);
      const metadata = parseMetadata(raw);
      return raw === null || (metadata !== null && !isTransitioning(metadata));
    });
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
