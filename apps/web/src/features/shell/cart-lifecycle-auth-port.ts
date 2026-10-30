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

  // FR-CRT-012 external-completion rule, shared by every method whose sign-in completes outside the
  // page (Google, Magic Link). Step 1: only a Guest starts; a Session that cannot be confirmed is not
  // assumed to be a Guest, and an Email-unverified Session is not a Guest. The check reads the raw
  // Session so that it observes nothing and writes nothing.
  async function startExternal<T extends { kind: string }>(
    request: () => Promise<T>,
  ): Promise<T | { kind: "unavailable" | "already_signed_in" | "cart_busy" | "cart_blocked" }> {
    const current = await rawAuth.getSession();
    if (current.kind !== "ok") return { kind: "unavailable" };
    if (current.session.kind !== "guest") return { kind: "already_signed_in" };
    // The answer is immediate: a transition in flight, another Tab's lock or a stopped Cart
    // (Q-1) is never waited for, and the request is not made.
    if (transition !== null) return { kind: "cart_busy" };
    transition = new Promise<void>((resolve) => {
      settleTransition = resolve;
    });
    let release: () => void = () => undefined;
    try {
      const lock = await coordinator.acquire(false);
      if (lock.kind === "busy") return { kind: "cart_busy" };
      if (lock.kind === "unavailable") return { kind: "cart_blocked" };
      release = lock.release;
      // Steps 2 and 3: the Cart is cleaned and the pending record written before the request.
      const begun = lifecycle.beginExternalAuthentication(true);
      if (begun.kind === "busy") return { kind: "cart_busy" };
      if (begun.kind === "blocked") return { kind: "cart_blocked" };
      // Step 3 and 7: whatever the request answers or throws, the record stays and the Cart that
      // was cleaned is not restored. Step 4: nothing stays in flight once the request is over.
      return await request();
    } finally {
      completeTransition(release);
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
    async requestEmailOtp(input) {
      // Requesting a code does not cross the Cart boundary: no transition is started and nothing
      // is written, but it must not begin while a transition runs or the Cart is stopped (Q-1).
      if (transition !== null) return { kind: "cart_busy" };
      const snapshot = lifecycle.getSnapshot();
      if (snapshot.kind === "busy") return { kind: "cart_busy" };
      if (snapshot.kind === "blocked") return { kind: "cart_blocked" };
      return rawAuth.requestEmailOtp(input);
    },
    signInWithEmailOtp(input) {
      return authenticate(
        () => rawAuth.signInWithEmailOtp(input),
        (result) => result.kind === "signed_in",
      );
    },
    startGoogleSignIn: (input) => startExternal(() => rawAuth.startGoogleSignIn(input)),
    // A resend is a new start: the same steps run again and the record is replaced (step 3).
    requestMagicLink: (input) => startExternal(() => rawAuth.requestMagicLink(input)),
    requestPasswordReset: (input) => rawAuth.requestPasswordReset(input),
    completePasswordReset: (input) => rawAuth.completePasswordReset(input),
  };
}
