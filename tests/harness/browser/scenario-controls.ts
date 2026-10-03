// Scenario controls rendered by /dev/scenarios (tests/contracts/s3-layout.md section 8.2).
// The unit test scenario-controls.test.ts keeps this list in sync with the S2 zod schema.

export type ScenarioControl = {
  readonly path: string;
  readonly kind: "select" | "number";
  readonly values: readonly string[];
};

export const SCENARIO_CONTROLS: readonly ScenarioControl[] = [
  { path: "publicFetch", kind: "select", values: ["ok", "fail", "empty"] },
  { path: "latency", kind: "select", values: ["none", "long"] },
  { path: "latencyLongMs", kind: "number", values: [] },
  {
    path: "sponsorLogos",
    kind: "select",
    values: ["published", "none", "fail", "image_broken"],
  },
  { path: "cart.state", kind: "select", values: ["ok", "fail", "partial"] },
  {
    path: "cart.purchaseStart",
    kind: "select",
    values: ["ok", "reject_one", "limit", "unavailable"],
  },
  { path: "checkout", kind: "select", values: ["ok", "start_failed", "opportunity_expired"] },
  {
    path: "karaokeHold",
    kind: "select",
    values: ["ok", "conflict", "limit", "expire_before_checkout"],
  },
  {
    path: "karaokeSales",
    kind: "select",
    values: ["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"],
  },
  {
    path: "paymentOutcome",
    kind: "select",
    values: [
      "confirm_after_recheck",
      "confirm",
      "remain_awaiting",
      "payment_failed",
      "review_required",
      "expire",
      "cancel",
    ],
  },
  { path: "notification", kind: "select", values: ["sent", "failed_retryable"] },
  { path: "auth.session", kind: "select", values: ["ok", "unavailable"] },
  { path: "auth.login", kind: "select", values: ["ok", "credential_failure", "unavailable"] },
  {
    path: "auth.signup",
    kind: "select",
    values: ["confirmation_required", "signed_in", "rejected", "unavailable"],
  },
  { path: "auth.verify", kind: "select", values: ["ok", "invalid_or_expired", "unavailable"] },
  { path: "auth.reset", kind: "select", values: ["ok", "unavailable"] },
  { path: "auth.resetContext", kind: "select", values: ["valid", "invalid"] },
  { path: "auth.logout", kind: "select", values: ["ok", "provider_failure"] },
  { path: "eventFields", kind: "select", values: ["complete", "missing_optional"] },
];
