import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CartTransitionCoordinator,
  createWebCartTransitionCoordinator,
} from "../../../../apps/web/src/features/cart/cart-transition-lock.ts";
import { input, metadata, setupCartLifecycle } from "../../../harness/cart-lifecycle.ts";

type Locks = Parameters<typeof createWebCartTransitionCoordinator>[0];
const securityError = () => new DOMException("test-only unavailable API", "SecurityError");
const rejecting = (error: Error): Locks => ({ request: vi.fn(async () => Promise.reject(error)) });
const fallback = (locks: Locks, safe = () => true) =>
  createWebCartTransitionCoordinator(locks, undefined, safe);

async function lease(coordinator: CartTransitionCoordinator) {
  const result = await coordinator.acquire();
  expect(result.kind).toBe("acquired");
  if (result.kind !== "acquired") throw new Error("expected a test lease");
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe("TC-FR-CRT-012-013 safe runtime Web Locks fallback and ownership", () => {
  it("uses one shared memory coordinator when navigator.locks is absent", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    const { getBrowserCartTransitionCoordinator } = await import(
      "../../../../apps/web/src/features/cart/cart-transition-lock.ts"
    );
    const coordinator = getBrowserCartTransitionCoordinator();
    expect(coordinator?.crossTab).toBe(false);
    expect(getBrowserCartTransitionCoordinator()).toBe(coordinator);
    if (coordinator === null) throw new Error("missing Browser coordinator");
    const first = await lease(coordinator);
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "busy" });
    first.release();
  });

  it.each([false, true])(
    "falls back on a pre-callback SecurityError (synchronous throw=%s)",
    async (synchronous) => {
      const locks = synchronous
        ? {
            request: vi.fn(() => {
              throw securityError();
            }),
          }
        : rejecting(securityError());
      const coordinator = fallback(locks);
      const notify = vi.fn();
      coordinator.subscribe(notify);
      const first = await lease(coordinator);
      expect(coordinator.crossTab).toBe(false);
      await expect(coordinator.isHeld()).resolves.toBe(true);
      await expect(coordinator.acquire()).resolves.toEqual({ kind: "busy" });
      const waiting = coordinator.acquire(true);
      first.release();
      const next = await waiting;
      expect(next.kind).toBe("acquired");
      if (next.kind === "acquired") next.release();
      await expect(coordinator.isHeld()).resolves.toBe(false);
      expect(locks.request).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalled();
    },
  );

  it.each([
    new Error("test-only unknown failure"),
    new DOMException("aborted", "AbortError"),
    new DOMException("inactive", "InvalidStateError"),
    new DOMException("invalid options", "NotSupportedError"),
  ])("does not downgrade an unclassified request failure ($name)", async (error) => {
    const coordinator = fallback(rejecting(error));
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "unavailable" });
    expect(coordinator.crossTab).toBe(true);
    await expect(coordinator.isHeld()).rejects.toThrow("ownership unavailable");
    const s = setupCartLifecycle(metadata("guest"), coordinator);
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "cart_blocked" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
  });

  it.each([
    () => false,
    () => {
      throw new Error("test-only metadata read fault");
    },
  ])("does not downgrade without a safe metadata check", async (safe) => {
    const coordinator = fallback(rejecting(securityError()), safe);
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "unavailable" });
    expect(coordinator.crossTab).toBe(true);
  });

  it("does not downgrade while another Web Lock request is still pending", async () => {
    let settle!: () => void;
    let calls = 0;
    const locks: Locks = {
      async request<T>(_name: string, _options: unknown, callback: (lock: null) => T | Promise<T>) {
        if (++calls > 1) throw securityError();
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
        return callback(null);
      },
    };
    const coordinator = fallback(locks);
    const pending = coordinator.acquire(true);
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "unavailable" });
    expect(coordinator.crossTab).toBe(true);
    settle();
    await expect(pending).resolves.toEqual({ kind: "busy" });
  });

  it("does not downgrade while a Web Lock lease is held, even if its request rejects", async () => {
    const locks: Locks = {
      request<T>(
        name: string,
        _options: unknown,
        callback: (lock: { name: string }) => T | Promise<T>,
      ) {
        void callback({ name });
        return Promise.reject(securityError());
      },
    };
    const coordinator = fallback(locks);
    const first = await lease(coordinator);
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "unavailable" });
    expect(coordinator.crossTab).toBe(true);
    first.release();
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "unavailable" });
  });

  it("preserves busy for normal contention and keeps Web Locks enabled", async () => {
    const locks: Locks = { request: async (_name, _options, callback) => callback(null) };
    const safe = vi.fn(() => true);
    const coordinator = fallback(locks, safe);
    await expect(coordinator.acquire()).resolves.toEqual({ kind: "busy" });
    await expect(coordinator.isHeld()).resolves.toBe(true);
    expect(coordinator.crossTab).toBe(true);
    expect(safe).not.toHaveBeenCalled();
  });

  it("also handles an unavailable read probe without creating a second memory coordinator", async () => {
    const coordinator = fallback(rejecting(securityError()));
    await expect(coordinator.isHeld()).resolves.toBe(false);
    const first = await lease(coordinator);
    await expect(coordinator.isHeld()).resolves.toBe(true);
    first.release();
  });

  it("refuses memory-only recovery if a transition marker appears after downgrade", async () => {
    let safe = true;
    const coordinator = fallback(rejecting(securityError()), () => safe);
    const first = await lease(coordinator);
    first.release();
    safe = false;
    const s = setupCartLifecycle(
      JSON.stringify({ version: 1, provenance: "authenticated", transitioning: true }),
      coordinator,
    );
    const before = [...s.data];
    await expect(s.lifecycle.recover("guest")).resolves.toBe("failed");
    expect([...s.data]).toEqual(before);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
    await expect(s.port.signIn(input)).resolves.toEqual({ kind: "cart_blocked" });
    expect(s.raw.signIn).not.toHaveBeenCalled();
  });

  it("serializes raw authentication after fallback and leaves a residual marker blocked", async () => {
    const coordinator = fallback(rejecting(securityError()));
    const s = setupCartLifecycle(metadata("guest"), coordinator);
    let finish!: () => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    s.raw.signIn = vi.fn(async () => {
      began();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { kind: "signed_in", emailVerified: true } as const;
    });
    const first = s.port.signIn(input);
    await started;
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "busy" });
    const second = s.port.signUp(input);
    await Promise.resolve();
    expect(s.raw.signUp).not.toHaveBeenCalled();
    finish();
    await first;
    await expect(second).resolves.toMatchObject({ kind: "signed_in" });
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    const orphan = setupCartLifecycle(
      JSON.stringify({ version: 1, provenance: "guest", transitioning: true }),
      coordinator,
    );
    await expect(orphan.port.signIn(input)).resolves.toEqual({ kind: "cart_blocked" });
    expect(orphan.raw.signIn).not.toHaveBeenCalled();
    await expect(orphan.lifecycle.recover("guest")).resolves.toBe("recovered");
  });

  it.each(["signIn", "signUp"] as const)(
    "%s can initiate the safe fallback before any successful Web Lock request",
    async (method) => {
      const coordinator = fallback(rejecting(securityError()));
      const s = setupCartLifecycle(metadata("guest"), coordinator);
      const cartBefore = s.store.getSnapshot();
      await expect(s.port[method](input)).resolves.toMatchObject({ kind: "signed_in" });
      expect(s.raw[method]).toHaveBeenCalledTimes(1);
      expect(s.store.getSnapshot()).toEqual(cartBefore);
      expect(coordinator.crossTab).toBe(false);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );
});
