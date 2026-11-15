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
  // `/auth/*` proxy routes have no Operation ID and are classified by path: the session routes
  // are auth_session, the email-link completion GETs are auth_callback, every other allowed route
  // is auth_form_proxy (SEC-ABU-027 / 028).
  auth_form_proxy: [],
  auth_session: [],
  auth_callback: [],
  self_read: [
    // SPEC-110 §56.1 / API-RLC-005: read-only, so it never consumes the goods_handoff counter.
    "API-STF-GDS-002",
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
  goods_handoff: ["API-STF-GDS-001"],
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
 * SPEC-110 API-RLC-006 / API-RLC-007: the classes with a Stage 3 resource rule (SPEC-140 §68
 * "Additional" column), and for every Operation of those classes the kind of reference its Stage 3
 * rule is keyed on. An empty list means the Operation has no reference (a create, a batch): its
 * Stage 3 resource rule is not evaluated and only the Stage 1 / Stage 2 rules apply.
 */
export const RESOURCE_CLASS_IDS = Object.freeze([
  "purchase_checkout",
  "qr_display",
  "staff_checkin",
  "goods_handoff",
  "admin_mutation",
  "role_assignment",
  "high_risk_recovery",
] as const satisfies readonly RouteClassId[]);
export type ResourceClassId = (typeof RESOURCE_CLASS_IDS)[number];
export type ResourceOperationId = (typeof BY_CLASS)[ResourceClassId][number];

export type ResourceReferenceKind =
  | "offering_ref"
  | "goods_ref"
  | "slot_ref"
  | "order_ref"
  | "ticket_ref"
  | "reservation_ref"
  | "qr_digest"
  | "goods_item_ref"
  | "event"
  | "faq_ref"
  | "announcement_ref"
  | "logo_ref"
  | "sales_configuration_ref"
  | "handoff_ref"
  | "target_profile_ref"
  | "notification_ref"
  | "checkout_attempt_ref"
  | "case_ref";

const NONE = [] as const;
const RESOURCE_REFERENCES = {
  // API-RLC-006. The cart names ENTRY offerings and GOODS goods in one atomic evaluation.
  "API-PUR-CART-001": ["offering_ref", "goods_ref"],
  "API-PUR-ENTRY-001": ["offering_ref"],
  "API-PUR-GDS-001": ["goods_ref"],
  "API-PUR-KRK-001": ["slot_ref"],
  "API-CHK-001": ["order_ref"],
  "API-ORD-002": ["order_ref"],
  // API-RLC-007. API-KRK-SELF-003 is keyed on the Reservation (its path has no ticket_ref).
  "API-TKT-003": ["ticket_ref"],
  "API-KRK-SELF-003": ["reservation_ref"],
  "API-STF-CHK-001": ["qr_digest"],
  "API-STF-CHK-002": ["qr_digest"],
  "API-STF-GDS-001": ["goods_item_ref"],
  "API-ADM-CNT-002": ["event"],
  "API-ADM-CNT-005": NONE,
  "API-ADM-CNT-011": NONE,
  "API-ADM-CNT-019": NONE,
  "API-ADM-CNT-006": ["faq_ref"],
  "API-ADM-CNT-007": ["faq_ref"],
  "API-ADM-CNT-008": ["faq_ref"],
  "API-ADM-CNT-015": ["faq_ref"],
  "API-ADM-CNT-012": ["announcement_ref"],
  "API-ADM-CNT-013": ["announcement_ref"],
  "API-ADM-CNT-014": ["announcement_ref"],
  "API-ADM-CNT-016": ["announcement_ref"],
  "API-ADM-CNT-020": ["logo_ref"],
  "API-ADM-CNT-021": ["logo_ref"],
  "API-ADM-KRK-003": NONE,
  "API-ADM-KRK-004": ["slot_ref"],
  "API-ADM-KRK-005": ["slot_ref"],
  "API-ADM-KRK-006": ["slot_ref"],
  "API-ADM-KRK-007": ["reservation_ref"],
  "API-ADM-ENT-SALES-003": ["offering_ref"],
  "API-ADM-KRK-SALES-003": ["sales_configuration_ref"],
  "API-ADM-GDS-004": ["goods_ref"],
  "API-ADM-GDS-005": ["goods_ref"],
  "API-ADM-HOF-003": ["handoff_ref"],
  // ROL-003 resolves the target profile from role_assignment_ref after Role + Capability.
  "API-ADM-ROL-002": ["target_profile_ref"],
  "API-ADM-ROL-003": ["target_profile_ref"],
  "API-ADM-PAY-001": ["order_ref"],
  "API-ADM-REC-004": ["order_ref"],
  "API-ADM-REC-005": ["order_ref"],
  "API-ADM-TQR-001": ["ticket_ref"],
  "API-ADM-EML-004": ["notification_ref"],
  "API-ADM-EML-005": ["notification_ref"],
  "API-ADM-REC-006": ["notification_ref"],
  "API-ADM-REC-003": ["checkout_attempt_ref"],
  "API-ADM-REC-007": ["case_ref"],
} as const satisfies Record<ResourceOperationId, readonly ResourceReferenceKind[]>;

/** The Stage 3 reference kinds of an Operation; undefined when its class has no resource rule. */
export function resourceReferencesOf(
  operationId: string | undefined,
): readonly ResourceReferenceKind[] | undefined {
  if (operationId === undefined) return undefined;
  return (RESOURCE_REFERENCES as Readonly<Record<string, readonly ResourceReferenceKind[]>>)[
    operationId
  ];
}
/** Operation ID -> Stage 3 reference kinds, for the SPEC-110 API-RLC-006 / API-RLC-007 tables. */
export const OPERATION_RESOURCE_REFERENCES: ReadonlyMap<string, readonly ResourceReferenceKind[]> =
  new Map(Object.entries(RESOURCE_REFERENCES));

/**
 * Startup/test check (API-RLC-007): every Operation of a class with a resource rule is in the
 * reference table, and the table holds no other Operation. A new Operation cannot reach a resource
 * class without declaring its reference (or declaring that it has none).
 */
export function assertResourceReferenceTable(): void {
  const expected = new Set<string>();
  for (const classId of RESOURCE_CLASS_IDS) for (const id of BY_CLASS[classId]) expected.add(id);
  for (const id of expected)
    if (!OPERATION_RESOURCE_REFERENCES.has(id))
      throw new Error("Operation of a resource class has no Stage 3 reference declaration");
  for (const id of OPERATION_RESOURCE_REFERENCES.keys())
    if (!expected.has(id)) throw new Error("Stage 3 reference declared for an unrelated Operation");
}

/**
 * DEV-RLM-005: a route is registered with its rate limit class. `operationId` must be a listed
 * Operation (otherwise a type error), and `rateLimitClass` is required and must be that
 * Operation's class. An Operation of a class with a resource rule must also declare its Stage 3
 * `resourceReferences` (an empty list when it has none; API-RLC-007). Routes without an Operation ID
 * (the `/auth/*` proxy) use `operationId: null` and may only use `auth_form_proxy`, `auth_session`
 * or `auth_callback`.
 */
export type RouteRegistration = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
} & (
  | {
      [C in Exclude<RouteClassId, ResourceClassId>]: {
        readonly operationId: (typeof BY_CLASS)[C][number];
        readonly rateLimitClass: C;
      };
    }[Exclude<RouteClassId, ResourceClassId>]
  | {
      [C in ResourceClassId]: {
        readonly operationId: (typeof BY_CLASS)[C][number];
        readonly rateLimitClass: C;
        readonly resourceReferences: readonly ResourceReferenceKind[];
      };
    }[ResourceClassId]
  | {
      readonly operationId: null;
      readonly rateLimitClass: "auth_form_proxy" | "auth_session" | "auth_callback";
    }
);

