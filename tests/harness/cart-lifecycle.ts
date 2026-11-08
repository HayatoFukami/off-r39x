import { vi } from "vitest";
import type { AuthPort } from "../../apps/web/src/auth/port.ts";
import { CART_STORAGE_KEY } from "../../apps/web/src/features/cart/cart-count.ts";
import {
  CART_LIFECYCLE_STORAGE_KEY,
  type CartLifecycle,
  createCartLifecycle,
} from "../../apps/web/src/features/cart/cart-lifecycle.ts";
import { type CartStorage, createCartStore } from "../../apps/web/src/features/cart/cart-store.ts";
import {
  type CartTransitionCoordinator,
  createMemoryCartTransitionCoordinator,
} from "../../apps/web/src/features/cart/cart-transition-lock.ts";
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

/** The metadata value of a Guest Cart with an external-completion record (FR-CRT-012 external completion rule). */
export const metadataWithExternal = (
  provenance: "guest" | "authenticated",
  external: "pending" | "superseded",
) => JSON.stringify({ version: 1, provenance, external });

export function setupCartLifecycle(
  marker: string | null = metadata("guest"),
  coordinator: CartTransitionCoordinator = createMemoryCartTransitionCoordinator(),
) {
  const data = new Map<string, string>([[CART_STORAGE_KEY, CART]]);
  if (marker !== null) data.set(CART_LIFECYCLE_STORAGE_KEY, marker);
  // `read` fails the lifecycle metadata key only; `cartRead` fails the Cart key only (FR-CRT-012).
  const faults = { read: false, cartRead: false, write: false, clear: false, writesRemaining: 0 };
  const storage: CartStorage = {
    getItem(key) {
      if (key === CART_LIFECYCLE_STORAGE_KEY && faults.read)
        throw new Error("test-only read fault");
      if (key === CART_STORAGE_KEY && faults.cartRead) throw new Error("test-only cart read fault");
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
  const lifecycle = createCartLifecycle(
    storage,
    store,
    (listener) => {
      external = listener;
      return () => {
        external = undefined;
      };
    },
    coordinator,
  );
  /**
   * A new document of the same Browser (FR-CRT-012 external completion, step 6 and 9): a new lifecycle on the same
   * storage, Cart store and coordinator. Its creation time is when the "document" reads its metadata. A document
   * that is "the screen shown by the return" calls completeExternalAuthentication() on this instance.
   */
  const newDocument = (): CartLifecycle =>
    createCartLifecycle(storage, store, undefined, coordinator);
  const raw = {
    getSession: vi.fn(async () => ({ kind: "ok", session: { kind: "guest" } }) as const),
    onSessionChange: vi.fn(() => () => undefined),
    signIn: vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const),
    signUp: vi.fn(async () => ({ kind: "signed_in" }) as const),
    signOut: vi.fn(async () => ({ kind: "signed_out" }) as const),
    verifyEmail: vi.fn(async () => ({ kind: "verified" }) as const),
    requestPasswordReset: vi.fn(async () => ({ kind: "accepted" }) as const),
    completePasswordReset: vi.fn(async () => ({ kind: "updated" }) as const),
    requestEmailOtp: vi.fn(async () => ({ kind: "sent" }) as const),
    signInWithEmailOtp: vi.fn(async () => ({ kind: "signed_in", emailVerified: true }) as const),
    startGoogleSignIn: vi.fn(
      async (
        _input: Parameters<AuthPort["startGoogleSignIn"]>[0],
      ): ReturnType<AuthPort["startGoogleSignIn"]> => ({
        kind: "redirect",
        url: "/dev/mock-google?success=%2Faccount%2Flogin&failure=%2Faccount%2Flogin",
      }),
    ),
    requestMagicLink: vi.fn(
      async (
        _input: Parameters<AuthPort["requestMagicLink"]>[0],
      ): ReturnType<AuthPort["requestMagicLink"]> => ({ kind: "sent" }),
    ),
  } as AuthPort;
  return {
    data,
    faults,
    storage,
    store,
    lifecycle,
    newDocument,
    coordinator,
    raw,
    port: createCartLifecycleAuthPort(raw, lifecycle, coordinator),
    external: () => external?.(),
  };
}
