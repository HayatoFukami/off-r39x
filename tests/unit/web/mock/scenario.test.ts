import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO,
  defaultScenario,
  loadScenario,
  resetScenario,
  SCENARIO_STORAGE_KEY,
  saveScenario,
  scenarioSchema,
} from "../../../../apps/web/src/mock/backend/scenario.ts";
import { createMemoryStorage } from "../../../harness/mock-backend.ts";

describe("TC-DEV-WEB-013-101 scenario schema and defaults (design section 8, DEV-TS-004)", () => {
  it("uses the documented storage key", () => {
    expect(SCENARIO_STORAGE_KEY).toBe("r39x.mock.scenario.v1");
  });

  it("defines every switch with the documented default", () => {
    expect(defaultScenario()).toEqual({
      version: 1,
      publicFetch: "ok",
      latency: "none",
      latencyLongMs: 3000,
      sponsorLogos: "published",
      cart: { state: "ok", purchaseStart: "ok" },
      checkout: "ok",
      karaokeHold: "ok",
      karaokeSales: "ON_SALE",
      paymentOutcome: "confirm_after_recheck",
      notification: "sent",
      auth: {
        session: "ok",
        login: "ok",
        signup: "confirmation_required",
        verify: "ok",
        reset: "ok",
        resetContext: "valid",
        logout: "ok",
      },
      eventFields: "complete",
    });
    expect(DEFAULT_SCENARIO).toEqual(defaultScenario());
  });

  it("returns a fresh object each time so callers cannot corrupt the defaults", () => {
    const a = defaultScenario();
    a.cart.state = "fail";
    expect(defaultScenario().cart.state).toBe("ok");
    expect(DEFAULT_SCENARIO.cart.state).toBe("ok");
  });

  it("accepts the default and every documented value", () => {
    expect(scenarioSchema.safeParse(defaultScenario()).success).toBe(true);
    const variants: [string, unknown][] = [
      ["publicFetch", "fail"],
      ["publicFetch", "empty"],
      ["latency", "long"],
      ["sponsorLogos", "none"],
      ["sponsorLogos", "fail"],
      ["sponsorLogos", "image_broken"],
      ["checkout", "start_failed"],
      ["checkout", "opportunity_expired"],
      ["karaokeHold", "conflict"],
      ["karaokeHold", "limit"],
      ["karaokeHold", "expire_before_checkout"],
      ["karaokeSales", "BEFORE_SALES"],
      ["karaokeSales", "SALES_ENDED"],
      ["karaokeSales", "SUSPENDED"],
      ["paymentOutcome", "confirm"],
      ["paymentOutcome", "remain_awaiting"],
      ["paymentOutcome", "payment_failed"],
      ["paymentOutcome", "review_required"],
      ["paymentOutcome", "expire"],
      ["paymentOutcome", "cancel"],
      ["notification", "failed_retryable"],
      ["eventFields", "missing_optional"],
    ];
    for (const [key, value] of variants) {
      const result = scenarioSchema.safeParse({ ...defaultScenario(), [key]: value });
      expect(result.success, `${key}=${String(value)}`).toBe(true);
    }
  });

  it("accepts every nested cart and auth value", () => {
    const auth = defaultScenario().auth;
    const cases = [
      { cart: { state: "fail", purchaseStart: "ok" } },
      { cart: { state: "partial", purchaseStart: "reject_one" } },
      { cart: { state: "ok", purchaseStart: "limit" } },
      { cart: { state: "ok", purchaseStart: "unavailable" } },
      { auth: { ...auth, session: "unavailable" } },
      { auth: { ...auth, login: "credential_failure" } },
      { auth: { ...auth, login: "unavailable" } },
      { auth: { ...auth, signup: "signed_in" } },
      { auth: { ...auth, signup: "rejected" } },
      { auth: { ...auth, signup: "unavailable" } },
      { auth: { ...auth, verify: "invalid_or_expired" } },
      { auth: { ...auth, verify: "unavailable" } },
      { auth: { ...auth, reset: "unavailable" } },
      { auth: { ...auth, resetContext: "invalid" } },
      { auth: { ...auth, logout: "provider_failure" } },
    ];
    for (const patch of cases) {
      expect(scenarioSchema.safeParse({ ...defaultScenario(), ...patch }).success).toBe(true);
    }
  });

  it("is strict at every level and rejects unknown keys, values and versions", () => {
    const base = defaultScenario();
    expect(scenarioSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...base, cart: { ...base.cart, extra: 1 } }).success).toBe(
      false,
    );
    expect(scenarioSchema.safeParse({ ...base, auth: { ...base.auth, extra: 1 } }).success).toBe(
      false,
    );
    expect(scenarioSchema.safeParse({ ...base, publicFetch: "slow" }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...base, paymentOutcome: "success" }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
    const { eventFields: _omitted, ...missing } = base;
    expect(scenarioSchema.safeParse(missing).success).toBe(false);
  });

  it("bounds latencyLongMs to an integer in 1..60000", () => {
    const base = defaultScenario();
    for (const ok of [1, 3000, 60000]) {
      expect(scenarioSchema.safeParse({ ...base, latencyLongMs: ok }).success).toBe(true);
    }
    for (const bad of [0, -1, 60001, 1.5, Number.NaN]) {
      expect(scenarioSchema.safeParse({ ...base, latencyLongMs: bad }).success).toBe(false);
    }
  });
});

