import { describe, expect, it, vi } from "vitest";
import type { AuthPort } from "../../../../apps/web/src/auth/port.ts";
import { createCartLifecycleAuthPort } from "../../../../apps/web/src/features/shell/cart-lifecycle-auth-port.ts";

type Provenance = "guest" | "authenticated" | "unknown";

type Lifecycle = {
  beginTransition(): { kind: "ready"; provenance: Provenance } | { kind: "blocked" };
  finishLogin(provenance: Provenance): void;
  abortTransition(provenance: Provenance): void;
  finishLogout(): void;
  expireAuthenticatedCart(): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): { kind: "ready" } | { kind: "blocked" };
};

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
    ...overrides,
  };
}

function lifecycle(overrides: Partial<Lifecycle> = {}): Lifecycle {
  return {
    beginTransition: () => ({ kind: "ready", provenance: "guest" }),
    finishLogin: () => undefined,
    abortTransition: () => undefined,
    finishLogout: () => undefined,
    expireAuthenticatedCart: () => true,
    subscribe: () => () => undefined,
    getSnapshot: () => ({ kind: "ready" }),
    ...overrides,
  };
}

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
    const port = createCartLifecycleAuthPort(
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
      const port = createCartLifecycleAuthPort(
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
    const port = createCartLifecycleAuthPort(
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
    let snapshot: { kind: "ready" } | { kind: "blocked" } = { kind: "ready" };
    const cartLifecycle = lifecycle({
      finishLogin: () => {
        snapshot = { kind: "blocked" };
        throw new Error("storage unavailable");
      },
      getSnapshot: () => snapshot,
    });
    const raw = rawAuth({ signIn: vi.fn(async () => result) });
    const port = createCartLifecycleAuthPort(raw, cartLifecycle);

    await expect(port.signIn({ email: "new@example.com", password: "synthetic" })).resolves.toBe(
      result,
    );
    expect(cartLifecycle.getSnapshot()).toEqual({ kind: "blocked" });
  });
});
