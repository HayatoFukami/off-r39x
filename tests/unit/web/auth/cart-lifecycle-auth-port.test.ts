import { describe, expect, it, vi } from "vitest";
import type { AuthPort } from "../../../../apps/web/src/auth/port.ts";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import {
  CART_LIFECYCLE_STORAGE_KEY,
  type CartLifecycle,
} from "../../../../apps/web/src/features/cart/cart-lifecycle.ts";
import {
  type CartTransitionCoordinator,
  createMemoryCartTransitionCoordinator,
  createWebCartTransitionCoordinator,
} from "../../../../apps/web/src/features/cart/cart-transition-lock.ts";
import { createCartLifecycleAuthPort } from "../../../../apps/web/src/features/shell/cart-lifecycle-auth-port.ts";
import { CART, metadata, setupCartLifecycle } from "../../../harness/cart-lifecycle.ts";

type Provenance = "guest" | "authenticated" | "unknown";
type Lifecycle = CartLifecycle;

function rawAuth(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    getSession: vi.fn(async () => ({ kind: "ok", session: { kind: "guest" } as const }) as const),
    onSessionChange: vi.fn(() => () => undefined),
    signUp: vi.fn(async () => ({ kind: "confirmation_required" }) as const),
    verifyEmail: vi.fn(async () => ({ kind: "verified" }) as const),
    signIn: vi.fn(async () => ({ kind: "credential_failure" }) as const),
    signOut: vi.fn(async () => ({ kind: "signed_out" }) as const),
    requestPasswordReset: vi.fn(async () => ({ kind: "accepted" }) as const),
    completePasswordReset: vi.fn(async () => ({ kind: "updated" }) as const),
    requestEmailOtp: vi.fn(async () => ({ kind: "sent" }) as const),
    signInWithEmailOtp: vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const),
    startGoogleSignIn: vi.fn(async () => ({ kind: "redirect", url: "/dev/mock-google" }) as const),
    ...overrides,
  };
}

function lifecycle(overrides: Partial<Lifecycle> = {}): Lifecycle {
  return {
    initializeGuestIfEmpty: () => undefined,
    markAuthenticated: () => undefined,
    beginTransition: () => ({ kind: "ready", provenance: "guest" }),
    finishLogin: () => undefined,
    abortTransition: () => undefined,
    finishLogout: () => undefined,
    block: () => undefined,
    expireAuthenticatedCart: () => "done",
    recover: async () => "recovered",
    subscribe: () => () => undefined,
    getSnapshot: () => ({ kind: "ready" }),
    beginExternalAuthentication: () => ({ kind: "ready" }),
    completeExternalAuthentication: () => undefined,
    ...overrides,
  };
}

const decorate = (raw: AuthPort, cartLifecycle: Lifecycle) =>
  createCartLifecycleAuthPort(raw, cartLifecycle, createMemoryCartTransitionCoordinator());

