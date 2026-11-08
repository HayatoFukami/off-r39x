import { describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import { CART_LIFECYCLE_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-lifecycle.ts";
import { createWebCartTransitionCoordinator } from "../../../../apps/web/src/features/cart/cart-transition-lock.ts";
import {
  CART,
  input,
  metadata,
  setupCartLifecycle as setup,
} from "../../../harness/cart-lifecycle.ts";

function expectEmpty(s: ReturnType<typeof setup>) {
  expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
  expect(s.store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
}

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

describe("TC-FR-CRT-012-003 real Cart store lifecycle isolation (FR-CRT-012)", () => {
  it("keeps an active authentication transition temporarily busy and releases it after settlement", () => {
    const s = setup();
    const started = s.lifecycle.beginTransition();
    expect(started).toMatchObject({ kind: "ready", provenance: "guest" });
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "busy" });
    expect(s.lifecycle.beginTransition()).toEqual({ kind: "busy" });
    if (started.kind === "ready") s.lifecycle.abortTransition(started.provenance);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it("returns busy instead of starting authentication while another tab owns the Web Lock", async () => {
    const locks = new TestLockManager();
    const otherTab = createWebCartTransitionCoordinator(locks);
    const currentTab = createWebCartTransitionCoordinator(locks);
    const lease = await otherTab.acquire();
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;

    const s = setup(metadata("guest"), currentTab);
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "cart_busy" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
    lease.release();
  });

  it("treats an abandoned transition marker as blocked and recovers it explicitly", async () => {
    const locks = new TestLockManager();
    const s = setup(
      JSON.stringify({ version: 1, provenance: "guest", transitioning: true }),
      createWebCartTransitionCoordinator(locks),
    );

    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "cart_blocked" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ version: 2, provenance: "authenticated" }),
    JSON.stringify({ version: 1, provenance: "unknown" }),
    JSON.stringify({ version: 1, provenance: "guest", accountId: "test-only-account" }),
  ])("clears unknown Cart on authenticated session restoration (%s)", async (marker) => {
    const s = setup(marker);
    s.raw.getSession = vi.fn(
      async () =>
        ({
          kind: "ok",
          session: { kind: "authenticated", email: input.email, emailVerified: true },
        }) as const,
    );
    await s.port.getSession();
    expectEmpty(s);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });
  it("keeps authenticated provenance on ordinary restoration", async () => {
    const s = setup(metadata("authenticated"));
    s.raw.getSession = vi.fn(
      async () =>
        ({
          kind: "ok",
          session: { kind: "authenticated", email: input.email, emailVerified: true },
        }) as const,
    );
    await s.port.getSession();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });
  it.each(["guest", "authenticated"] as const)(
    "public Guest session lookup leaves %s Cart untouched",
    async (provenance) => {
      const s = setup(metadata(provenance));
      await s.port.getSession();
      expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata(provenance));
    },
  );
  it.each(["signIn", "signUp"] as const)(
    "%s preserves only the first Guest Cart and clears a later login",
    async (method) => {
      const s = setup();
      expect((await s.port[method](input)).kind).toBe("signed_in");
      expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
      await s.port[method](input);
      expectEmpty(s);
    },
  );
  it.each([null, metadata("authenticated"), "invalid"])(
    "explicit login clears prior/unknown Cart (%s)",
    async (marker) => {
      const s = setup(marker);
      await s.port.signIn(input);
      expectEmpty(s);
    },
  );
  it("failed login and confirmation-only signup retain the prior Cart and provenance", async () => {
    const s = setup(metadata("authenticated"));
    s.raw.signIn = vi.fn(async () => ({ kind: "credential_failure" }) as const);
    s.raw.signUp = vi.fn(async () => ({ kind: "confirmation_required" }) as const);
    await s.port.signIn(input);
    await s.port.signUp(input);
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });
  it("identity-bearing Guest metadata never permits retention at explicit login", async () => {
    const s = setup(
      JSON.stringify({ version: 1, provenance: "guest", accountId: "test-only-account" }),
    );
    await s.port.signIn(input);
    expectEmpty(s);
  });
  it("restored transition marker stays blocked until explicit recovery", async () => {
    const s = setup(JSON.stringify({ version: 1, provenance: "guest", transitioning: true }));
    s.raw.getSession = vi.fn(
      async () =>
        ({
          kind: "ok",
          session: { kind: "authenticated", email: input.email, emailVerified: true },
        }) as const,
    );
    await s.port.getSession();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    await expect(s.lifecycle.recover("authenticated")).resolves.toBe("recovered");
    expectEmpty(s);
  });
  it("logout clears Cart and starts new Guest provenance", async () => {
    const s = setup(metadata("authenticated"));
    await expect(s.port.signOut()).resolves.toEqual({ kind: "signed_out" });
    expectEmpty(s);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
  });
});