describe("TC-DEV-WEB-013-102 scenario persistence never turns corruption into defaults", () => {
  it("returns defaults for a missing key without writing anything", () => {
    const storage = createMemoryStorage();
    expect(loadScenario(storage)).toEqual({ kind: "ok", scenario: defaultScenario() });
    expect(storage.writes).toEqual([]);
  });

  it("round-trips a saved scenario", () => {
    const storage = createMemoryStorage();
    const scenario = { ...defaultScenario(), paymentOutcome: "confirm" as const };
    saveScenario(storage, scenario);
    expect(loadScenario(storage)).toEqual({ kind: "ok", scenario });
  });

  it("refuses to save an invalid scenario and leaves the storage untouched", () => {
    const storage = createMemoryStorage();
    expect(() =>
      saveScenario(storage, { ...defaultScenario(), publicFetch: "slow" } as never),
    ).toThrow();
    expect(storage.writes).toEqual([]);
  });

  it.each([
    ["not json", "{oops"],
    ["unknown key", JSON.stringify({ ...defaultScenario(), extra: true })],
    ["unknown value", JSON.stringify({ ...defaultScenario(), checkout: "boom" })],
    ["wrong version", JSON.stringify({ ...defaultScenario(), version: 9 })],
    ["wrong type", JSON.stringify({ ...defaultScenario(), latencyLongMs: "3000" })],
    ["a primitive", "42"],
    ["null", "null"],
  ])("reports corrupted for %s and does not write or delete", (_name, raw) => {
    const storage = createMemoryStorage();
    storage.seedRaw(SCENARIO_STORAGE_KEY, raw);
    const loaded = loadScenario(storage);
    expect(loaded.kind).toBe("corrupted");
    if (loaded.kind === "corrupted") {
      expect(typeof loaded.message).toBe("string");
      expect(loaded.message).not.toContain("boom");
    }
    expect(storage.writes).toEqual([]);
    expect(storage.getItem(SCENARIO_STORAGE_KEY)).toBe(raw);
  });

  it("recovers only through an explicit resetScenario", () => {
    const storage = createMemoryStorage();
    storage.seedRaw(SCENARIO_STORAGE_KEY, "{oops");
    expect(loadScenario(storage).kind).toBe("corrupted");
    expect(resetScenario(storage)).toEqual(defaultScenario());
    expect(loadScenario(storage)).toEqual({ kind: "ok", scenario: defaultScenario() });
  });
});
