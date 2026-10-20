import type { AuthPort } from "../../auth/port";
import type { CartLifecycle } from "../cart/cart-lifecycle";

type AuthLifecycle = Pick<
  CartLifecycle,
  | "beginTransition"
  | "finishLogin"
  | "abortTransition"
  | "finishLogout"
  | "expireAuthenticatedCart"
  | "subscribe"
  | "getSnapshot"
> & {
  initializeGuestIfEmpty?: CartLifecycle["initializeGuestIfEmpty"];
  markAuthenticated?: CartLifecycle["markAuthenticated"];
};

/** Internal decorator: Cart lifecycle is settled before an AuthPort result or event is observable. */
export function createCartLifecycleAuthPort(rawAuth: AuthPort, lifecycle: AuthLifecycle): AuthPort {
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
        if (current.session.kind === "guest") {
          lifecycle.initializeGuestIfEmpty?.();
        } else {
          lifecycle.markAuthenticated?.();
        }
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

  async function startTransition(): Promise<ReturnType<CartLifecycle["beginTransition"]>> {
    // Acquire this tab's transition before yielding, including Logout after a storage failure.
    while (transition !== null) await transition;
    const result = lifecycle.beginTransition();
    transition = new Promise<void>((resolve) => {
      settleTransition = resolve;
    });
    return result;
  }

  function completeTransition(): void {
    transition = null;
    settleTransition?.();
    settleTransition = null;
    if (pendingNotification) {
      pendingNotification = false;
      publish();
    }
  }

  async function authenticate<T extends { kind: string }>(
    operation: () => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T | { kind: "unavailable" }> {
    const started = await startTransition();
    if (started.kind === "blocked") {
      completeTransition();
      return { kind: "unavailable" };
    }
    const { provenance } = started;
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      lifecycle.abortTransition(provenance);
      completeTransition();
      throw error;
    }
    if (succeeded(result)) {
      try {
        lifecycle.finishLogin(provenance);
      } catch {
        // Authentication remains successful. The lifecycle keeps Cart access blocked for recovery.
      }
    } else {
      lifecycle.abortTransition(provenance);
    }
    completeTransition();
    return result;
  }

  return {
    async getSession() {
      while (true) {
        await waitForTransition();
        const result = await rawAuth.getSession();
        if (transition !== null) continue;
        if (result.kind === "ok") {
          if (result.session.kind === "guest") {
            lifecycle.initializeGuestIfEmpty?.();
          } else {
            lifecycle.markAuthenticated?.();
          }
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
      await startTransition();
      try {
        return await rawAuth.signOut();
      } finally {
        try {
          lifecycle.finishLogout();
        } catch {
          // Logout remains complete; the lifecycle blocks Cart access until recovery succeeds.
        } finally {
          completeTransition();
        }
      }
    },
    requestPasswordReset: (input) => rawAuth.requestPasswordReset(input),
    completePasswordReset: (input) => rawAuth.completePasswordReset(input),
  };
}
