export const CART_TRANSITION_LOCK_NAME = "r39x.cart-auth-transition.v1";

export type CartTransitionLockResult =
  | { kind: "acquired"; release: () => void }
  | { kind: "busy" }
  | { kind: "unavailable" };

export interface CartTransitionCoordinator {
  /** True when the lock coordinates contexts across Browser tabs. */
  readonly crossTab: boolean;
  acquire(wait?: boolean): Promise<CartTransitionLockResult>;
  /** Rejects when ownership cannot be checked; the lifecycle must block and offer recovery. */
  isHeld(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

type LockLike = { readonly name: string };
type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable?: boolean },
    callback: (lock: LockLike | null) => T | Promise<T>,
  ): Promise<T>;
};

export function createWebCartTransitionCoordinator(
  locks: LockManagerLike,
  makeChannel?: () => Pick<BroadcastChannel, "postMessage" | "addEventListener" | "close">,
  canFallback: () => boolean = () => false,
): CartTransitionCoordinator {
  const listeners = new Set<() => void>();
  let memory: CartTransitionCoordinator | null = null;
  let pendingRequests = 0;
  let activeLeases = 0;
  let ownershipUnknown = false;
  let channel: ReturnType<NonNullable<typeof makeChannel>> | null = null;
  try {
    channel = makeChannel?.() ?? null;
    channel?.addEventListener("message", () => notify());
  } catch {
    channel = null;
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function announce(): void {
    notify();
    try {
      channel?.postMessage({ type: "transition-changed" });
    } catch {
      // The storage event and the explicit retry remain available without BroadcastChannel.
    }
  }

  async function request<T>(
    options: { mode: "exclusive"; ifAvailable?: boolean },
    callback: (lock: LockLike | null) => T | Promise<T>,
  ): Promise<{ kind: "ok"; value: T } | { kind: "failed"; unavailable: boolean }> {
    let callbackStarted = false;
    pendingRequests++;
    try {
      const value = await locks.request(CART_TRANSITION_LOCK_NAME, options, (lock) => {
        callbackStarted = true;
        return callback(lock);
      });
      return { kind: "ok", value };
    } catch (error) {
      // A rejected request that already granted a lease cannot prove that lease was released.
      if (callbackStarted && activeLeases > 0) ownershipUnknown = true;
      return {
        kind: "failed",
        // Web Locks defines SecurityError before a request is enqueued, when obtaining the
        // manager fails. AbortError / InvalidStateError / unknown failures do not prove this.
        unavailable:
          !callbackStarted && error instanceof DOMException && error.name === "SecurityError",
      };
    } finally {
      pendingRequests--;
    }
  }

  function metadataAllowsMemory(): boolean {
    try {
      // The lifecycle owner must also confirm readable metadata without a transition marker.
      // Otherwise recovery could erase a still-active transition from another tab.
      return canFallback();
    } catch {
      return false;
    }
  }

  function enableMemory(unavailable: boolean): CartTransitionCoordinator | null {
    if (!unavailable || ownershipUnknown || pendingRequests > 0 || activeLeases > 0) return null;
    if (!metadataAllowsMemory()) return null;
    if (memory === null) {
      memory = createMemoryCartTransitionCoordinator();
      memory.subscribe(notify);
    }
    return memory;
  }

  return {
    get crossTab() {
      return memory === null;
    },
    async acquire(wait = false) {
      if (memory !== null) {
        // Another tab can still use Web Locks after this tab downgraded. Never clear its marker
        // through memory-only recovery when its ownership can no longer be checked here.
        return metadataAllowsMemory() ? memory.acquire(wait) : { kind: "unavailable" };
      }
      if (ownershipUnknown) return { kind: "unavailable" };
      let resolveAttempt!: (result: CartTransitionLockResult) => void;
      let settled = false;
      const attempt = new Promise<CartTransitionLockResult>((resolve) => {
        resolveAttempt = resolve;
      });
      const settle = (result: CartTransitionLockResult): void => {
        if (settled) return;
        settled = true;
        resolveAttempt(result);
      };
      void request(
        wait ? { mode: "exclusive" } : { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock === null) {
            settle({ kind: "busy" });
            return;
          }
          let releaseLock!: () => void;
          let released = false;
          activeLeases++;
          const held = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          settle({
            kind: "acquired",
            release() {
              if (released) return;
              released = true;
              activeLeases--;
              releaseLock();
              announce();
            },
          });
          announce();
          await held;
        },
      ).then(async (result) => {
        if (result.kind !== "failed") return;
        const fallback = enableMemory(result.unavailable);
        settle(fallback === null ? { kind: "unavailable" } : await fallback.acquire(wait));
      });
      return attempt;
    },
    async isHeld() {
      if (memory !== null) return memory.isHeld();
      if (ownershipUnknown) throw new Error("Cart transition lock ownership unavailable");
      const result = await request(
        { mode: "exclusive", ifAvailable: true },
        (lock) => lock === null,
      );
      if (result.kind === "ok") return result.value;
      const fallback = enableMemory(result.unavailable);
      // A failed probe is not evidence of an active transition. Let the lifecycle keep Cart
      // blocked with explicit recovery, rather than leaving it permanently in a busy state.
      if (fallback === null) throw new Error("Cart transition lock ownership unavailable");
      return fallback.isHeld();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createMemoryCartTransitionCoordinator(): CartTransitionCoordinator {
  const listeners = new Set<() => void>();
  let held = false;
  const waiters: Array<(value: CartTransitionLockResult) => void> = [];

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function acquireNow(): CartTransitionLockResult {
    held = true;
    let released = false;
    return {
      kind: "acquired",
      release() {
        if (released) return;
        released = true;
        const next = waiters.shift();
        if (next === undefined) held = false;
        else next(acquireNow());
        notify();
      },
    };
  }

  return {
    crossTab: false,
    acquire(wait = false) {
      if (!held) return Promise.resolve(acquireNow());
      if (!wait) return Promise.resolve({ kind: "busy" });
      return new Promise((resolve) => waiters.push(resolve));
    },
    async isHeld() {
      return held;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let browserCoordinator: CartTransitionCoordinator | null = null;

export function getBrowserCartTransitionCoordinator(
  canFallback?: () => boolean,
): CartTransitionCoordinator | null {
  if (typeof window === "undefined") return null;
  if (browserCoordinator !== null) return browserCoordinator;
  try {
    const lockManager = navigator.locks;
    browserCoordinator =
      lockManager === undefined
        ? createMemoryCartTransitionCoordinator()
        : createWebCartTransitionCoordinator(
            lockManager,
            () => new BroadcastChannel(CART_TRANSITION_LOCK_NAME),
            canFallback,
          );
  } catch {
    browserCoordinator = createMemoryCartTransitionCoordinator();
  }
  return browserCoordinator;
}
