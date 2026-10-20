import { describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import { CART_LIFECYCLE_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-lifecycle.ts";
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

describe("TC-FR-CRT-012-003 real Cart store lifecycle isolation (FR-CRT-012)", () => {
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
    expect(s.lifecycle.recover("authenticated")).toBe(true);
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
    "%s never invokes raw authentication after transition marker cannot be persisted",
    async (method) => {
      const s = setup();
      s.faults.writesRemaining = 1;
      await expect(s.port[method](input)).resolves.toEqual({ kind: "unavailable" });
      expect(s.raw[method]).not.toHaveBeenCalled();
      expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      // Later writes becoming available cannot silently restore the unvalidated Cart.
      await s.port.getSession();
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      expect(s.lifecycle.recover("guest")).toBe(true);
      expectEmpty(s);
    },
  );
  it("metadata read faults stop raw authentication and require explicit recovery", async () => {
    const s = setup();
    s.faults.read = true;
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "unavailable" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
    s.faults.read = false;
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.lifecycle.recover("guest")).toBe(true);
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
      expect(s.lifecycle.recover("authenticated")).toBe(false);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      s.faults[fault] = false;
      // Ordinary synchronization must not remove the sticky failure.
      await s.port.getSession();
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      expect(s.lifecycle.recover("authenticated")).toBe(true);
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
    expect(s.lifecycle.recover("authenticated")).toBe(true);
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
    expect(s.lifecycle.recover("guest")).toBe(true);
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
  it("protected expiry returns its clear result; genuine Guest Cart is retained", () => {
    const guest = setup();
    expect(guest.lifecycle.expireAuthenticatedCart()).toBe(true);
    expect(guest.data.get(CART_STORAGE_KEY)).toBe(CART);
    const s = setup(metadata("authenticated"));
    s.faults.clear = true;
    expect(s.lifecycle.expireAuthenticatedCart()).toBe(false);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    s.faults.clear = false;
    expect(s.lifecycle.recover("guest")).toBe(true);
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
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    stop();
    s.external();
    expect(listener).toHaveBeenCalledTimes(1);
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
