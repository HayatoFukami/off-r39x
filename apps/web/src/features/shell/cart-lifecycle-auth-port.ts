import type { AuthPort } from "../../auth/port";
import type { CartLifecycle, CartProvenance } from "../cart/cart-lifecycle";
import type { CartTransitionCoordinator } from "../cart/cart-transition-lock";

/** Internal decorator: lifecycle cleanup is settled before an Auth result or event is observable. */
export function createCartLifecycleAuthPort(
  rawAuth: AuthPort,
  lifecycle: CartLifecycle,
  coordinator: CartTransitionCoordinator,
): AuthPort {
  const listeners = new Set<() => void>();
  let releaseRaw: (() => void) | null = null;
  let transition: Promise<void> | null = null;
  let settleTransition: (() => void) | null = null;
  let pendingNotification = false;

  const publish = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const waitForTransition = async (): Promise<void> => {
    while (transition !== null) await transition;
  };

  const synchronize = async (): Promise<void> => {
    while (true) {
      await waitForTransition();
      const current = await rawAuth.getSession();
      if (transition !== null) continue;
      if (current.kind === "ok") {
        if (current.session.kind === "guest") lifecycle.initializeGuestIfEmpty();
        else lifecycle.markAuthenticated();
      }
      return;
    }
  };

  const onRawChange = (): void => {
    if (transition !== null) {
      pendingNotification = true;
      return;
    }
    void synchronize().finally(() => {
      if (transition !== null) pendingNotification = true;
      else publish();
    });
  };

  async function startTransition(
    wait: boolean,
    forceLogout = false,
  ): Promise<
    | { kind: "ready"; provenance: CartProvenance; release: () => void }
    | { kind: "busy" }
    | { kind: "blocked" }
  > {
    while (transition !== null) await transition;
    const lock = await coordinator.acquire(wait);
    if (lock.kind === "busy") return { kind: "busy" };
    if (lock.kind === "unavailable" && !forceLogout) return { kind: "blocked" };

    const release = lock.kind === "acquired" ? lock.release : () => undefined;
    const result = lifecycle.beginTransition(lock.kind === "acquired");
    if (result.kind !== "ready" && !forceLogout) {
      release();
      return result;
    }
    const provenance = result.kind === "ready" ? result.provenance : "unknown";
    transition = new Promise<void>((resolve) => {
      settleTransition = resolve;
    });
    return { kind: "ready", provenance, release };
  }

  function completeTransition(release: () => void): void {
    transition = null;
    settleTransition?.();
    settleTransition = null;
    release();
    if (pendingNotification) {
      pendingNotification = false;
      publish();
    }
  }

  async function authenticate<T extends { kind: string }>(
    operation: () => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T | { kind: "unavailable" | "cart_busy" | "cart_blocked" }> {
    const started = await startTransition(false);
    if (started.kind === "busy") return { kind: "cart_busy" };
    if (started.kind === "blocked") return { kind: "cart_blocked" };

    try {
      const result = await operation();
      if (succeeded(result)) {
        try {
          lifecycle.finishLogin(started.provenance);
        } catch {
          // Authentication remains successful. The Cart stays hidden until explicit recovery.
        }
      } else {
        lifecycle.abortTransition(started.provenance);
      }
      return result;
    } catch (error) {
      lifecycle.abortTransition(started.provenance);
      throw error;
    } finally {
      completeTransition(started.release);
    }
  }

  return {
    async getSession() {
      while (true) {
        await waitForTransition();
        const result = await rawAuth.getSession();
        if (transition !== null) continue;
        if (result.kind === "ok") {
          if (result.session.kind === "guest") lifecycle.initializeGuestIfEmpty();
          else lifecycle.markAuthenticated();
        }
        return result;
      }
    },
    onSessionChange(listener) {
      listeners.add(listener);
      if (listeners.size === 1) releaseRaw = rawAuth.onSessionChange(onRawChange);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && releaseRaw !== null) {
          releaseRaw();
          releaseRaw = null;
        }
      };
    },
    signUp(input) {
      return authenticate(
        () => rawAuth.signUp(input),
        (result) => result.kind === "signed_in",
      );
    },
    verifyEmail: (input) => rawAuth.verifyEmail(input),
    signIn(input) {
      return authenticate(
        () => rawAuth.signIn(input),
        (result) => result.kind === "signed_in",
      );
    },
    async signOut() {
      const started = await startTransition(true, true);
      if (started.kind !== "ready") {
        // Logout must still discard this Browser's Session if storage or the lock manager fails.
        try {
          return await rawAuth.signOut();
        } finally {
          try {
            lifecycle.finishLogout();
          } catch {
            // Keep Cart contents hidden until recovery succeeds.
          }
        }
      }
      try {
        return await rawAuth.signOut();
      } finally {
        try {
          lifecycle.finishLogout();
        } catch {
          // Logout remains complete; the Cart stays hidden until recovery succeeds.
        } finally {
          completeTransition(started.release);
        }
      }
    },
    requestPasswordReset: (input) => rawAuth.requestPasswordReset(input),
    completePasswordReset: (input) => rawAuth.completePasswordReset(input),
  };
}
