// DEV-RLM-004: the single Class ID registry. Canonical ceilings, the RATE_LIMIT_CONFIG schema,
// the Operation -> class assignment and the metric label values are all derived from this const.
// Content is checked against SPEC-140 §68 and SPEC-110 §56.1 by tests (TST-RLM-006 / 007).

export const BURST_WINDOW_SECONDS = 10;
export const SUSTAINED_WINDOW_SECONDS = 60;

/** `SPEC-160` §24.1 rule_category. */
export type RuleCategory = "burst" | "sustained" | "resource" | "global" | "guard";
/** Which identity a rule is counted for. */
export type RuleSubject = "ip" | "auth_subject" | "identifier" | "resource" | "global";
/**
 * Evaluation phase (SPEC-140 SEC-ABU-017 / SPEC-110 §24.1).
 * pre_auth: stage 1, before token verification. subject: stage 2 after token verification.
 * resource: stage 2 after the resource/QR input was syntactically validated.
 */
export type RulePhase = "pre_auth" | "subject" | "resource";

interface AdditionalRuleDefinition {
  readonly subject: RuleSubject;
  readonly phase: RulePhase;
  readonly category: RuleCategory;
  readonly ceiling: number;
  readonly windowSeconds: number;
}
const additional = (
  subject: RuleSubject,
  phase: RulePhase,
  category: RuleCategory,
  ceiling: number,
  windowSeconds: number,
): AdditionalRuleDefinition => Object.freeze({ subject, phase, category, ceiling, windowSeconds });

type GuardId = "auth_failure_guard_attendee" | "auth_failure_guard_operator";
interface ClassDefinition {
  /** `guard` classes are not Operation classes; they hang off the route classes (SPEC-140 §68.1). */
  readonly kind: "route" | "guard";
  /** The identity of the burst/sustained rules. ip => stage 1; auth_subject => stage 2. */
  readonly primary: "ip" | "auth_subject";
  readonly burst: number;
  readonly sustained: number;
  /** Additional resource/global rules keyed by implementation-assigned unique rule ID (INF-RLS-009). */
  readonly additional: Readonly<Record<string, AdditionalRuleDefinition>>;
  readonly guard?: GuardId;
}
const route = <
  const E extends Readonly<Record<string, AdditionalRuleDefinition>> = Readonly<
    Record<never, never>
  >,
>(
  primary: "ip" | "auth_subject",
  burst: number,
  sustained: number,
  extra: E = {} as E,
  guard?: GuardId,
): ClassDefinition & { readonly kind: "route"; readonly additional: E } =>
  Object.freeze({
    kind: "route" as const,
    primary,
    burst,
    sustained,
    additional: Object.freeze(extra),
    ...(guard ? { guard } : {}),
  });
const guardClass = (): ClassDefinition & {
  readonly kind: "guard";
  readonly additional: Readonly<Record<never, never>>;
} =>
  Object.freeze({
    kind: "guard" as const,
    primary: "ip" as const,
    burst: 20,
    sustained: 50,
    additional: Object.freeze({}),
  });

