import { vi } from "vitest";
import type { AuthPort } from "../../apps/web/src/auth/port.ts";
import { CART_STORAGE_KEY } from "../../apps/web/src/features/cart/cart-count.ts";
import {
  CART_LIFECYCLE_STORAGE_KEY,
  createCartLifecycle,
} from "../../apps/web/src/features/cart/cart-lifecycle.ts";
import { type CartStorage, createCartStore } from "../../apps/web/src/features/cart/cart-store.ts";
import { createCartLifecycleAuthPort } from "../../apps/web/src/features/shell/cart-lifecycle-auth-port.ts";

// Test-only storage fault injector and synthetic AuthPort; never imported by production.
export const CART = JSON.stringify({
  version: 1,
  lines: [
    { kind: "ENTRY_TICKET", offeringRef: "e0000000-0000-4000-8000-000000000001", quantity: 2 },
  ],
});
export const metadata = (provenance: "guest" | "authenticated") =>
  JSON.stringify({ version: 1, provenance });
export const input = { email: "new@example.com", password: "test-only" };

export function setupCartLifecycle(marker: string | null = metadata("guest")) {
  const data = new Map<string, string>([[CART_STORAGE_KEY, CART]]);
  if (marker !== null) data.set(CART_LIFECYCLE_STORAGE_KEY, marker);
  const faults = { read: false, write: false, clear: false, writesRemaining: 0 };
  const storage: CartStorage = {
    getItem(key) {
      if (key === CART_LIFECYCLE_STORAGE_KEY && faults.read)
        throw new Error("test-only read fault");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (key === CART_LIFECYCLE_STORAGE_KEY && (faults.write || faults.writesRemaining-- > 0))
        throw new Error("test-only write fault");
      data.set(key, value);
    },
    removeItem(key) {
      if (key === CART_STORAGE_KEY && faults.clear) throw new Error("test-only clear fault");
      data.delete(key);
    },
  };
  const store = createCartStore({ storage });
  let external: (() => void) | undefined;
  const lifecycle = createCartLifecycle(storage, store, (listener) => {
    external = listener;
    return () => {
      external = undefined;
    };
  });
  const raw: AuthPort = {
    getSession: vi.fn(async () => ({ kind: "ok", session: { kind: "guest" } }) as const),
    onSessionChange: vi.fn(() => () => undefined),
    signIn: vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const),
    signUp: vi.fn(async () => ({ kind: "signed_in" }) as const),
    signOut: vi.fn(async () => ({ kind: "signed_out" }) as const),
    verifyEmail: vi.fn(async () => ({ kind: "verified" }) as const),
    requestPasswordReset: vi.fn(async () => ({ kind: "accepted" }) as const),
    completePasswordReset: vi.fn(async () => ({ kind: "updated" }) as const),
  };
  return {
    data,
    faults,
    store,
    lifecycle,
    raw,
    port: createCartLifecycleAuthPort(raw, lifecycle),
    external: () => external?.(),
  };
}
