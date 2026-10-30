import { describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import { CART_LIFECYCLE_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-lifecycle.ts";
import { createWebCartTransitionCoordinator } from "../../../../apps/web/src/features/cart/cart-transition-lock.ts";
import {
  CART,
  input,
  metadata,
  metadataWithExternal,
  setupCartLifecycle as setup,
} from "../../../harness/cart-lifecycle.ts";

// B5 C2: external-completion authentication (Google; C3 adds Magic Link). The rules are FR-CRT-012 external completion
// rule steps 1-10 (SPEC-020 2.1.0). Contract: tests/contracts/s6-auth.md section 10A.
//
// "A document" is a new lifecycle instance on the same storage: the lifecycle reads its metadata when it is created,
// so the screen shown by the return decides on that copy (steps 6 and 9). The sending Tab is the instance the setup
// returns; "another Tab" is any other instance.

type Setup = ReturnType<typeof setup>;

const OTHER_CART = JSON.stringify({
  version: 1,
  lines: [
    { kind: "ENTRY_TICKET", offeringRef: "e0000000-0000-4000-8000-000000000001", quantity: 5 },
  ],
});
const PENDING = { version: 1, provenance: "guest", external: "pending" };
const AUTHENTICATED = { version: 1, provenance: "authenticated" };
const SUPERSEDED = { version: 1, provenance: "authenticated", external: "superseded" };
const GOOGLE = {
  successPath: "/account/login?returned=google",
  failurePath: "/account/login?notice=google-failed",
};

const stored = (s: Setup): unknown => {
  const raw = s.data.get(CART_LIFECYCLE_STORAGE_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
};

function expectEmpty(s: Setup) {
  expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
  expect(s.store.getSnapshot()).toEqual({ kind: "ready", cart: { version: 1, lines: [] } });
}

const authenticatedSession = (email: string, emailVerified = true) =>
  vi.fn(
    async () => ({ kind: "ok", session: { kind: "authenticated", email, emailVerified } }) as const,
  );

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

describe("TC-FR-CRT-012-017 beginExternalAuthentication is the authentication transition of an external-completion method (FR-CRT-012 external completion rule steps 2, 3, 4)", () => {
  it("step 2: a Guest Cart is kept; the metadata records the pending result; no transition record is left; the Cart stays usable", () => {
    const s = setup(metadata("guest"));
    expect(s.lifecycle.beginExternalAuthentication()).toMatchObject({ kind: "ready" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(PENDING);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
  });

  it.each([
    ["no metadata", null],
    ["authenticated provenance", metadata("authenticated")],
    ["unparsable metadata", "invalid"],
    ["an unknown version", JSON.stringify({ version: 2, provenance: "guest" })],
    [
      "an extra identifying field",
      JSON.stringify({ version: 1, provenance: "guest", accountId: "x" }),
    ],
  ])(
    "step 2: a Cart of unknown or authenticated provenance is cleared (%s) and becomes a Guest Cart",
    (_name, marker) => {
      const s = setup(marker);
      expect(s.lifecycle.beginExternalAuthentication()).toMatchObject({ kind: "ready" });
      expectEmpty(s);
      expect(stored(s)).toEqual(PENDING);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
    },
  );

  it("step 3: an existing record is replaced by a new pending record, also one left by another method's success", () => {
    for (const [provenance, external] of [
      ["guest", "superseded"],
      ["authenticated", "superseded"],
      ["guest", "pending"],
    ] as const) {
      const s = setup(metadataWithExternal(provenance, external));
      expect(s.lifecycle.beginExternalAuthentication()).toMatchObject({ kind: "ready" });
      expect(stored(s)).toEqual(PENDING);
      // A Cart of authenticated provenance is cleared; a Guest Cart is kept.
      expect(s.data.has(CART_STORAGE_KEY)).toBe(provenance === "guest");
    }
  });

  it("step 2 (Q-1): an unreadable Cart key or metadata key, a stopped lifecycle, an abandoned transition record and a metadata write failure are blocked and record nothing", () => {
    const abandoned = JSON.stringify({ version: 1, provenance: "guest", transitioning: true });
    const cases: [string, (s: Setup) => void, string][] = [
      [
        "Cart key not readable",
        (s) => {
          s.faults.cartRead = true;
        },
        metadata("guest"),
      ],
      [
        "metadata key not readable",
        (s) => {
          s.faults.read = true;
        },
        metadata("guest"),
      ],
      ["stopped lifecycle", (s) => s.lifecycle.block(), metadata("guest")],
      [
        "metadata write failure",
        (s) => {
          s.faults.write = true;
        },
        metadata("guest"),
      ],
      ["abandoned transition record", () => undefined, abandoned],
    ];
    for (const [name, arrange, marker] of cases) {
      const s = setup(marker);
      arrange(s);
      const before = new Map(s.data);
      expect(s.lifecycle.beginExternalAuthentication(), name).toEqual({ kind: "blocked" });
      expect(new Map(s.data), name).toEqual(before);
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY) ?? "", name).not.toContain("external");
      expect(s.lifecycle.getSnapshot(), name).toEqual({ kind: "blocked" });
    }
    const owned = setup(abandoned);
    expect(owned.lifecycle.beginExternalAuthentication(true)).toEqual({ kind: "blocked" });
  });

  it("step 3: a Cart that cannot be cleared writes no record (the clear precedes the record) and the lifecycle stops", () => {
    const s = setup(metadata("authenticated"));
    s.faults.clear = true;
    expect(s.lifecycle.beginExternalAuthentication()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
  });

  it("step 3: when the Cart was cleared but the record cannot be written, no record exists, the result is blocked and the Cart is not restored", () => {
    const s = setup(metadata("authenticated"));
    s.faults.write = true;
    expect(s.lifecycle.beginExternalAuthentication()).toEqual({ kind: "blocked" });
    expect(s.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
  });

  it("is busy while an authentication transition is active, records nothing, and works once the transition is over", () => {
    const s = setup(metadata("guest"));
    const started = s.lifecycle.beginTransition();
    expect(started).toMatchObject({ kind: "ready" });
    const before = new Map(s.data);
    expect(s.lifecycle.beginExternalAuthentication()).toEqual({ kind: "busy" });
    expect(new Map(s.data)).toEqual(before);
    if (started.kind === "ready") s.lifecycle.abortTransition(started.provenance);
    expect(s.lifecycle.beginExternalAuthentication()).toMatchObject({ kind: "ready" });
  });

  it("step 4: no transition record remains, so another Tab sees a ready Cart (no orphaned transition), with and without Web Locks", async () => {
    const memory = setup(metadata("guest"));
    expect(memory.lifecycle.beginExternalAuthentication()).toMatchObject({ kind: "ready" });
    expect(JSON.stringify(stored(memory))).not.toContain("transitioning");
    expect(memory.newDocument().getSnapshot()).toEqual({ kind: "ready" });

    const locks = new TestLockManager();
    const s = setup(metadata("guest"), createWebCartTransitionCoordinator(locks));
    const lease = await s.coordinator.acquire(false);
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;
    expect(s.lifecycle.beginExternalAuthentication(true)).toMatchObject({ kind: "ready" });
    lease.release();
    const otherTab = s.newDocument();
    const stop = otherTab.subscribe(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(otherTab.getSnapshot()).toEqual({ kind: "ready" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    const again = await s.coordinator.acquire(false);
    expect(again.kind).toBe("acquired");
    if (again.kind === "acquired") again.release();
    stop();
  });

  it("the record holds only the provenance and the pending state: no Account, email, role or credential (FR-CRT-012)", () => {
    const s = setup(metadata("guest"));
    s.lifecycle.beginExternalAuthentication();
    expect(Object.keys(stored(s) as object).sort()).toEqual(["external", "provenance", "version"]);
    expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).not.toMatch(
      /@|email|account|subject|role|token/i,
    );
  });

  it("legacy metadata without the record is still valid; an unknown record value or an extra field is not (the Cart is then of unknown provenance)", () => {
    const legacy = setup(metadata("guest"));
    legacy.lifecycle.initializeGuestIfEmpty();
    legacy.lifecycle.markAuthenticated();
    expect(legacy.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(legacy)).toEqual(AUTHENTICATED);
    for (const marker of [
      JSON.stringify({ version: 1, provenance: "guest", external: "done" }),
      JSON.stringify({ version: 1, provenance: "guest", external: true }),
      JSON.stringify({ version: 1, provenance: "guest", external: "pending", accountId: "x" }),
    ]) {
      const s = setup(marker);
      s.lifecycle.markAuthenticated();
      expectEmpty(s);
    }
  });
});

describe("TC-FR-CRT-012-017 completeExternalAuthentication decides on the metadata read when the screen shown by the return was created, once (FR-CRT-012 external completion rule steps 6, 7, 8, 9)", () => {
  it("step 6: with a pending record the Cart is kept even when the session observation had already marked it authenticated; the record is resolved", () => {
    const s = setup(metadata("guest"));
    s.lifecycle.beginExternalAuthentication();
    const returned = s.newDocument();
    returned.markAuthenticated();
    expect(stored(s)).toMatchObject({ provenance: "authenticated", external: "pending" });
    returned.completeExternalAuthentication();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(AUTHENTICATED);
    expect(returned.getSnapshot()).toEqual({ kind: "ready" });
  });

  it("step 6: with a superseded record the Cart is cleared (a re-login in a valid session) and the record is resolved", () => {
    const s = setup(metadataWithExternal("authenticated", "superseded"));
    const returned = s.newDocument();
    returned.markAuthenticated();
    returned.completeExternalAuthentication();
    expectEmpty(s);
    expect(stored(s)).toEqual(AUTHENTICATED);
    expect(returned.getSnapshot()).toEqual({ kind: "ready" });
  });

  it.each([
    ["a Guest Cart is kept even when the session observation ran first", metadata("guest"), true],
    ["an authenticated Cart is cleared", metadata("authenticated"), false],
    ["a Cart without metadata is cleared", null, false],
    ["a Cart with invalid metadata is cleared", "invalid", false],
  ])("step 9: without a record, %s", (_name, marker, kept) => {
    const s = setup(marker);
    const returned = s.newDocument();
    returned.markAuthenticated();
    returned.completeExternalAuthentication();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(kept ? CART : undefined);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });

  it("steps 6 and 9: one receipt per return; a second call on the same document changes neither the metadata nor the Cart", () => {
    for (const marker of [
      metadataWithExternal("authenticated", "superseded"),
      metadata("authenticated"),
      metadataWithExternal("guest", "pending"),
    ]) {
      const s = setup(marker);
      const returned = s.newDocument();
      returned.completeExternalAuthentication();
      const afterFirst = s.data.get(CART_LIFECYCLE_STORAGE_KEY);
      s.data.set(CART_STORAGE_KEY, OTHER_CART);
      returned.completeExternalAuthentication();
      returned.completeExternalAuthentication();
      expect(s.data.get(CART_STORAGE_KEY)).toBe(OTHER_CART);
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).toBe(afterFirst);
    }
  });

  it("step 6 (a screen that is not the return): the session observation of other documents never resolves the record or clears the Cart", () => {
    const s = setup(metadata("guest"));
    s.lifecycle.beginExternalAuthentication();
    const otherTab = s.newDocument();
    for (let i = 0; i < 3; i += 1) {
      otherTab.markAuthenticated();
      s.lifecycle.markAuthenticated();
      otherTab.initializeGuestIfEmpty();
    }
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toMatchObject({ external: "pending" });
    s.data.set(CART_LIFECYCLE_STORAGE_KEY, JSON.stringify(SUPERSEDED));
    otherTab.markAuthenticated();
    s.lifecycle.markAuthenticated();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(SUPERSEDED);
  });

  it("step 7: a cancelled or failed return (complete is not called) leaves the pending record; expiry cleanup and recovery keep it; only Logout resolves it", async () => {
    const cancelled = setup(metadata("guest"));
    cancelled.lifecycle.beginExternalAuthentication();
    cancelled.newDocument().initializeGuestIfEmpty();
    expect(stored(cancelled)).toEqual(PENDING);
    expect(cancelled.data.get(CART_STORAGE_KEY)).toBe(CART);

    const expired = setup(metadataWithExternal("authenticated", "pending"));
    expect(expired.lifecycle.expireAuthenticatedCart()).toBe("done");
    expectEmpty(expired);
    expect(stored(expired)).toEqual(PENDING);

    const recovered = setup(metadataWithExternal("guest", "pending"));
    recovered.lifecycle.block();
    await expect(recovered.lifecycle.recover("guest")).resolves.toBe("recovered");
    expectEmpty(recovered);
    expect(stored(recovered)).toEqual(PENDING);

    const loggedOut = setup(metadataWithExternal("guest", "pending"));
    loggedOut.lifecycle.finishLogout();
    expectEmpty(loggedOut);
    expect(stored(loggedOut)).toEqual({ version: 1, provenance: "guest" });
  });

  it("step 8: the Cart cleared at the start is not restored by a failed return", () => {
    const s = setup(metadata("authenticated"));
    s.lifecycle.beginExternalAuthentication();
    expectEmpty(s);
    s.newDocument().initializeGuestIfEmpty();
    expectEmpty(s);
  });

  it("a storage failure while completing never throws (the authentication stays), stops the Cart and leaves it hidden", () => {
    const s = setup(metadataWithExternal("authenticated", "superseded"));
    const returned = s.newDocument();
    s.faults.clear = true;
    expect(() => returned.completeExternalAuthentication()).not.toThrow();
    expect(returned.getSnapshot()).toEqual({ kind: "blocked" });
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });
});

describe("TC-FR-CRT-012-019 a result of an external-completion method after another method succeeded clears the Cart, and the guarantee ends where the specification says (FR-CRT-012 external completion rule steps 3, 5, 6, 7, 9, 10)", () => {
  /** A Guest with a Cart starts the external method in the sending Tab (the pending record). */
  async function started(marker: string | null = metadata("guest")) {
    const s = setup(marker);
    await expect(s.port.startGoogleSignIn(GOOGLE)).resolves.toMatchObject({ kind: "redirect" });
    expect(stored(s)).toEqual(PENDING);
    return s;
  }

  it("steps 5 and 6: Email+Password login while pending records the success; the later result clears the Cart and resolves the record", async () => {
    const s = await started();
    await expect(s.port.signIn(input)).resolves.toMatchObject({ kind: "signed_in" });
    // The existing rule keeps the Guest Cart for the first login; only the record changes.
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(SUPERSEDED);
    s.data.set(CART_STORAGE_KEY, OTHER_CART);
    const returned = s.newDocument();
    returned.completeExternalAuthentication();
    expectEmpty(s);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });

  it.each([
    ["signUp signed_in (a new registration)", "signUp", { kind: "signed_in" }],
    [
      "signIn signed_in with an unverified email",
      "signIn",
      { kind: "signed_in", emailVerified: false },
    ],
    [
      "signInWithEmailOtp signed_in",
      "signInWithEmailOtp",
      { kind: "signed_in", emailVerified: true },
    ],
  ] as const)(
    "step 5: %s records the success of another method (an established Session, verified or not)",
    async (_name, method, result) => {
      const s = await started();
      (s.raw as unknown as Record<string, unknown>)[method] = vi.fn(async () => result);
      const call =
        method === "signInWithEmailOtp"
          ? s.port.signInWithEmailOtp({ email: input.email, code: "246810" })
          : s.port[method](input);
      await expect(call).resolves.toMatchObject({ kind: "signed_in" });
      expect(stored(s)).toEqual(SUPERSEDED);
      s.newDocument().completeExternalAuthentication();
      expectEmpty(s);
    },
  );

  it("step 5: an attempt that does not establish a Session records nothing (confirmation_required, credential_failure, unavailable, a wrong code, a rejected call)", async () => {
    const s = await started();
    s.raw.signUp = vi.fn(async () => ({ kind: "confirmation_required" }) as const);
    s.raw.signIn = vi.fn(async () => ({ kind: "credential_failure" }) as const);
    await s.port.signUp(input);
    await s.port.signIn(input);
    expect(stored(s)).toEqual(PENDING);
    s.raw.signIn = vi.fn(async () => ({ kind: "unavailable" }) as const);
    await s.port.signIn(input);
    s.raw.signInWithEmailOtp = vi.fn(async () => ({ kind: "code_invalid" }) as const);
    await s.port.signInWithEmailOtp({ email: input.email, code: "000000" });
    s.raw.signIn = vi.fn(async () => {
      throw new Error("test-only provider failure");
    });
    await expect(s.port.signIn(input)).rejects.toThrow("test-only provider failure");
    expect(stored(s)).toEqual(PENDING);
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });

  it("step 6 (no other method succeeded): the Cart is kept at the result, with the session observation of the sending Tab in between", async () => {
    const s = await started();
    // Another Tab (the sending one) observes the new Session before the screen shown by the return does.
    s.raw.getSession = authenticatedSession("google.new@example.com");
    await s.port.getSession();
    expect(stored(s)).toMatchObject({ provenance: "authenticated", external: "pending" });
    const returned = s.newDocument();
    returned.markAuthenticated();
    returned.completeExternalAuthentication();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(AUTHENTICATED);
    // The sending Tab observes the Session again: not a return, so nothing is cleared.
    await s.port.getSession();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
  });

  it("step 7: a failed return does not resolve the record; a later login and a later result still clear the Cart", async () => {
    const s = await started();
    // A failed or expired return: the screen does not call completeExternalAuthentication.
    s.newDocument().initializeGuestIfEmpty();
    expect(stored(s)).toEqual(PENDING);
    await s.port.signIn(input);
    expect(stored(s)).toEqual(SUPERSEDED);
    s.newDocument().completeExternalAuthentication();
    expectEmpty(s);
  });

  it("step 7: Logout resolves the record and clears the Cart", async () => {
    const s = await started();
    await s.port.signIn(input);
    await s.port.signOut();
    expectEmpty(s);
    expect(stored(s)).toEqual({ version: 1, provenance: "guest" });
  });

  it("step 3: a request that is unavailable or throws keeps the pending record, and a second start replaces it", async () => {
    const s = setup(metadata("guest"));
    s.raw.startGoogleSignIn = vi.fn(async () => ({ kind: "unavailable" }) as const);
    await expect(s.port.startGoogleSignIn(GOOGLE)).resolves.toEqual({ kind: "unavailable" });
    expect(stored(s)).toEqual(PENDING);
    s.raw.startGoogleSignIn = vi.fn(async () => {
      throw new Error("test-only provider failure");
    });
    await expect(s.port.startGoogleSignIn(GOOGLE)).rejects.toThrow("test-only provider failure");
    expect(stored(s)).toEqual(PENDING);
    // A success of another method, then a Logout-free restart is impossible for a Guest; a session that ended
    // (expiry) leaves a superseded record that the next start replaces, after clearing the used Cart (step 2).
    s.data.set(CART_LIFECYCLE_STORAGE_KEY, metadataWithExternal("authenticated", "superseded"));
    s.raw.startGoogleSignIn = vi.fn(async () => ({ kind: "unavailable" }) as const);
    await s.port.startGoogleSignIn(GOOGLE);
    expect(stored(s)).toEqual(PENDING);
    expectEmpty(s);
  });

  it("step 10 (limit, with a record): after another method succeeded and before the screen shown by the return exists, a changed Session is not distinguishable: nothing is cleared and the record stays", async () => {
    const s = await started();
    await s.port.signIn(input);
    s.raw.getSession = authenticatedSession("other@example.com");
    await s.port.getSession();
    await s.port.getSession();
    // This pins the specified limit (the lifecycle holds no Account information); it is not a proof that another
    // Account's Cart is never shown.
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(SUPERSEDED);
    // The limit ends at the next screen shown by a return ...
    s.newDocument().completeExternalAuthentication();
    expectEmpty(s);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });

  it("step 10 (limit ends at Logout)", async () => {
    const s = await started();
    await s.port.signIn(input);
    s.raw.getSession = authenticatedSession("other@example.com");
    await s.port.getSession();
    expect(stored(s)).toEqual(SUPERSEDED);
    await s.port.signOut();
    expectEmpty(s);
    expect(stored(s)).toEqual({ version: 1, provenance: "guest" });
  });

  it("step 10 (limit, without a record): a Session that changes with no screen shown by a return is not distinguishable; the next return clears the used Cart by step 9", async () => {
    const s = setup(metadata("guest"));
    await s.port.signIn(input);
    expect(stored(s)).toEqual(AUTHENTICATED);
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    s.raw.getSession = authenticatedSession("other@example.com");
    await s.port.getSession();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(AUTHENTICATED);
    s.newDocument().completeExternalAuthentication();
    expectEmpty(s);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });

  it("step 9 (a Link opened in another Browser or after Logout): a Guest Cart is kept at the return when it was never used by a Session", () => {
    const s = setup(metadata("guest"));
    s.lifecycle.initializeGuestIfEmpty();
    const returned = s.newDocument();
    returned.markAuthenticated();
    returned.completeExternalAuthentication();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });

  it("step 9 (the second return): after a first receipt, a second screen shown by a return treats the Cart as used and clears it, like a re-login", () => {
    const s = setup(metadataWithExternal("guest", "pending"));
    const first = s.newDocument();
    first.markAuthenticated();
    first.completeExternalAuthentication();
    expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(s)).toEqual(AUTHENTICATED);
    const second = s.newDocument();
    second.markAuthenticated();
    second.completeExternalAuthentication();
    expectEmpty(s);
    expect(stored(s)).toEqual(AUTHENTICATED);
  });
});
