export const CART_TRANSITION_LOCK_NAME = "r39x.cart-auth-transition.v1";

export type CartTransitionLockResult =
  | { kind: "acquired"; release: () => void }
  | { kind: "busy" }
  | { kind: "unavailable" };

export interface CartTransitionCoordinator {
  /** True when the lock coordinates contexts across Browser tabs. */
  readonly crossTab: boolean;
  acquire(wait?: boolean): Promise<CartTransitionLockResult>;
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
): CartTransitionCoordinator {
  const listeners = new Set<() => void>();
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

  return {
    crossTab: true,
    async acquire(wait = false) {
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
      void locks
        .request(
          CART_TRANSITION_LOCK_NAME,
          wait ? { mode: "exclusive" } : { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (lock === null) {
              settle({ kind: "busy" });
              return;
            }
            let releaseLock!: () => void;
            let released = false;
            const held = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            settle({
              kind: "acquired",
              release() {
                if (released) return;
                released = true;
                releaseLock();
                announce();
              },
            });
            announce();
            await held;
          },
        )
        .catch(() => settle({ kind: "unavailable" }));
      return attempt;
    },
    async isHeld() {
      try {
        return await locks.request(
          CART_TRANSITION_LOCK_NAME,
          { mode: "exclusive", ifAvailable: true },
          (lock) => lock === null,
        );
      } catch {
        // Uncertainty must keep Cart contents hidden until an explicit recovery succeeds.
        return true;
      }
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

export function getBrowserCartTransitionCoordinator(): CartTransitionCoordinator | null {
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
          );
  } catch {
    browserCoordinator = createMemoryCartTransitionCoordinator();
  }
  return browserCoordinator;
}