export const RATE_LIMIT_REGISTRY = Object.freeze({
  public_read: route("ip", 20, 120, {
    "public_read.global": additional("global", "pre_auth", "global", 10000, 60),
  }),
  auth_form_proxy: route("ip", 5, 20, {
    "auth_form_proxy.identifier": additional("identifier", "pre_auth", "resource", 5, 600),
  }),
  // SEC-ABU-027: session lookups / sign-out of the `/auth/*` proxy. Per-IP only (stage 1), no
  // identifier rule, no guard; its counters are independent of auth_form_proxy.
  auth_session: route("ip", 100, 600),
  // SEC-ABU-028: the email-link completion GETs (verify-email, magic-link/verify). Per-IP only
  // (stage 1), no identifier rule, no guard; independent of auth_form_proxy and auth_session.
  auth_callback: route("ip", 30, 120),
  // IP 240/min and 300/min are looser than the sustained subject limit; the Burst/Sustained
  // columns therefore belong to the subject, the IP only carries the additional rule.
  self_read: route("auth_subject", 30, 120, {
    "self_read.ip": additional("ip", "pre_auth", "sustained", 240, 60),
  }),
  purchase_checkout: route(
    "auth_subject",
    3,
    12,
    { "purchase_checkout.resource": additional("resource", "resource", "resource", 60, 60) },
    "auth_failure_guard_attendee",
  ),
  qr_display: route(
    "auth_subject",
    6,
    30,
    { "qr_display.ticket": additional("resource", "resource", "resource", 12, 60) },
    "auth_failure_guard_attendee",
  ),
  profile_mutation: route("auth_subject", 3, 10, {}, "auth_failure_guard_attendee"),
  staff_checkin: route("auth_subject", 40, 180, {
    "staff_checkin.qr_digest": additional("resource", "resource", "resource", 30, 60),
    "staff_checkin.ip": additional("ip", "pre_auth", "sustained", 300, 60),
  }),
  goods_handoff: route(
    "auth_subject",
    10,
    60,
    { "goods_handoff.item": additional("resource", "resource", "resource", 10, 60) },
    "auth_failure_guard_operator",
  ),
  admin_mutation: route(
    "auth_subject",
    10,
    30,
    { "admin_mutation.resource": additional("resource", "resource", "resource", 15, 60) },
    "auth_failure_guard_operator",
  ),
  role_assignment: route(
    "auth_subject",
    3,
    10,
    { "role_assignment.profile": additional("resource", "resource", "resource", 5, 600) },
    "auth_failure_guard_operator",
  ),
  high_risk_recovery: route(
    "auth_subject",
    2,
    6,
    {
      "high_risk_recovery.resource_minute": additional("resource", "resource", "resource", 2, 60),
      "high_risk_recovery.resource_hour": additional("resource", "resource", "resource", 10, 3600),
    },
    "auth_failure_guard_operator",
  ),
  stripe_webhook: route("ip", 100, 300, {
    "stripe_webhook.global": additional("global", "pre_auth", "global", 3000, 60),
  }),
  resend_webhook: route("ip", 100, 300, {
    "resend_webhook.global": additional("global", "pre_auth", "global", 3000, 60),
  }),
  auth_failure_guard_attendee: guardClass(),
  auth_failure_guard_operator: guardClass(),
} satisfies Record<string, ClassDefinition>);

export type RateLimitClassId = keyof typeof RATE_LIMIT_REGISTRY;
export const RATE_LIMIT_CLASS_IDS = Object.freeze(
  Object.keys(RATE_LIMIT_REGISTRY) as RateLimitClassId[],
);
export type RouteClassId = {
  [C in RateLimitClassId]: (typeof RATE_LIMIT_REGISTRY)[C]["kind"] extends "route" ? C : never;
}[RateLimitClassId];
export type GuardClassId = Exclude<RateLimitClassId, RouteClassId>;
export const ROUTE_CLASS_IDS = Object.freeze(
  RATE_LIMIT_CLASS_IDS.filter((id) => RATE_LIMIT_REGISTRY[id].kind === "route") as RouteClassId[],
);
export const GUARD_CLASS_IDS = Object.freeze(
  RATE_LIMIT_CLASS_IDS.filter((id) => RATE_LIMIT_REGISTRY[id].kind === "guard") as GuardClassId[],
);
export type AdditionalRuleId<C extends RateLimitClassId = RateLimitClassId> = C extends C
  ? Extract<keyof (typeof RATE_LIMIT_REGISTRY)[C]["additional"], string>
  : never;

export interface ClassView {
  readonly kind: "route" | "guard";
  readonly primary: "ip" | "auth_subject";
  readonly burst: number;
  readonly sustained: number;
  readonly additional: Readonly<Record<string, AdditionalRuleDefinition>>;
  readonly guard?: GuardId;
}
export function classDefinition(id: RateLimitClassId): ClassView {
  return RATE_LIMIT_REGISTRY[id];
}
export function additionalRuleIds(id: RateLimitClassId): string[] {
  return Object.keys(RATE_LIMIT_REGISTRY[id].additional);
}
/** The guard Class ID that applies to a route class, if any (SPEC-140 §68.1). */
export function guardFor(id: RouteClassId): GuardClassId | undefined {
  return (RATE_LIMIT_REGISTRY[id] as ClassView).guard;
}