describe("TC-AR-SES-010-002 AuthPort lifecycle decorator orders Cart cleanup and session notifications (FR-CRT-012)", () => {
  it("finishes Login cleanup before forwarding an early raw session notification", async () => {
    const order: string[] = [];
    let rawNotify: (() => void) | undefined;
    const raw = rawAuth({
      onSessionChange: vi.fn((listener) => {
        rawNotify = listener;
        return () => undefined;
      }),
      signIn: vi.fn(async () => {
        order.push("raw-sign-in");
        rawNotify?.();
        return { kind: "signed_in", emailVerified: true } as const;
      }),
    });
    const port = decorate(
      raw,
      lifecycle({
        beginTransition: () => {
          order.push("begin");
          return { kind: "ready", provenance: "guest" };
        },
        finishLogin: (provenance) => order.push(`finish:${provenance}`),
      }),
    );
    port.onSessionChange(() => order.push("published"));

    await expect(port.signIn({ email: "new@example.com", password: "synthetic" })).resolves.toEqual(
      {
        kind: "signed_in",
        emailVerified: true,
      },
    );
    expect(order).toEqual(["begin", "raw-sign-in", "finish:guest", "published"]);
  });

  it.each<Provenance>(["authenticated", "unknown"])(
    "passes %s provenance to cleanup so a prior authenticated or legacy Cart is cleared",
    async (provenance) => {
      const finishLogin = vi.fn();
      const raw = rawAuth({
        signIn: vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const),
      });
      const port = decorate(
        raw,
        lifecycle({ beginTransition: () => ({ kind: "ready", provenance }), finishLogin }),
      );

      await port.signIn({ email: "new@example.com", password: "synthetic" });

      expect(finishLogin).toHaveBeenCalledTimes(1);
      expect(finishLogin).toHaveBeenCalledWith(provenance);
    },
  );

  it("aborts the transition without clearing the Cart when Login fails", async () => {
    const abortTransition = vi.fn();
    const finishLogin = vi.fn();
    const failure = { kind: "credential_failure" } as const;
    const raw = rawAuth({ signIn: vi.fn(async () => failure) });
    const port = decorate(
      raw,
      lifecycle({
        beginTransition: () => ({ kind: "ready", provenance: "guest" }),
        finishLogin,
        abortTransition,
      }),
    );

    await expect(port.signIn({ email: "new@example.com", password: "synthetic" })).resolves.toBe(
      failure,
    );
    expect(abortTransition).toHaveBeenCalledTimes(1);
    expect(abortTransition).toHaveBeenCalledWith("guest");
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it("preserves a successful Auth result but blocks Cart use when cleanup fails", async () => {
    const result = { kind: "signed_in", emailVerified: true } as const;
    let snapshot: { kind: "ready" } | { kind: "busy" } | { kind: "blocked" } = {
      kind: "ready",
    };
    const cartLifecycle = lifecycle({
      finishLogin: () => {
        snapshot = { kind: "blocked" };
        throw new Error("storage unavailable");
      },
      getSnapshot: () => snapshot,
    });
    const raw = rawAuth({ signIn: vi.fn(async () => result) });
    const port = decorate(raw, cartLifecycle);

    await expect(port.signIn({ email: "new@example.com", password: "synthetic" })).resolves.toBe(
      result,
    );
    expect(cartLifecycle.getSnapshot()).toEqual({ kind: "blocked" });
  });

  it.each([
    { state: { kind: "busy" } as const, expected: { kind: "cart_busy" } as const },
    { state: { kind: "blocked" } as const, expected: { kind: "cart_blocked" } as const },
  ])(
    "does not call raw authentication when the Cart lifecycle is $state.kind",
    async ({ state, expected }) => {
      const signIn = vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const);
      const port = decorate(rawAuth({ signIn }), lifecycle({ beginTransition: () => state }));

      await expect(
        port.signIn({ email: "new@example.com", password: "synthetic" }),
      ).resolves.toEqual(expected);
      expect(signIn).not.toHaveBeenCalled();
    },
  );
});