function sameKinds(declared: readonly string[] | undefined, table: readonly string[]): boolean {
  return (
    declared !== undefined &&
    declared.length === table.length &&
    new Set(declared).size === declared.length &&
    declared.every((kind) => table.includes(kind))
  );
}

/**
 * Startup/test check (API-RLC-001 / API-RLC-007): no duplicate Operation IDs, the declared class
 * equals §56.1, and the declared Stage 3 references equal the API-RLC-006 / API-RLC-007 table.
 */
export function assertRouteRegistry(routes: readonly RouteRegistration[]): void {
  assertResourceReferenceTable();
  const operations = new Set<string>();
  const endpoints = new Set<string>();
  for (const entry of routes) {
    const endpoint = `${entry.method} ${entry.path}`;
    if (endpoints.has(endpoint)) throw new Error("Duplicate route registration");
    endpoints.add(endpoint);
    if (entry.operationId === null) {
      if (
        entry.rateLimitClass !== "auth_form_proxy" &&
        entry.rateLimitClass !== "auth_session" &&
        entry.rateLimitClass !== "auth_callback"
      )
        throw new Error(
          "Route without Operation ID must use auth_form_proxy, auth_session or auth_callback",
        );
      continue;
    }
    if (operations.has(entry.operationId)) throw new Error("Operation ID registered twice");
    operations.add(entry.operationId);
    if (ASSIGNMENT.get(entry.operationId) !== entry.rateLimitClass)
      throw new Error("Route rate limit class differs from the SPEC-110 §56.1 assignment");
    const declared = "resourceReferences" in entry ? entry.resourceReferences : undefined;
    const table = resourceReferencesOf(entry.operationId);
    if (table === undefined ? declared !== undefined : !sameKinds(declared, table))
      throw new Error(
        "Route Stage 3 resource reference differs from the SPEC-110 API-RLC-007 table",
      );
  }
}

/**
 * SEC-ABU-029 / API-RLC-006: the purchase start Operations. Each runs a read-only eligibility
 * pre-check (the same decision as API-PUR-ELG-001) before its Stage 3 resource rule, and evaluates
 * Stage 3 only when every target is purchasable. API-CHK-001 / API-ORD-002 keep the order of the
 * owner relation instead.
 */
export const PURCHASE_START_OPERATIONS: readonly string[] = Object.freeze([
  "API-PUR-CART-001",
  "API-PUR-ENTRY-001",
  "API-PUR-GDS-001",
  "API-PUR-KRK-001",
]);
export function isPurchaseStartOperation(operationId: string | undefined): boolean {
  return operationId !== undefined && PURCHASE_START_OPERATIONS.includes(operationId);
}