describe("TC-FR-CRT-012-004 real storage faults and authentication preflight (FR-CRT-012)", () => {
  it("serializes simultaneous Login, Logout and session reads through their own cleanup", async () => {
    const s = setup(metadata("authenticated"));
    let releaseLogin = () => {};
    let loginStarted = () => {};
    const pendingLogin = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const started = new Promise<void>((resolve) => {
      loginStarted = resolve;
    });
    let session:
      | { kind: "guest" }
      | { kind: "authenticated"; email: string; emailVerified: boolean } = { kind: "guest" };
    let notify: (() => void) | undefined;
    s.raw.onSessionChange = vi.fn((listener) => {
      notify = listener;
      return () => undefined;
    });
    s.raw.getSession = vi.fn(async () => ({ kind: "ok", session }) as const);
    s.raw.signIn = vi.fn(async () => {
      loginStarted();
      await pendingLogin;
      session = { kind: "authenticated", email: input.email, emailVerified: true };
      notify?.();
      return { kind: "signed_in", emailVerified: true } as const;
    });
    s.raw.signOut = vi.fn(async () => {
      session = { kind: "guest" };
      notify?.();
      return { kind: "signed_out" } as const;
    });
    const observed: unknown[] = [];
    s.port.onSessionChange(() =>
      observed.push({ cart: s.data.get(CART_STORAGE_KEY), lifecycle: s.lifecycle.getSnapshot() }),
    );
    const login = s.port.signIn(input);
    const logout = s.port.signOut();
    const read = s.port.getSession();
    await started;
    expect(s.raw.signOut).not.toHaveBeenCalled();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    releaseLogin();
    await expect(login).resolves.toEqual({ kind: "signed_in", emailVerified: true });
    await expect(logout).resolves.toEqual({ kind: "signed_out" });
    await expect(read).resolves.toEqual({ kind: "ok", session: { kind: "guest" } });
    expectEmpty(s);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
    expect(observed).toEqual([
      { cart: undefined, lifecycle: { kind: "ready" } },
      { cart: undefined, lifecycle: { kind: "ready" } },
    ]);
  });
  it.each(["signIn", "signUp"] as const)(
    "%s preserves Auth success when final metadata cannot be persisted",
    async (method) => {
      const s = setup();
      s.faults.writesRemaining = 1;
      await expect(s.port[method](input)).resolves.toMatchObject({ kind: "signed_in" });
      expect(s.raw[method]).toHaveBeenCalledTimes(1);
      expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      // Later writes becoming available cannot silently restore the unvalidated Cart.
      await s.port.getSession();
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
      expectEmpty(s);
    },
  );
  it("metadata read faults stop raw authentication and require explicit recovery", async () => {
    const s = setup();
    s.faults.read = true;
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "cart_blocked" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
    s.faults.read = false;
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
  });
  it.each(["clear", "write"] as const)(
    "successful authentication survives %s failure; recovery remains blocked until both writes succeed",
    async (fault) => {
      const s = setup(metadata("authenticated"));
      s.raw.signIn = vi.fn(async () => {
        s.faults[fault] = true;
        return { kind: "signed_in", emailVerified: true } as const;
      });
      await expect(s.port.signIn(input)).resolves.toEqual({
        kind: "signed_in",
        emailVerified: true,
      });
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      await expect(s.lifecycle.recover("authenticated")).resolves.toBe("failed");
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      s.faults[fault] = false;
      // Ordinary synchronization must not remove the sticky failure.
      await s.port.getSession();
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      await expect(s.lifecycle.recover("authenticated")).resolves.toBe("recovered");
      expectEmpty(s);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );
  it("session-establishing signup preserves Auth success when final metadata persistence fails", async () => {
    const s = setup();
    s.raw.signUp = vi.fn(async () => {
      s.faults.write = true;
      return { kind: "signed_in" } as const;
    });
    await expect(s.port.signUp(input)).resolves.toEqual({ kind: "signed_in" });
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    s.faults.write = false;
    await expect(s.lifecycle.recover("authenticated")).resolves.toBe("recovered");
    expectEmpty(s);
  });
  it("failed Login with failed rollback persistence stays blocked", async () => {
    const s = setup();
    s.raw.signIn = vi.fn(async () => {
      s.faults.write = true;
      return { kind: "credential_failure" } as const;
    });
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "credential_failure" });
    s.faults.write = false;
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
  });
  it("Logout storage failure still signs out and requires explicit clear recovery", async () => {
    const s = setup(metadata("authenticated"));
    s.faults.clear = true;
    await expect(s.port.signOut()).resolves.toEqual({ kind: "signed_out" });
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    s.faults.clear = false;
    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
  });
  it("restoration cleanup failure hides the Cart until explicit recovery", async () => {
    const s = setup(null);
    s.faults.clear = true;
    s.raw.getSession = vi.fn(
      async () =>
        ({
          kind: "ok",
          session: { kind: "authenticated", email: input.email, emailVerified: true },
        }) as const,
    );
    expect((await s.port.getSession()).kind).toBe("ok");
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });
  it("protected expiry returns its clear result; genuine Guest Cart is retained", async () => {
    const guest = setup();
    expect(guest.lifecycle.expireAuthenticatedCart()).toBe("done");
    expect(guest.data.get(CART_STORAGE_KEY)).toBe(CART);
    const s = setup(metadata("authenticated"));
    s.faults.clear = true;
    expect(s.lifecycle.expireAuthenticatedCart()).toBe("blocked");
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    s.faults.clear = false;
    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
  });
  it("external transition metadata blocks subscribers and is released on unsubscribe", () => {
    const s = setup();
    const listener = vi.fn();
    const stop = s.lifecycle.subscribe(listener);
    s.data.set(
      CART_LIFECYCLE_STORAGE_KEY,
      JSON.stringify({ version: 1, provenance: "guest", transitioning: true }),
    );
    s.external();
    expect(listener).toHaveBeenCalled();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    const callsBeforeUnsubscribe = listener.mock.calls.length;
    stop();
    s.external();
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });
  it.each([false, true])(
    "session notification sees cleanup or blocked state before publication (clear fault=%s)",
    async (failClear) => {
      const s = setup(metadata("authenticated"));
      let notify: (() => void) | undefined;
      s.raw.onSessionChange = vi.fn((listener) => {
        notify = listener;
        return () => undefined;
      });
      s.raw.signIn = vi.fn(async () => {
        s.faults.clear = failClear;
        notify?.();
        return { kind: "signed_in", emailVerified: true } as const;
      });
      const observed: unknown[] = [];
      s.port.onSessionChange(() =>
        observed.push({ cart: s.data.get(CART_STORAGE_KEY), lifecycle: s.lifecycle.getSnapshot() }),
      );
      await s.port.signIn(input);
      expect(observed).toEqual([
        {
          cart: failClear ? CART : undefined,
          lifecycle: { kind: failClear ? "blocked" : "ready" },
        },
      ]);
    },
  );
});

