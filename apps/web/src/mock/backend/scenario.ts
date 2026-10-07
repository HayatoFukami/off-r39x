import { z } from "zod";
import type { MockStorage } from "./db";

// Scenario switches reproduce failure and edge states for the UI mock (design section 8).
// A stored value is validated before use; corruption is reported, never replaced by defaults.

export const SCENARIO_STORAGE_KEY = "r39x.mock.scenario.v1";

export const scenarioSchema = z.strictObject({
  version: z.literal(1),
  publicFetch: z.enum(["ok", "fail", "empty"]),
  latency: z.enum(["none", "long"]),
  latencyLongMs: z.number().int().min(1).max(60000),
  sponsorLogos: z.enum(["published", "none", "fail", "image_broken"]),
  cart: z.strictObject({
    state: z.enum(["ok", "fail", "partial"]),
    purchaseStart: z.enum(["ok", "reject_one", "limit", "unavailable"]),
  }),
  checkout: z.enum(["ok", "start_failed", "opportunity_expired"]),
  karaokeHold: z.enum(["ok", "conflict", "limit", "expire_before_checkout"]),
  karaokeSales: z.enum(["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"]),
  paymentOutcome: z.enum([
    "confirm_after_recheck",
    "confirm",
    "remain_awaiting",
    "payment_failed",
    "review_required",
    "expire",
    "cancel",
  ]),
  notification: z.enum(["sent", "failed_retryable"]),
  auth: z.strictObject({
    session: z.enum(["ok", "unavailable"]),
    login: z.enum(["ok", "credential_failure", "unavailable"]),
    signup: z.enum(["confirmation_required", "signed_in", "rejected", "unavailable"]),
    verify: z.enum(["ok", "invalid_or_expired", "unavailable"]),
    reset: z.enum(["ok", "unavailable"]),
    resetContext: z.enum(["valid", "invalid"]),
    logout: z.enum(["ok", "provider_failure"]),
  }),
  eventFields: z.enum(["complete", "missing_optional"]),
});

export type Scenario = z.infer<typeof scenarioSchema>;

/** Always returns a fresh object so callers cannot corrupt the defaults. */
export function defaultScenario(): Scenario {
  return {
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
  };
}

function freezeScenario(scenario: Scenario): Readonly<Scenario> {
  Object.freeze(scenario.cart);
  Object.freeze(scenario.auth);
  return Object.freeze(scenario);
}

export const DEFAULT_SCENARIO: Readonly<Scenario> = freezeScenario(defaultScenario());

export type ScenarioLoad =
  | { kind: "ok"; scenario: Scenario }
  | { kind: "corrupted"; message: string };

// The message never echoes the stored value (it may contain material that must not be shown).
const CORRUPTED_MESSAGE = "The stored mock scenario is not valid. Reset it to recover.";

export function loadScenario(storage: MockStorage): ScenarioLoad {
  const raw = storage.getItem(SCENARIO_STORAGE_KEY);
  if (raw === null) {
    return { kind: "ok", scenario: defaultScenario() };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "corrupted", message: CORRUPTED_MESSAGE };
  }
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "corrupted", message: CORRUPTED_MESSAGE };
  }
  return { kind: "ok", scenario: parsed.data };
}

/** Validates, then stores. An invalid scenario throws and leaves the storage untouched. */
export function saveScenario(storage: MockStorage, scenario: Scenario): void {
  const parsed = scenarioSchema.parse(scenario);
  storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(parsed));
}

/** Explicit recovery from a corrupted scenario: stores and returns the defaults. */
export function resetScenario(storage: MockStorage): Scenario {
  const scenario = defaultScenario();
  saveScenario(storage, scenario);
  return scenario;
}
