import { describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "../../../../apps/web/src/features/cart/cart-count.ts";
import {
  CART_LIFECYCLE_STORAGE_KEY,
  type CartLifecycle,
} from "../../../../apps/web/src/features/cart/cart-lifecycle.ts";
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
// A Cart of unknown provenance that has a record (tests/contracts/s6-auth.md section 10A, "the unknown form"): the
// record is not lost when the provenance is unknown. Written with JSON.stringify because the harness helpers take
// only the provenances guest and authenticated.
const UNKNOWN_PENDING = { version: 1, provenance: "unknown", external: "pending" };
const UNKNOWN_SUPERSEDED = { version: 1, provenance: "unknown", external: "superseded" };
const GOOGLE = {
  successPath: "/account/login?returned=google",
  failurePath: "/account/login?notice=google-failed",
};

const stored = (s: Setup): unknown => {
  const raw = s.data.get(CART_LIFECYCLE_STORAGE_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
};

/** What the Cart screen may show: the same gate as use-cart.ts (a lifecycle that is not ready hides the rows). */
function shown(lifecycle: CartLifecycle, s: Setup) {
  const gate = lifecycle.getSnapshot();
  return gate.kind === "ready" ? s.store.getSnapshot() : gate;
}

/** Lets the lock probe of an instance (a promise chain over the test lock manager) settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

  // F-3: the unknown-provenance form with a record. The record has to survive a recovery that cannot confirm the
  // Session (step 7), so a non-transition value with provenance "unknown" is valid when it carries `external`.
  it("the unknown-provenance form with a record is valid and is read like a missing metadata key; without a record it stays invalid", () => {
    const withRecord = (external: "pending" | "superseded") =>
      JSON.stringify({ version: 1, provenance: "unknown", external });

    // A Cart is present: a Guest observation does not change it (the Cart is not Guest-provenance), a Session
    // observation clears it like a missing key does, and the record is kept.
    const kept = setup(withRecord("pending"));
    kept.lifecycle.initializeGuestIfEmpty();
    expect(kept.data.get(CART_STORAGE_KEY)).toBe(CART);
    expect(stored(kept)).toEqual(UNKNOWN_PENDING);
    kept.lifecycle.markAuthenticated();
    expectEmpty(kept);
    expect(stored(kept)).toEqual({ version: 1, provenance: "authenticated", external: "pending" });

    // No Cart: a Guest observation makes the empty Cart Guest-provenance (as a missing key does) and keeps the record.
    const empty = setup(withRecord("pending"));
    empty.data.delete(CART_STORAGE_KEY);
    empty.lifecycle.initializeGuestIfEmpty();
    expect(stored(empty)).toEqual(PENDING);
    const emptySuperseded = setup(withRecord("superseded"));
    emptySuperseded.data.delete(CART_STORAGE_KEY);
    emptySuperseded.lifecycle.initializeGuestIfEmpty();
    expect(stored(emptySuperseded)).toEqual({
      version: 1,
      provenance: "guest",
      external: "superseded",
    });

    // The document of a return judges by the record (step 6): superseded clears.
    const superseded = setup(withRecord("superseded"));
    const returned = superseded.newDocument();
    returned.completeExternalAuthentication();
    expectEmpty(superseded);
    expect(stored(superseded)).toEqual(AUTHENTICATED);

    // Without a record the form stays invalid: the Cart is of unknown provenance and nothing is kept.
    for (const raw of [
      { version: 1, provenance: "unknown" },
      { version: 1, provenance: "unknown", external: "done" },
      { version: 1, provenance: "unknown", external: "pending", accountId: "x" },
    ]) {
      const s = setup(JSON.stringify(raw));
      s.lifecycle.markAuthenticated();
      expectEmpty(s);
      expect(stored(s), JSON.stringify(raw)).toEqual(AUTHENTICATED);
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

  it("step 7: aborting a memory-only transition of unknown provenance keeps a record another Tab wrote meanwhile", () => {
    // No metadata, the default memory-only coordinator: the transition is held in memory and writes no metadata.
    const s = setup(null);
    expect(s.lifecycle.beginTransition()).toEqual({ kind: "ready", provenance: "unknown" });
    expect(stored(s)).toBeUndefined();
    // Another Tab starts an external sign-in meanwhile (it clears the Cart of unknown provenance, writes pending).
    expect(s.newDocument().beginExternalAuthentication()).toEqual({ kind: "ready" });
    expect(stored(s)).toEqual(PENDING);
    s.lifecycle.abortTransition("unknown");
    expect(stored(s)).toEqual(UNKNOWN_PENDING);
    expectEmpty(s);
    expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
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

// The two external-completion methods start through the same lifecycle transition; the journeys below are the same for
// both (B5 C3 adds Magic Link: the link is opened in another Tab or on another device, and the result is received by
// the screen the opening navigation shows). Each method runs every case.
type Starter = {
  readonly label: string;
  /** The raw port method the decorator calls after the pending record is written. */
  readonly rawKey: "startGoogleSignIn" | "requestMagicLink";
  /** Starts through the decorator. */
  readonly start: (s: Setup) => Promise<unknown>;
  /** What the raw port answers when the request is accepted. */
  readonly accepted: { readonly kind: string };
};
const MAGIC_LINK_INPUT = {
  email: "magic.sentinel@example.com",
  successPath: "/account/login?returned=magic-link",
  failurePath: "/account/login?notice=link-failed",
};
const STARTERS: readonly Starter[] = [
  {
    label: "Google",
    rawKey: "startGoogleSignIn",
    start: (s) => s.port.startGoogleSignIn(GOOGLE),
    accepted: { kind: "redirect" },
  },
  {
    label: "Magic Link",
    rawKey: "requestMagicLink",
    start: (s) => s.port.requestMagicLink(MAGIC_LINK_INPUT),
    accepted: { kind: "sent" },
  },
];

for (const starter of STARTERS) {
  describe(`TC-FR-CRT-012-019 a result of an external-completion method after another method succeeded clears the Cart, and the guarantee ends where the specification says (FR-CRT-012 external completion rule steps 3, 5, 6, 7, 9, 10) - ${starter.label}`, () => {
    /** A Guest with a Cart starts the external method in the sending Tab (the pending record). */
    async function started(marker: string | null = metadata("guest")) {
      const s = setup(marker);
      await expect(starter.start(s)).resolves.toMatchObject(starter.accepted);
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

    it("step 5: when the Cart of another provenance cannot be cleared at the success of another method, the success is still recorded as superseded, and after a recovery the later result clears the Cart", async () => {
      const s = await started();
      // Another document observes the new Session first: the provenance becomes authenticated, the record stays pending.
      s.newDocument().markAuthenticated();
      expect(stored(s)).toEqual({ version: 1, provenance: "authenticated", external: "pending" });
      // The Cart of authenticated provenance has to be cleared at the success, and the clear fails.
      s.faults.clear = true;
      await expect(s.port.signIn(input)).resolves.toMatchObject({ kind: "signed_in" });
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
      expect(stored(s)).toEqual(SUPERSEDED);
      // Recovery keeps the record; the Cart added afterwards is judged by it at the result (step 6).
      s.faults.clear = false;
      await expect(s.lifecycle.recover("authenticated")).resolves.toBe("recovered");
      expectEmpty(s);
      expect(stored(s)).toEqual(SUPERSEDED);
      s.data.set(CART_STORAGE_KEY, OTHER_CART);
      s.newDocument().completeExternalAuthentication();
      expectEmpty(s);
      expect(stored(s)).toEqual(AUTHENTICATED);
    });

    // R-1 (B5 re-review). With Web Locks the transition is written to the metadata. A Cart that cannot be cleared at the
    // success of another method must keep that transition marker (provenance and "transitioning" unchanged, only the
    // record changes), so that another Tab does not read a non-transition value and show the previous Account's Cart.
    it.each([
      ["a Cart of authenticated provenance", "authenticated"],
      ["a Cart of unknown provenance", "unknown"],
    ] as const)(
      "step 5 (R-1, with Web Locks): when %s cannot be cleared at the success of another method, the transition marker stays with the record superseded; another instance is stopped, not ready, and a recovery then the later result clear the Cart",
      async (_name, provenance) => {
        const s = setup(
          metadata("guest"),
          createWebCartTransitionCoordinator(new TestLockManager()),
        );
        await expect(starter.start(s)).resolves.toMatchObject(starter.accepted);
        expect(stored(s)).toEqual(PENDING);
        // The start's lock is released asynchronously; the sign-in below needs it free.
        await settle();
        if (provenance === "authenticated") {
          // Another document observes the new Session first.
          s.newDocument().markAuthenticated();
          expect(stored(s)).toEqual({ version: 1, provenance, external: "pending" });
        } else {
          // A recovery that could not confirm the Session left a Cart of unknown provenance with the record.
          s.data.set(CART_LIFECYCLE_STORAGE_KEY, JSON.stringify(UNKNOWN_PENDING));
        }

        s.faults.clear = true;
        await expect(s.port.signIn(input)).resolves.toMatchObject({ kind: "signed_in" });

        // The transition marker is kept: provenance and "transitioning" as the transition wrote them.
        expect(stored(s)).toEqual({
          version: 1,
          provenance,
          transitioning: true,
          external: "superseded",
        });
        expect(s.lifecycle.getSnapshot()).toEqual({ kind: "blocked" });
        // The previous Account's Cart could not be cleared and is still in storage.
        expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);

        // The lock is released after the sign-in; no transition is in flight.
        await expect(s.coordinator.isHeld()).resolves.toBe(false);

        // Another instance (another Tab) that never subscribed does not read a ready Cart ...
        expect(s.newDocument().getSnapshot().kind).not.toBe("ready");
        // ... and one that subscribes finds the transition marker without its lock: stopped, rows hidden.
        const otherTab = s.newDocument();
        const stop = otherTab.subscribe(() => undefined);
        await settle();
        expect(otherTab.getSnapshot()).toEqual({ kind: "blocked" });
        expect(shown(otherTab, s)).toEqual({ kind: "blocked" });
        expect(s.data.get(CART_STORAGE_KEY)).toBe(CART);

        // The recovery (the sending Tab, which is stopped too) keeps the record and ends the transition marker; the
        // Cart added afterwards is judged by the record (step 6). The other Tab leaves its stop once it re-reads.
        s.faults.clear = false;
        await expect(s.lifecycle.recover("authenticated")).resolves.toBe("recovered");
        expectEmpty(s);
        expect(stored(s)).toEqual(SUPERSEDED);
        await settle();
        expect(otherTab.getSnapshot()).toEqual({ kind: "ready" });
        s.data.set(CART_STORAGE_KEY, OTHER_CART);
        s.newDocument().completeExternalAuthentication();
        expectEmpty(s);
        expect(stored(s)).toEqual(AUTHENTICATED);
        stop();
      },
    );

    it("step 5 (R-1, consistency guard, with Web Locks): a lifecycle that was already stopped keeps the transition marker the same way when another method succeeds", async () => {
      const s = setup(metadata("guest"), createWebCartTransitionCoordinator(new TestLockManager()));
      await starter.start(s);
      await settle();
      s.newDocument().markAuthenticated();
      // The lifecycle of the sending Tab is stopped while its sign-in is in flight.
      s.raw.signIn = vi.fn(async () => {
        s.lifecycle.block();
        return { kind: "signed_in", emailVerified: true } as const;
      });
      await expect(s.port.signIn(input)).resolves.toMatchObject({ kind: "signed_in" });
      expect(stored(s)).toEqual({
        version: 1,
        provenance: "authenticated",
        transitioning: true,
        external: "superseded",
      });
      const otherTab = s.newDocument();
      const stop = otherTab.subscribe(() => undefined);
      await settle();
      expect(otherTab.getSnapshot()).toEqual({ kind: "blocked" });
      expect(shown(otherTab, s)).toEqual({ kind: "blocked" });
      stop();
    });

    // I-b. A record is not a reason to keep a Cart of unknown provenance: the rule of the cell (a Cart of unknown
    // provenance is cleared when the Session is confirmed) takes precedence over `pending`. The contract does not rely
    // on a Session observation having cleared it first.
    it.each(["pending", "superseded"] as const)(
      "step 6 (I-b): completeExternalAuthentication alone, from a Cart of unknown provenance with the record %s, clears the Cart and resolves the record",
      async (record) => {
        const s = await started();
        if (record === "superseded") await s.port.signIn(input);
        expect(stored(s)).toEqual(record === "pending" ? PENDING : SUPERSEDED);
        s.lifecycle.block();
        await expect(s.lifecycle.recover("unknown")).resolves.toBe("recovered");
        expect(stored(s)).toEqual(record === "pending" ? UNKNOWN_PENDING : UNKNOWN_SUPERSEDED);

        // A Cart made before any Session observation; no markAuthenticated runs before the receipt.
        s.data.set(CART_STORAGE_KEY, OTHER_CART);
        const returned = s.newDocument();
        returned.completeExternalAuthentication();
        expectEmpty(s);
        expect(stored(s)).toEqual(AUTHENTICATED);
        expect(returned.getSnapshot()).toEqual({ kind: "ready" });
        // One receipt per return: the Cart added afterwards is not touched by a second call.
        s.data.set(CART_STORAGE_KEY, OTHER_CART);
        returned.completeExternalAuthentication();
        expect(s.data.get(CART_STORAGE_KEY)).toBe(OTHER_CART);
      },
    );

    it('step 7: a recovery while the Session is not confirmed (recover("unknown"), as CartRecovery does) keeps a superseded record, and a later result is still judged by it (step 6)', async () => {
      const s = await started();
      await s.port.signIn(input);
      expect(stored(s)).toEqual(SUPERSEDED);
      s.lifecycle.block();

      await expect(s.lifecycle.recover("unknown")).resolves.toBe("recovered");
      expectEmpty(s);
      expect(stored(s)).toEqual(UNKNOWN_SUPERSEDED);
      expect(s.lifecycle.getSnapshot()).toEqual({ kind: "ready" });
      expect(s.data.get(CART_LIFECYCLE_STORAGE_KEY)).not.toMatch(
        /@|email|account|subject|role|token/i,
      );

      // The Session turns out to be a Guest's: the empty Cart is Guest-provenance and the record stays.
      s.lifecycle.initializeGuestIfEmpty();
      expect(stored(s)).toEqual({ version: 1, provenance: "guest", external: "superseded" });

      // A Guest then makes a Cart; the result that arrives later is judged by the record: superseded clears.
      s.data.set(CART_STORAGE_KEY, OTHER_CART);
      const returned = s.newDocument();
      returned.markAuthenticated();
      returned.completeExternalAuthentication();
      expectEmpty(s);
      expect(stored(s)).toEqual(AUTHENTICATED);
    });

    it('step 7: with a pending record, recover("unknown") keeps it; another document\'s Session observation clears only the Cart of unknown provenance and keeps the record; the return resolves it', async () => {
      const s = await started();
      s.lifecycle.block();

      await expect(s.lifecycle.recover("unknown")).resolves.toBe("recovered");
      expectEmpty(s);
      expect(stored(s)).toEqual(UNKNOWN_PENDING);

      // A Cart made before the Session is observed is of unknown provenance: a Session observation of a screen that
      // is not the return clears it (the unknown-provenance rule of FR-CRT-012; contract section 9, item 15) and keeps
      // the record (step 7).
      s.data.set(CART_STORAGE_KEY, OTHER_CART);
      s.newDocument().markAuthenticated();
      expectEmpty(s);
      expect(stored(s)).toEqual({ version: 1, provenance: "authenticated", external: "pending" });

      // The screen shown by the return resolves the record (step 6) and has nothing left to keep or clear.
      const returned = s.newDocument();
      returned.markAuthenticated();
      returned.completeExternalAuthentication();
      expect(stored(s)).toEqual(AUTHENTICATED);
      expectEmpty(s);
    });

    it("step 3: a request that is unavailable or throws keeps the pending record, and a second start (a re-send for Magic Link) replaces it", async () => {
      const s = setup(metadata("guest"));
      const raw = s.raw as unknown as Record<string, unknown>;
      raw[starter.rawKey] = vi.fn(async () => ({ kind: "unavailable" }) as const);
      await expect(starter.start(s)).resolves.toEqual({ kind: "unavailable" });
      expect(stored(s)).toEqual(PENDING);
      raw[starter.rawKey] = vi.fn(async () => {
        throw new Error("test-only provider failure");
      });
      await expect(starter.start(s)).rejects.toThrow("test-only provider failure");
      expect(stored(s)).toEqual(PENDING);
      // A success of another method, then a Logout-free restart is impossible for a Guest; a session that ended
      // (expiry) leaves a superseded record that the next start replaces, after clearing the used Cart (step 2).
      s.data.set(CART_LIFECYCLE_STORAGE_KEY, metadataWithExternal("authenticated", "superseded"));
      raw[starter.rawKey] = vi.fn(async () => ({ kind: "unavailable" }) as const);
      await starter.start(s);
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
}