describe("TC-FR-CRT-012-015 a Cart key that cannot be read stops the Cart whatever the metadata says, and only an explicit recovery that can read it again resumes (FR-CRT-012)", () => {
  const authenticatedSession = {
    kind: "ok",
    session: { kind: "authenticated", email: input.email, emailVerified: true },
  } as const;

  // (a) Guest metadata: the session lookup path (initializeGuestIfEmpty) used to return before reading the Cart key.
  it("(a) stops with valid Guest metadata and leaves the stored Cart and metadata untouched", () => {
    const s = setup(metadata("guest"));
    s.faults.cartRead = true;
    const before = new Map(s.data);
    s.lifecycle.initializeGuestIfEmpty();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(new Map(s.data)).toEqual(before);
    // (g) the store itself keeps its own contract: unreadable is corrupted, never an empty Cart.
    expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });
  });

  // (b) Authenticated metadata: markAuthenticated used to return before reading the Cart key.
  it("(b) stops with valid authenticated metadata on session restoration and leaves storage untouched", async () => {
    const s = setup(metadata("authenticated"));
    s.raw.getSession = vi.fn(async () => authenticatedSession);
    s.faults.cartRead = true;
    const before = new Map(s.data);
    await expect(s.port.getSession()).resolves.toEqual(authenticatedSession);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(new Map(s.data)).toEqual(before);
    expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });
  });

  // (c) Control: with no metadata the unreadable Cart already stops (TC-PG-CRT-001-542); (a) and (b) must match it.
  it("(c) stops without metadata (the existing path that (a) and (b) must agree with)", () => {
    const s = setup(null);
    s.faults.cartRead = true;
    const before = new Map(s.data);
    s.lifecycle.initializeGuestIfEmpty();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(new Map(s.data)).toEqual(before);
    expect(s.data.has(CART_LIFECYCLE_STORAGE_KEY)).toBe(false);
    expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });
  });

  // (d) A fault that starts after initialization is stopped too, and the stop is sticky until an explicit recovery.
  it("(d) stops a fault that starts later, stays stopped when reads recover, and resumes only through explicit recovery", async () => {
    const s = setup(metadata("guest"));
    s.lifecycle.initializeGuestIfEmpty();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });

    s.faults.cartRead = true;
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });

    s.faults.cartRead = false;
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    // Ordinary synchronization must not remove the sticky stop.
    s.lifecycle.initializeGuestIfEmpty();
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });

    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  // (e) Recovery that cannot read the Cart key again is a failure and keeps the stop.
  it("(e) recovery that still cannot read the Cart key fails and keeps the stop until it can", async () => {
    const s = setup(metadata("guest"));
    s.faults.cartRead = true;

    await expect(s.lifecycle.recover("guest")).resolves.toBe("failed");
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });

    s.faults.cartRead = false;
    // Reads working again does not resume by itself.
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    await expect(s.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(s);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  // (f) Login / registration must not start with a Guest Cart that cannot be read (SPEC-020 FR-CRT-012).
  it.each([
    ["guest", "signIn"],
    ["guest", "signUp"],
    ["authenticated", "signIn"],
    ["authenticated", "signUp"],
  ] as const)(
    "(f) %s metadata: %s is cart_blocked, the raw Auth call is not made and storage is untouched",
    async (provenance, method) => {
      const s = setup(metadata(provenance));
      s.faults.cartRead = true;
      const before = new Map(s.data);
      await expect(s.port[method](input)).resolves.toEqual({ kind: "cart_blocked" });
      expect(s.raw[method]).not.toHaveBeenCalled();
      expect(new Map(s.data)).toEqual(before);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });
    },
  );

  // (g) The store contract is unchanged: a Cart key that throws is corrupted, not empty (TC-PG-CRT-001-422).
  it("(g) the Cart store alone still reports an unreadable key as corrupted, never as an empty Cart", () => {
    for (const marker of [metadata("guest"), metadata("authenticated"), null]) {
      const s = setup(marker);
      s.faults.cartRead = true;
      expect(s.store.getSnapshot()).toEqual({ kind: "corrupted" });
      s.faults.cartRead = false;
      expect(s.store.getSnapshot()).toMatchObject({ kind: "ready" });
    }
  });
});
