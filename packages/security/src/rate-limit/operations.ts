// SPEC-110 §56.1 Rate limit class assignment. Every canonical Operation ID belongs to exactly one
// class (API-RLC-001 / 002). The table is keyed by Operation ID so a second class is impossible.
import type { RouteClassId } from "./registry.ts";

const BY_CLASS = {
  public_read: [
    "API-PUB-001",
    "API-PUB-002",
    "API-PUB-003",
    "API-PUB-004",
    "API-PUB-005",
    "API-PUB-006",
    "API-PUB-007",
    "API-PUB-008",
    "API-PUB-009",
    "API-PUB-010",
    "API-PUB-011",
    "API-PUB-012",
  ],
  stripe_webhook: ["API-WHK-001"],
  resend_webhook: ["API-WHK-EML-001"],
  // `/auth/*` proxy routes have no Operation ID and are classified by path (auth_form_proxy).
  auth_form_proxy: [],
  self_read: [
    "API-AUTH-001",
    "API-AUTH-002",
    "API-PUR-ELG-001",
    "API-ORD-001",
    "API-ORD-003",
    "API-TKT-001",
    "API-TKT-002",
    "API-KRK-SELF-001",
    "API-KRK-SELF-002",
    "API-GDS-SELF-001",
    "API-GDS-SELF-002",
    // SPEC-110 §41 Administrator read catalog
    "API-ADM-ORD-001",
    "API-ADM-ORD-002",
    "API-ADM-TKT-001",
    "API-ADM-TKT-002",
    "API-ADM-KRK-001",
    "API-ADM-KRK-002",
    "API-ADM-KRK-008",
    "API-ADM-KRK-009",
    "API-ADM-KRK-010",
    "API-ADM-KRK-011",
    "API-ADM-ENT-SALES-001",
    "API-ADM-ENT-SALES-002",
    "API-ADM-KRK-SALES-001",
    "API-ADM-KRK-SALES-002",
    "API-ADM-GDS-001",
    "API-ADM-GDS-002",
    "API-ADM-GDS-003",
    "API-ADM-HOF-001",
    "API-ADM-HOF-002",
    "API-ADM-CNT-001",
    "API-ADM-CNT-003",
    "API-ADM-CNT-004",
    "API-ADM-CNT-009",
    "API-ADM-CNT-010",
    "API-ADM-CNT-017",
    "API-ADM-CNT-018",
    "API-ADM-ROL-001",
    "API-ADM-REC-001",
    "API-ADM-REC-002",
    // SPEC-120
    "API-ADM-EML-001",
    "API-ADM-EML-002",
    "API-ADM-EML-003",
  ],
  purchase_checkout: [
    "API-PUR-CART-001",
    "API-PUR-ENTRY-001",
    "API-PUR-KRK-001",
    "API-PUR-GDS-001",
    "API-CHK-001",
    "API-ORD-002",
  ],
  qr_display: ["API-TKT-003", "API-KRK-SELF-003"],
  profile_mutation: ["API-AUTH-003", "API-AUTH-004"],
  staff_checkin: ["API-STF-CHK-001", "API-STF-CHK-002"],
  goods_handoff: ["API-STF-GDS-001", "API-STF-GDS-002"],
  admin_mutation: [
    "API-ADM-CNT-002",
    "API-ADM-CNT-005",
    "API-ADM-CNT-006",
    "API-ADM-CNT-007",
    "API-ADM-CNT-008",
    "API-ADM-CNT-011",
    "API-ADM-CNT-012",
    "API-ADM-CNT-013",
    "API-ADM-CNT-014",
    "API-ADM-CNT-015",
    "API-ADM-CNT-016",
    "API-ADM-CNT-019",
    "API-ADM-CNT-020",
    "API-ADM-CNT-021",
    "API-ADM-KRK-003",
    "API-ADM-KRK-004",
    "API-ADM-KRK-005",
    "API-ADM-KRK-006",
    "API-ADM-KRK-007",
    "API-ADM-ENT-SALES-003",
    "API-ADM-KRK-SALES-003",
    "API-ADM-GDS-004",
    "API-ADM-GDS-005",
    "API-ADM-HOF-003",
  ],
  role_assignment: ["API-ADM-ROL-002", "API-ADM-ROL-003"],
  high_risk_recovery: [
    "API-ADM-PAY-001",
    "API-ADM-TQR-001",
    "API-ADM-EML-004",
    "API-ADM-EML-005",
    "API-ADM-REC-003",
    "API-ADM-REC-004",
    "API-ADM-REC-005",
    "API-ADM-REC-006",
    "API-ADM-REC-007",
  ],
} as const satisfies Record<RouteClassId, readonly string[]>;

export type OperationId = (typeof BY_CLASS)[RouteClassId][number];

function build(): ReadonlyMap<string, RouteClassId> {
  const map = new Map<string, RouteClassId>();
  for (const [classId, ids] of Object.entries(BY_CLASS) as [RouteClassId, readonly string[]][])
    for (const id of ids) {
      if (map.has(id)) throw new Error("Operation ID assigned to more than one rate limit class");
      map.set(id, classId);
    }
  return map;
}
const ASSIGNMENT = build();

/** Operation ID -> class, for the SPEC-110 §56.1 table. */
export const OPERATION_CLASS_ASSIGNMENT: ReadonlyMap<string, RouteClassId> = ASSIGNMENT;
export function rateLimitClassOf(operationId: string): RouteClassId | undefined {
  return ASSIGNMENT.get(operationId);
}

/**
 * DEV-RLM-005: a route is registered with its rate limit class. `operationId` must be a listed
 * Operation (otherwise a type error), and `rateLimitClass` is required and must be that
 * Operation's class. Routes without an Operation ID (the `/auth/*` proxy) use `operationId: null`
 * and may only use `auth_form_proxy`.
 */
export type RouteRegistration = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
} & (
  | {
      [C in RouteClassId]: {
        readonly operationId: (typeof BY_CLASS)[C][number];
        readonly rateLimitClass: C;
      };
    }[RouteClassId]
  | { readonly operationId: null; readonly rateLimitClass: "auth_form_proxy" }
);

/** Startup/test check (API-RLC-001): no duplicate Operation IDs, and the declared class equals §56.1. */
export function assertRouteRegistry(routes: readonly RouteRegistration[]): void {
  const operations = new Set<string>();
  const endpoints = new Set<string>();
  for (const entry of routes) {
    const endpoint = `${entry.method} ${entry.path}`;
    if (endpoints.has(endpoint)) throw new Error("Duplicate route registration");
    endpoints.add(endpoint);
    if (entry.operationId === null) {
      if (entry.rateLimitClass !== "auth_form_proxy")
        throw new Error("Route without Operation ID must use auth_form_proxy");
      continue;
    }
    if (operations.has(entry.operationId)) throw new Error("Operation ID registered twice");
    operations.add(entry.operationId);
    if (ASSIGNMENT.get(entry.operationId) !== entry.rateLimitClass)
      throw new Error("Route rate limit class differs from the SPEC-110 §56.1 assignment");
  }
}