// Email OTP (B5 C1) is an authentication that completes inside the page, so it rides the same Cart
// transition as Login (FR-CRT-012, Q-1). Real CartStore and CartLifecycle share one storage; only the
// raw Auth port is a double. tests/contracts/s6-auth.md section 10.
describe("TC-FR-CRT-012-016 Email OTP follows the Cart transition rules of Login: sign-in is an authentication transition, the code request only refuses to cross a busy or stopped Cart (FR-CRT-012, FR-CRT-006, Q-1)", () => {
  const request = { email: "new@example.com" };
  const verify = { email: "new@example.com", code: "246810" };

  class TestLockManager {
    private held = false;

    async request<T>(
      name: string,
      options: { mode: "exclusive"; ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => T | Promise<T>,
    ): Promise<T> {
      if (this.held) {
        if (options.ifAvailable) return callback(null);
        throw new Error("test lock request would wait");
      }
      this.held = true;
      try {
        return await callback({ name });
      } finally {
        this.held = false;
      }
    }
  }

  it("signInWithEmailOtp success keeps only the first Guest Cart and records the authenticated provenance", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
    expect(s.raw.signInWithEmailOtp).toHaveBeenCalledTimes(1);
    expect(s.raw.signInWithEmailOtp).toHaveBeenCalledWith(verify);
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    // The second sign-in is a re-login with a used Cart: it is cleared.
    await s.port.signInWithEmailOtp(verify);
    expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it.each([null, metadata("authenticated"), "invalid"])(
    "signInWithEmailOtp success clears a Cart of authenticated or unknown provenance (%s)",
    async (marker) => {
      const s = setupCartLifecycle(marker);
      await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({
        kind: "signed_in",
        emailVerified: true,
      });
      expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );

  it("an unverified result (emailVerified false) is a successful sign-in for the Cart as well", async () => {
    const s = setupCartLifecycle(metadata("authenticated"));
    s.raw.signInWithEmailOtp = vi.fn(
      async () => ({ kind: "signed_in", emailVerified: false }) as const,
    );
    await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({
      kind: "signed_in",
      emailVerified: false,
    });
    expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
  });

  it.each(["code_invalid", "code_expired", "unavailable"] as const)(
    "signInWithEmailOtp %s leaves the Cart and the provenance exactly as they were and leaves no transition",
    async (kind) => {
      const s = setupCartLifecycle(metadata("authenticated"));
      s.raw.signInWithEmailOtp = vi.fn(async () => ({ kind }) as const);
      const before = new Map(s.data);
      await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({ kind });
      expect(new Map(s.data)).toEqual(before);
      expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );

  it("a rejected raw sign-in aborts the transition, rethrows and leaves the Cart alone", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    s.raw.signInWithEmailOtp = vi.fn(async () => {
      throw new Error("test-only provider failure");
    });
    const before = new Map(s.data);
    await expect(s.port.signInWithEmailOtp(verify)).rejects.toThrow("test-only provider failure");
    expect(new Map(s.data)).toEqual(before);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it("returns cart_busy without calling raw while another transition is active, for both methods", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    const started = s.lifecycle.beginTransition();
    expect(started).toMatchObject({ kind: "ready" });
    await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({ kind: "cart_busy" });
    await expect(s.port.requestEmailOtp(request)).resolves.toEqual({ kind: "cart_busy" });
    expect(s.raw.signInWithEmailOtp).not.toHaveBeenCalled();
    expect(s.raw.requestEmailOtp).not.toHaveBeenCalled();
    if (started.kind === "ready") s.lifecycle.abortTransition(started.provenance);
  });

  it("signInWithEmailOtp returns cart_busy while another tab owns the Web Lock, and raw is not called", async () => {
    const locks = new TestLockManager();
    const otherTab = createWebCartTransitionCoordinator(locks);
    const lease = await otherTab.acquire();
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;
    const s = setupCartLifecycle(metadata("guest"), createWebCartTransitionCoordinator(locks));
    await expect(s.port.signInWithEmailOtp(verify)).resolves.toEqual({ kind: "cart_busy" });
    expect(s.raw.signInWithEmailOtp).not.toHaveBeenCalled();
    lease.release();
  });

  it("requestEmailOtp is cart_busy while this port's own sign-in is in flight, and raw is not called", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    let finish: () => void = () => undefined;
    s.raw.signIn = vi.fn(
      () =>
        new Promise<{ kind: "credential_failure" }>((resolve) => {
          finish = () => resolve({ kind: "credential_failure" });
        }),
    );
    const inFlight = s.port.signIn({ email: "new@example.com", password: "test-only" });
    await vi.waitFor(() => expect(s.raw.signIn).toHaveBeenCalledTimes(1));
    await expect(s.port.requestEmailOtp(request)).resolves.toEqual({ kind: "cart_busy" });
    expect(s.raw.requestEmailOtp).not.toHaveBeenCalled();
    finish();
    await expect(inFlight).resolves.toEqual({ kind: "credential_failure" });
  });

  it.each([
    ["guest", "signInWithEmailOtp"],
    ["guest", "requestEmailOtp"],
    ["authenticated", "signInWithEmailOtp"],
    ["authenticated", "requestEmailOtp"],
  ] as const)(
    "a Cart key that cannot be read stops %s metadata: %s is cart_blocked, raw is not called, storage is untouched",
    async (provenance, method) => {
      const s = setupCartLifecycle(metadata(provenance));
      s.faults.cartRead = true;
      const before = new Map(s.data);
      const result = await (method === "signInWithEmailOtp"
        ? s.port.signInWithEmailOtp(verify)
        : s.port.requestEmailOtp(request));
      expect(result).toEqual({ kind: "cart_blocked" });
      expect(s.raw[method]).not.toHaveBeenCalled();
      expect(new Map(s.data)).toEqual(before);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    },
  );

  it("requestEmailOtp on a ready Cart calls raw once, returns its result unchanged and writes nothing", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    const written = vi.spyOn(s.data, "set");
    const removed = vi.spyOn(s.data, "delete");
    await expect(s.port.requestEmailOtp(request)).resolves.toEqual({ kind: "sent" });
    expect(s.raw.requestEmailOtp).toHaveBeenCalledTimes(1);
    expect(s.raw.requestEmailOtp).toHaveBeenCalledWith(request);
    s.raw.requestEmailOtp = vi.fn(async () => ({ kind: "unavailable" }) as const);
    await expect(s.port.requestEmailOtp(request)).resolves.toEqual({ kind: "unavailable" });
    // No transition record and no Cart or metadata write: the code request does not change the Session.
    expect(written).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it("publishes an early raw session notification only after the Cart cleanup, like Login (TC-AR-SES-010-002)", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    let rawNotify: (() => void) | undefined;
    s.raw.onSessionChange = vi.fn((listener) => {
      rawNotify = listener;
      return () => undefined;
    });
    const order: string[] = [];
    s.raw.signInWithEmailOtp = vi.fn(async () => {
      order.push("raw-sign-in");
      rawNotify?.();
      return { kind: "signed_in", emailVerified: true } as const;
    });
    s.port.onSessionChange(() => {
      order.push(`published:${s.data.get(CART_LIFECYCLE_STORAGE_KEY)}`);
    });
    await s.port.signInWithEmailOtp(verify);
    expect(order).toEqual(["raw-sign-in", `published:${metadata("authenticated")}`]);
  });
});

describe("TC-FR-CRT-012-017 startGoogleSignIn is an authentication transition of an external-completion method: only a Guest starts it, the Cart is cleaned and the pending record written before the request, nothing is left behind (FR-CRT-012 external completion rule steps 1-4, Q-1)", () => {
  const start = {
    successPath: "/account/login?returned=google",
    failurePath: "/account/login?notice=google-failed",
  };
  const REDIRECT = { kind: "redirect", url: "/dev/mock-google?success=a&failure=b" } as const;
  const PENDING = { version: 1, provenance: "guest", external: "pending" };

  class TestLockManager {
    private held = false;

    async request<T>(
      name: string,
      options: { mode: "exclusive"; ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => T | Promise<T>,
    ): Promise<T> {
      if (this.held) {
        if (options.ifAvailable) return callback(null);
        throw new Error("test lock request would wait");
      }
      this.held = true;
      try {
        return await callback({ name });
      } finally {
        this.held = false;
      }
    }
  }

  const storedMetadata = (s: ReturnType<typeof setupCartLifecycle>): unknown => {
    const raw = s.data.get(CART_LIFECYCLE_STORAGE_KEY);
    return raw === undefined ? undefined : JSON.parse(raw);
  };
  const asSession = (emailVerified: boolean) =>
    vi.fn(
      async () =>
        ({
          kind: "ok",
          session: { kind: "authenticated", email: "demo@example.com", emailVerified },
        }) as const,
    );

  it("step 3: the Guest Cart is kept and the pending record exists before the request is made; the raw result is returned unchanged and nothing is left in flight", async () => {
    const s = setupCartLifecycle(metadata("guest"));
    const seen: { metadata: unknown; cart: string | undefined }[] = [];
    s.raw.startGoogleSignIn = vi.fn(async () => {
      seen.push({ metadata: storedMetadata(s), cart: s.data.get(CART_STORAGE_KEY) });
      return REDIRECT;
    });
    await expect(s.port.startGoogleSignIn(start)).resolves.toEqual(REDIRECT);
    expect(s.raw.startGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(s.raw.startGoogleSignIn).toHaveBeenCalledWith(start);
    expect(seen).toEqual([{ metadata: PENDING, cart: CART }]);
    expect(storedMetadata(s)).toEqual(PENDING);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    // step 4: no transition and no Lock remain; the next authentication starts at once.
    const lock = await s.coordinator.acquire(false);
    expect(lock.kind).toBe("acquired");
    if (lock.kind === "acquired") lock.release();
    await expect(
      s.port.signIn({ email: "new@example.com", password: "test-only" }),
    ).resolves.toMatchObject({
      kind: "signed_in",
    });
  });

  it.each([null, metadata("authenticated"), "invalid"])(
    "step 2: a Cart of unknown or authenticated provenance (%s) is already cleared when the request is made",
    async (marker) => {
      const s = setupCartLifecycle(marker);
      const seen: { metadata: unknown; cart: string | undefined }[] = [];
      s.raw.startGoogleSignIn = vi.fn(async () => {
        seen.push({ metadata: storedMetadata(s), cart: s.data.get(CART_STORAGE_KEY) });
        return REDIRECT;
      });
      await s.port.startGoogleSignIn(start);
      expect(seen).toEqual([{ metadata: PENDING, cart: undefined }]);
      expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
    },
  );

  it("step 3: a request that is unavailable or throws leaves the pending record, and the Cart cleared at the start is not restored", async () => {
    const unavailable = setupCartLifecycle(null);
    unavailable.raw.startGoogleSignIn = vi.fn(async () => ({ kind: "unavailable" }) as const);
    await expect(unavailable.port.startGoogleSignIn(start)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(storedMetadata(unavailable)).toEqual(PENDING);
    expect(unavailable.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(unavailable.lifecycle.getSnapshot()).toEqual({ kind: "ready" });

    const thrown = setupCartLifecycle(metadata("authenticated"));
    thrown.raw.startGoogleSignIn = vi.fn(async () => {
      throw new Error("test-only provider failure");
    });
    await expect(thrown.port.startGoogleSignIn(start)).rejects.toThrow(
      "test-only provider failure",
    );
    expect(storedMetadata(thrown)).toEqual(PENDING);
    expect(thrown.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(thrown.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    const lock = await thrown.coordinator.acquire(false);
    expect(lock.kind).toBe("acquired");
    if (lock.kind === "acquired") lock.release();
  });

  it("step 3: a start while a record exists replaces it with a pending record", async () => {
    const s = setupCartLifecycle(
      JSON.stringify({ version: 1, provenance: "guest", external: "superseded" }),
    );
    await s.port.startGoogleSignIn(start);
    expect(storedMetadata(s)).toEqual(PENDING);
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });

  it("step 3: a Cart that cannot be cleared stops the start: cart_blocked, no record, the raw request is not made", async () => {
    const s = setupCartLifecycle(metadata("authenticated"));
    s.faults.clear = true;
    await expect(s.port.startGoogleSignIn(start)).resolves.toEqual({ kind: "cart_blocked" });
    expect(s.raw.startGoogleSignIn).not.toHaveBeenCalled();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
  });

  it.each([
    ["verified", true],
    ["unverified", false],
  ] as const)(
    "step 1: an authenticated Session (%s) is already_signed_in: no request, no clear, no record",
    async (_name, verified) => {
      const s = setupCartLifecycle(metadata("authenticated"));
      s.raw.getSession = asSession(verified);
      const before = new Map(s.data);
      await expect(s.port.startGoogleSignIn(start)).resolves.toEqual({ kind: "already_signed_in" });
      expect(s.raw.startGoogleSignIn).not.toHaveBeenCalled();
      expect(new Map(s.data)).toEqual(before);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );

  it("step 1: a Session that cannot be confirmed is unavailable: no request, nothing written (a Guest is not assumed)", async () => {
    const s = setupCartLifecycle(metadata("authenticated"));
    s.raw.getSession = vi.fn(async () => ({ kind: "unavailable" }) as const);
    const before = new Map(s.data);
    await expect(s.port.startGoogleSignIn(start)).resolves.toEqual({ kind: "unavailable" });
    expect(s.raw.startGoogleSignIn).not.toHaveBeenCalled();
    expect(new Map(s.data)).toEqual(before);
  });

  it("is cart_busy while another transition is active (lifecycle, another Tab's Web Lock, this port's own sign-in), without a request or a write", async () => {
    // lifecycle transition
    const lifecycleBusy = setupCartLifecycle(metadata("guest"));
    const started = lifecycleBusy.lifecycle.beginTransition();
    expect(started).toMatchObject({ kind: "ready" });
    const before = new Map(lifecycleBusy.data);
    await expect(lifecycleBusy.port.startGoogleSignIn(start)).resolves.toEqual({
      kind: "cart_busy",
    });
    expect(lifecycleBusy.raw.startGoogleSignIn).not.toHaveBeenCalled();
    expect(new Map(lifecycleBusy.data)).toEqual(before);
    if (started.kind === "ready") lifecycleBusy.lifecycle.abortTransition(started.provenance);

    // another Tab's Web Lock
    const locks = new TestLockManager();
    const otherTab = createWebCartTransitionCoordinator(locks);
    const lease = await otherTab.acquire();
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;
    const locked = setupCartLifecycle(metadata("guest"), createWebCartTransitionCoordinator(locks));
    await expect(locked.port.startGoogleSignIn(start)).resolves.toEqual({ kind: "cart_busy" });
    expect(locked.raw.startGoogleSignIn).not.toHaveBeenCalled();
    expect(locked.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
    lease.release();

    // this port's own sign-in in flight
    const own = setupCartLifecycle(metadata("guest"));
    let finish: () => void = () => undefined;
    own.raw.signIn = vi.fn(
      () =>
        new Promise<{ kind: "credential_failure" }>((resolve) => {
          finish = () => resolve({ kind: "credential_failure" });
        }),
    );
    const inFlight = own.port.signIn({ email: "new@example.com", password: "test-only" });
    await vi.waitFor(() => expect(own.raw.signIn).toHaveBeenCalledTimes(1));
    const settled = vi.fn();
    const attempt = own.port.startGoogleSignIn(start).then((result) => {
      settled();
      return result;
    });
    try {
      await vi.waitFor(() => expect(settled).toHaveBeenCalled(), { timeout: 500 });
    } finally {
      finish();
    }
    await expect(attempt).resolves.toEqual({ kind: "cart_busy" });
    await expect(inFlight).resolves.toEqual({ kind: "credential_failure" });
    expect(own.raw.startGoogleSignIn).not.toHaveBeenCalled();
  });

  it("is cart_blocked (Q-1) when the Cart key cannot be read, the lifecycle is stopped, a transition record is abandoned or the lock cannot be taken: no request, nothing written", async () => {
    for (const arrange of [
      (s: ReturnType<typeof setupCartLifecycle>) => {
        s.faults.cartRead = true;
      },
      (s: ReturnType<typeof setupCartLifecycle>) => s.lifecycle.block(),
    ]) {
      const s = setupCartLifecycle(metadata("guest"));
      arrange(s);
      const before = new Map(s.data);
      await expect(s.port.startGoogleSignIn(start)).resolves.toEqual({ kind: "cart_blocked" });
      expect(s.raw.startGoogleSignIn).not.toHaveBeenCalled();
      expect(new Map(s.data)).toEqual(before);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    }
    const abandoned = setupCartLifecycle(
      JSON.stringify({ version: 1, provenance: "guest", transitioning: true }),
    );
    await expect(abandoned.port.startGoogleSignIn(start)).resolves.toEqual({
      kind: "cart_blocked",
    });
    expect(abandoned.raw.startGoogleSignIn).not.toHaveBeenCalled();

    const noLock = setupCartLifecycle(metadata("guest"));
    const unavailableCoordinator: CartTransitionCoordinator = {
      crossTab: false,
      acquire: async () => ({ kind: "unavailable" }),
      isHeld: async () => false,
      subscribe: () => () => undefined,
    };
    const port = createCartLifecycleAuthPort(noLock.raw, noLock.lifecycle, unavailableCoordinator);
    await expect(port.startGoogleSignIn(start)).resolves.toEqual({ kind: "cart_blocked" });
    expect(noLock.raw.startGoogleSignIn).not.toHaveBeenCalled();
    expect(noLock.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
  });
});
