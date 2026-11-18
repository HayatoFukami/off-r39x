import {
  NOTIFICATION_CAUSE_NAMESPACE,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_TYPES,
  type NotificationType,
  notificationBusinessCauseKey,
  notificationBusinessCauseName,
  notificationEnqueueInputSchema,
  renderContextSchemas,
} from "@off-r39x/application/notification";
import { describe, expect, it } from "vitest";
import { uuidV5 } from "../../../packages/application/src/uuid-v5.ts";

// PR-S0-5 C1: port contract tests for the Notification Request enqueue input (SPEC-120 §8.2,
// §9-§14, §16, §17). They prove the shape of the input types and the pure key derivation only.
// They do NOT prove persistence, UNIQUE convergence, recipient resolution, rendering or delivery
// (TST-UNT-001): those need the real PostgreSQL / Worker tests of later PRs.
//
// All values are synthetic. Email-looking strings use the reserved example.com domain and appear
// only as inputs that must be rejected (TST-EML-001).

// SPEC-120 §8.2 fixes the namespace as an application constant. This literal was generated once
// (random UUID) for PR-S0-5 and must never change: changing it would disconnect Business Cause
// keys of notifications that already exist.
const EXPECTED_CAUSE_NAMESPACE = "af5a24eb-3aaf-46ed-9da5-4bce2fe5cf9f";

const ORDER_REF = "00000000-0000-4000-8000-000000000001";
const RESERVATION_REF = "00000000-0000-4000-8000-000000000002";
const OTHER_REF = "00000000-0000-4000-8000-000000000003";
// Contains hex letters, so the uppercase form differs from the lowercase form.
const UPPER_REF = "0000000A-0000-4000-8000-00000000000B";
const MONEY = { amount: "3500", currency: "JPY" };
const AT = "2027-01-02T03:04:05.006Z";
const USAGE_START = "2027-01-03T10:00:00.000Z";
const USAGE_END = "2027-01-03T11:00:00.000Z";
const EVENT_NAME = "Synthetic Event";

type Context = Record<string, unknown>;

// SPEC-120 §10-§14 and §17.1 (event_name). app_base_url is intentionally absent (§17.1).
const CONTEXTS: Record<NotificationType, Context> = {
  ENTRY_PURCHASE_CONFIRMED: {
    event_name: EVENT_NAME,
    order_ref: ORDER_REF,
    confirmed_at: AT,
    total: MONEY,
    entry_items: [{ offering_name: "Synthetic Entry Ticket", quantity: 2 }],
  },
  KARAOKE_RESERVATION_CONFIRMED: {
    event_name: EVENT_NAME,
    order_ref: ORDER_REF,
    reservation_ref: RESERVATION_REF,
    confirmed_at: AT,
    usage_start: USAGE_START,
    usage_end: USAGE_END,
    total: MONEY,
    slot_display_name: null,
  },
  GOODS_PURCHASE_CONFIRMED: {
    event_name: EVENT_NAME,
    order_ref: ORDER_REF,
    confirmed_at: AT,
    total: MONEY,
    goods_items: [{ goods_name: "Synthetic Goods", quantity: 1 }],
    handoff_instructions: null,
  },
  ENTRY_GOODS_PURCHASE_CONFIRMED: {
    event_name: EVENT_NAME,
    order_ref: ORDER_REF,
    confirmed_at: AT,
    total: MONEY,
    entry_items: [{ offering_name: "Synthetic Entry Ticket", quantity: 1 }],
    goods_items: [{ goods_name: "Synthetic Goods", quantity: 3 }],
    handoff_instructions: null,
  },
  KARAOKE_RESERVATION_CANCELED: {
    event_name: EVENT_NAME,
    reservation_ref: RESERVATION_REF,
    canceled_at: AT,
    usage_start: USAGE_START,
    usage_end: USAGE_END,
    cancellation_reason_label: null,
  },
  ORDER_REFUND_SUCCEEDED: {
    event_name: EVENT_NAME,
    order_ref: ORDER_REF,
    refunded_at: AT,
    refunded_total: MONEY,
  },
};

// The Source reference that SPEC-120 §8.2 / §10-§14 put into the Business Cause name.
const SOURCE_REF_FIELD: Record<NotificationType, "order_ref" | "reservation_ref"> = {
  ENTRY_PURCHASE_CONFIRMED: "order_ref",
  KARAOKE_RESERVATION_CONFIRMED: "reservation_ref",
  GOODS_PURCHASE_CONFIRMED: "order_ref",
  ENTRY_GOODS_PURCHASE_CONFIRMED: "order_ref",
  KARAOKE_RESERVATION_CANCELED: "reservation_ref",
  ORDER_REFUND_SUCCEEDED: "order_ref",
};

// SPEC-120 §8.2 examples (event_discriminator is fixed per type).
const EXPECTED_DISCRIMINATOR: Record<NotificationType, string> = {
  ENTRY_PURCHASE_CONFIRMED: "CONFIRMED",
  KARAOKE_RESERVATION_CONFIRMED: "CONFIRMED",
  GOODS_PURCHASE_CONFIRMED: "CONFIRMED",
  ENTRY_GOODS_PURCHASE_CONFIRMED: "CONFIRMED",
  KARAOKE_RESERVATION_CANCELED: "CANCELED",
  ORDER_REFUND_SUCCEEDED: "FULL_REFUND_SUCCEEDED",
};

// SPEC-120 §10-§14 "Source" lines and SPEC-100 §42 CHECK.
type SourceRule = {
  readonly order: "required" | "optional";
  readonly reservation: "required" | "forbidden" | "optional";
};
const SOURCE_RULES: Record<NotificationType, SourceRule> = {
  ENTRY_PURCHASE_CONFIRMED: { order: "required", reservation: "forbidden" },
  KARAOKE_RESERVATION_CONFIRMED: { order: "required", reservation: "required" },
  GOODS_PURCHASE_CONFIRMED: { order: "required", reservation: "forbidden" },
  ENTRY_GOODS_PURCHASE_CONFIRMED: { order: "required", reservation: "forbidden" },
  KARAOKE_RESERVATION_CANCELED: { order: "optional", reservation: "required" },
  ORDER_REFUND_SUCCEEDED: { order: "required", reservation: "optional" },
};

function defaultReservationId(type: NotificationType): bigint | null {
  return SOURCE_RULES[type].reservation === "required" ? 30n : null;
}

function enqueueInput(type: NotificationType, overrides: Record<string, unknown> = {}) {
  return {
    notificationType: type,
    recipientProfileId: 10n,
    sourceOrderId: 20n,
    sourceReservationId: defaultReservationId(type),
    renderContext: { ...CONTEXTS[type] },
    ...overrides,
  };
}

function validEnqueueInput(type: NotificationType) {
  return notificationEnqueueInputSchema.parse(enqueueInput(type));
}

function contextWith(type: NotificationType, patch: Context): Context {
  return { ...CONTEXTS[type], ...patch };
}

function contextWithout(type: NotificationType, key: string): Context {
  return Object.fromEntries(Object.entries(CONTEXTS[type]).filter(([name]) => name !== key));
}

const ENTRY = "ENTRY_PURCHASE_CONFIRMED" as const;
const KARAOKE_CONFIRMED = "KARAOKE_RESERVATION_CONFIRMED" as const;
const GOODS = "GOODS_PURCHASE_CONFIRMED" as const;
const ENTRY_GOODS = "ENTRY_GOODS_PURCHASE_CONFIRMED" as const;
const KARAOKE_CANCELED = "KARAOKE_RESERVATION_CANCELED" as const;
const REFUND = "ORDER_REFUND_SUCCEEDED" as const;

function parsesContext(type: NotificationType, context: unknown): boolean {
  return renderContextSchemas[type].safeParse(context).success;
}

describe("TC-NTF-PORT-001 notification types and template map are exhaustive [EML-TPL-001]", () => {
  // SPEC-120 §9.
  const canonicalTypes = [
    "ENTRY_PURCHASE_CONFIRMED",
    "KARAOKE_RESERVATION_CONFIRMED",
    "GOODS_PURCHASE_CONFIRMED",
    "ENTRY_GOODS_PURCHASE_CONFIRMED",
    "KARAOKE_RESERVATION_CANCELED",
    "ORDER_REFUND_SUCCEEDED",
  ];
  // SPEC-120 §16 "<template id>@<version>".
  const canonicalTemplates: Record<string, string> = {
    ENTRY_PURCHASE_CONFIRMED: "entry-purchase-confirmation@1",
    KARAOKE_RESERVATION_CONFIRMED: "karaoke-reservation-confirmation@1",
    GOODS_PURCHASE_CONFIRMED: "goods-purchase-confirmation@1",
    ENTRY_GOODS_PURCHASE_CONFIRMED: "entry-goods-purchase-confirmation@1",
    KARAOKE_RESERVATION_CANCELED: "karaoke-reservation-cancellation@1",
    ORDER_REFUND_SUCCEEDED: "order-refund-succeeded@1",
  };

  it("NOTIFICATION_TYPES equals the six SPEC-120 §9 types without duplicates", () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
    expect([...NOTIFICATION_TYPES].sort()).toEqual([...canonicalTypes].sort());
  });

  it("NOTIFICATION_TEMPLATES has exactly one entry per type matching SPEC-120 §16", () => {
    expect(Object.keys(NOTIFICATION_TEMPLATES).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const type of NOTIFICATION_TYPES) {
      const template = NOTIFICATION_TEMPLATES[type];
      expect(`${template.templateId}@${template.templateVersion}`).toBe(canonicalTemplates[type]);
    }
    const ids = NOTIFICATION_TYPES.map((type) => NOTIFICATION_TEMPLATES[type].templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renderContextSchemas has exactly one schema per type", () => {
    expect(Object.keys(renderContextSchemas).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  for (const unknownType of ["ENTRY_PURCHASE_CONFIRMED_V2", "entry_purchase_confirmed", ""]) {
    it(`rejects the unknown type ${JSON.stringify(unknownType)} instead of defaulting to a template`, () => {
      const input = { ...enqueueInput(ENTRY), notificationType: unknownType };
      expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
    });
  }

  it("rejects a missing notificationType", () => {
    const { notificationType: _omitted, ...rest } = enqueueInput(ENTRY);
    expect(notificationEnqueueInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a render context that belongs to another type (EML-TPL-001 discriminated union)", () => {
    const input = enqueueInput(ENTRY, { renderContext: { ...CONTEXTS[GOODS] } });
    expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts a well-formed enqueue input of every type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationEnqueueInputSchema.safeParse(enqueueInput(type)).success).toBe(true);
    }
  });
});

describe("TC-NTF-PORT-002 render_context schemas accept only the SPEC-120 items [EML-TPL-002]", () => {
  for (const type of NOTIFICATION_TYPES) {
    describe(type, () => {
      it("accepts the minimal valid context", () => {
        expect(parsesContext(type, CONTEXTS[type])).toBe(true);
      });

      for (const key of Object.keys(CONTEXTS[type])) {
        it(`rejects a context without ${key}`, () => {
          expect(parsesContext(type, contextWithout(type, key))).toBe(false);
        });
      }

      it("rejects an extra top-level item", () => {
        expect(parsesContext(type, contextWith(type, { ticket_id: "synthetic" }))).toBe(false);
      });

      it("rejects app_base_url (SPEC-120 §17.1: not stored in render_context)", () => {
        expect(
          parsesContext(type, contextWith(type, { app_base_url: "https://example.com" })),
        ).toBe(false);
      });

      it("rejects an empty event_name", () => {
        expect(parsesContext(type, contextWith(type, { event_name: "" }))).toBe(false);
      });

      const moneyKey = type === REFUND ? "refunded_total" : "total";
      if (moneyKey in CONTEXTS[type]) {
        it(`rejects an extra item inside ${moneyKey}`, () => {
          const withExtra = contextWith(type, { [moneyKey]: { ...MONEY, tax: "0" } });
          expect(parsesContext(type, withExtra)).toBe(false);
        });
      }
    });
  }

  it("accepts nullable items set to a non-empty string", () => {
    expect(
      parsesContext(
        KARAOKE_CONFIRMED,
        contextWith(KARAOKE_CONFIRMED, { slot_display_name: "Room" }),
      ),
    ).toBe(true);
    expect(
      parsesContext(GOODS, contextWith(GOODS, { handoff_instructions: "Synthetic counter" })),
    ).toBe(true);
    expect(
      parsesContext(
        ENTRY_GOODS,
        contextWith(ENTRY_GOODS, { handoff_instructions: "Synthetic counter" }),
      ),
    ).toBe(true);
  });

  it("rejects an empty string for nullable text items (no filler values, EML-TPL-002)", () => {
    expect(
      parsesContext(KARAOKE_CONFIRMED, contextWith(KARAOKE_CONFIRMED, { slot_display_name: "" })),
    ).toBe(false);
    expect(parsesContext(GOODS, contextWith(GOODS, { handoff_instructions: "" }))).toBe(false);
    expect(parsesContext(ENTRY_GOODS, contextWith(ENTRY_GOODS, { handoff_instructions: "" }))).toBe(
      false,
    );
  });

  it("rejects extra items and empty names inside item array elements", () => {
    const entryItem = { offering_name: "Synthetic Entry Ticket", quantity: 1 };
    const goodsItem = { goods_name: "Synthetic Goods", quantity: 1 };
    for (const type of [ENTRY, ENTRY_GOODS]) {
      expect(
        parsesContext(type, contextWith(type, { entry_items: [{ ...entryItem, ticket_id: "x" }] })),
      ).toBe(false);
      expect(
        parsesContext(
          type,
          contextWith(type, { entry_items: [{ ...entryItem, offering_name: "" }] }),
        ),
      ).toBe(false);
      expect(
        parsesContext(type, contextWith(type, { entry_items: [{ offering_name: "A" }] })),
      ).toBe(false);
    }
    for (const type of [GOODS, ENTRY_GOODS]) {
      expect(
        parsesContext(type, contextWith(type, { goods_items: [{ ...goodsItem, sku_id: "x" }] })),
      ).toBe(false);
      expect(
        parsesContext(type, contextWith(type, { goods_items: [{ ...goodsItem, goods_name: "" }] })),
      ).toBe(false);
      expect(parsesContext(type, contextWith(type, { goods_items: [{ goods_name: "G" }] }))).toBe(
        false,
      );
    }
  });

  it("rejects an empty detail array for single-purpose and combined purchases", () => {
    expect(parsesContext(ENTRY, contextWith(ENTRY, { entry_items: [] }))).toBe(false);
    expect(parsesContext(GOODS, contextWith(GOODS, { goods_items: [] }))).toBe(false);
    expect(parsesContext(ENTRY_GOODS, contextWith(ENTRY_GOODS, { entry_items: [] }))).toBe(false);
    expect(parsesContext(ENTRY_GOODS, contextWith(ENTRY_GOODS, { goods_items: [] }))).toBe(false);
  });

  it("requires both item arrays for the combined purchase (SPEC-120 §12.1, TST-EML-002)", () => {
    expect(parsesContext(ENTRY_GOODS, contextWithout(ENTRY_GOODS, "entry_items"))).toBe(false);
    expect(parsesContext(ENTRY_GOODS, contextWithout(ENTRY_GOODS, "goods_items"))).toBe(false);
    // The single-purpose contexts do not accept the other side's items.
    expect(
      parsesContext(ENTRY, contextWith(ENTRY, { goods_items: CONTEXTS[GOODS].goods_items })),
    ).toBe(false);
    expect(
      parsesContext(GOODS, contextWith(GOODS, { entry_items: CONTEXTS[ENTRY].entry_items })),
    ).toBe(false);
  });

  it("accepts only null for cancellation_reason_label until an allowlist exists (D-5)", () => {
    expect(parsesContext(KARAOKE_CANCELED, CONTEXTS[KARAOKE_CANCELED])).toBe(true);
    for (const label of ["Synthetic reason", ""]) {
      const context = contextWith(KARAOKE_CANCELED, { cancellation_reason_label: label });
      expect(parsesContext(KARAOKE_CANCELED, context)).toBe(false);
    }
  });

  it("rejects a render context embedded in an enqueue input when an item is missing", () => {
    for (const type of NOTIFICATION_TYPES) {
      const input = enqueueInput(type, { renderContext: contextWithout(type, "event_name") });
      expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("TC-NTF-PORT-003 wire value boundaries [EML-TPL-002]", () => {
  const totalOf = (total: unknown) => parsesContext(ENTRY, contextWith(ENTRY, { total }));
  const confirmedAtOf = (value: unknown) =>
    parsesContext(ENTRY, contextWith(ENTRY, { confirmed_at: value }));
  const orderRefOf = (value: unknown) =>
    parsesContext(ENTRY, contextWith(ENTRY, { order_ref: value }));
  const quantityOf = (value: unknown) =>
    parsesContext(
      ENTRY,
      contextWith(ENTRY, {
        entry_items: [{ offering_name: "Synthetic Entry Ticket", quantity: value }],
      }),
    );

  describe("Money (decimal string minor unit + ISO currency, SPEC-120 §17.3, SPEC-100 §9)", () => {
    for (const amount of ["0", "3500", "9223372036854775807"]) {
      it(`accepts amount ${JSON.stringify(amount)}`, () => {
        expect(totalOf({ amount, currency: "JPY" })).toBe(true);
      });
    }
    for (const amount of [
      3500,
      3500n,
      "35.00",
      "-1",
      "01",
      "",
      " 1",
      "1e3",
      "9223372036854775808",
      null,
    ]) {
      it(`rejects amount ${String(amount)} (${typeof amount})`, () => {
        expect(totalOf({ amount, currency: "JPY" })).toBe(false);
      });
    }
    for (const currency of ["jpy", "JP", "JPYY", "", 392, null]) {
      it(`rejects currency ${String(currency)}`, () => {
        expect(totalOf({ amount: "3500", currency })).toBe(false);
      });
    }
    it("rejects an extra key and a missing key", () => {
      expect(totalOf({ ...MONEY, minor_unit: 0 })).toBe(false);
      expect(totalOf({ amount: "3500" })).toBe(false);
      expect(totalOf({ currency: "JPY" })).toBe(false);
    });
    it("rejects a bare number or string instead of an object", () => {
      expect(totalOf(3500)).toBe(false);
      expect(totalOf("3500")).toBe(false);
    });
  });

  describe("isoUtc (SPEC-110 §10: YYYY-MM-DDTHH:mm:ss.sssZ)", () => {
    it("accepts the canonical form", () => {
      expect(confirmedAtOf("2027-01-02T03:04:05.006Z")).toBe(true);
      expect(confirmedAtOf("2028-02-29T23:59:59.999Z")).toBe(true);
    });
    for (const value of [
      "2027-01-02T03:04:05.006+09:00",
      "2027-01-02T03:04:05Z",
      "2027-01-02T03:04:05.006",
      "2027-01-02",
      "2027-02-30T00:00:00.000Z",
      "2027-13-01T00:00:00.000Z",
      "2027-01-02T24:00:00.000Z",
      "",
      1798859045006,
    ]) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(confirmedAtOf(value)).toBe(false);
      });
    }
  });

  describe("public reference (SPEC-110 §9: lowercase canonical UUID)", () => {
    it("accepts lowercase UUIDs of RFC 9562 versions", () => {
      expect(orderRefOf(ORDER_REF)).toBe(true);
      expect(orderRefOf("2ed6657d-e927-568b-95e1-2665a8aea6a2")).toBe(true);
    });
    for (const value of [
      "00000000-0000-4000-8000-0000000000AB",
      "00000000-0000-4000-8000-0000000000aB",
      `{${ORDER_REF}}`,
      ORDER_REF.replaceAll("-", ""),
      "00000000-0000-0000-8000-000000000001",
      "00000000-0000-4000-c000-000000000001",
      "123",
      123,
      "",
    ]) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(orderRefOf(value)).toBe(false);
      });
    }
  });

  describe("quantity (positive 32-bit integer)", () => {
    for (const value of [1, 2147483647]) {
      it(`accepts ${value}`, () => {
        expect(quantityOf(value)).toBe(true);
      });
    }
    for (const value of [0, -1, 1.5, 2147483648, "1", null, 1n]) {
      it(`rejects ${String(value)} (${typeof value})`, () => {
        expect(quantityOf(value)).toBe(false);
      });
    }
  });
});

// Collect every property name reachable through objects, arrays and nullable wrappers.
function collectKeys(schema: unknown, into: Set<string>): void {
  const node = schema as {
    shape?: Record<string, unknown>;
    element?: unknown;
    unwrap?: () => unknown;
  };
  if (node.shape !== undefined) {
    for (const [key, child] of Object.entries(node.shape)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  if (node.element !== undefined) collectKeys(node.element, into);
  if (typeof node.unwrap === "function") collectKeys(node.unwrap(), into);
}

describe("TC-NTF-PORT-004 render_context has no slot for forbidden information [EML-AUTH-001, EML-RCP-001]", () => {
  const forbiddenPatches: Context[] = [
    { recipient_email: "user@example.com" },
    { email: "user@example.com" },
    { qr_payload: `r39x1.ent.${"A".repeat(43)}` },
    { password_reset_token: "synthetic-token" },
    { stripe_checkout_session_id: "synthetic-session" },
    { order_id: 123 },
  ];

  for (const type of NOTIFICATION_TYPES) {
    for (const patch of forbiddenPatches) {
      const [key] = Object.keys(patch);
      it(`${type} rejects an extra ${key} item`, () => {
        expect(parsesContext(type, contextWith(type, patch))).toBe(false);
      });
    }
  }

  it("rejects order_ref given as an internal numeric id or numeric string", () => {
    for (const value of ["123", 123, 123n]) {
      expect(parsesContext(ENTRY, contextWith(ENTRY, { order_ref: value }))).toBe(false);
      expect(parsesContext(REFUND, contextWith(REFUND, { order_ref: value }))).toBe(false);
    }
    for (const value of ["123", 123, 123n]) {
      expect(
        parsesContext(KARAOKE_CANCELED, contextWith(KARAOKE_CANCELED, { reservation_ref: value })),
      ).toBe(false);
    }
  });

  it("no schema declares a key that holds an email, token, QR payload or internal id", () => {
    for (const type of NOTIFICATION_TYPES) {
      const keys = new Set<string>();
      collectKeys(renderContextSchemas[type], keys);
      // Guard against an enumeration that silently found nothing.
      expect(keys.size).toBeGreaterThan(4);
      for (const key of keys) {
        expect(key, `${type}.${key}`).not.toMatch(/email|token|qr|_id$|^id$|secret|password/i);
      }
    }
  });

  it("every enqueue input rejects a wire-level email in the recipient position", () => {
    for (const type of NOTIFICATION_TYPES) {
      const input = enqueueInput(type, { recipientProfileId: "user@example.com" });
      expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("TC-NTF-PORT-005 enqueue input source conditions and absent items [EML-GEN-003, EML-RCP-001]", () => {
  const orderChoices: ReadonlyArray<bigint | null> = [20n, null];
  const reservationChoices: ReadonlyArray<bigint | null> = [30n, null];

  for (const type of NOTIFICATION_TYPES) {
    const rule = SOURCE_RULES[type];
    for (const sourceOrderId of orderChoices) {
      for (const sourceReservationId of reservationChoices) {
        const orderOk = sourceOrderId !== null || rule.order === "optional";
        const reservationOk =
          sourceReservationId === null
            ? rule.reservation !== "required"
            : rule.reservation !== "forbidden";
        const expected = orderOk && reservationOk;
        it(`${type} order=${sourceOrderId} reservation=${sourceReservationId} -> ${expected ? "accept" : "reject"}`, () => {
          const input = enqueueInput(type, { sourceOrderId, sourceReservationId });
          expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(expected);
        });
      }
    }

    it(`${type} never accepts both sources null (SPEC-100 §42 CHECK)`, () => {
      const input = enqueueInput(type, { sourceOrderId: null, sourceReservationId: null });
      expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
    });
  }

  // Concrete rows of the SPEC-120 §10-§14 "Source" lines.
  it("matches the SPEC-120 Source lines for the notable combinations", () => {
    const ok = (type: NotificationType, order: bigint | null, reservation: bigint | null) =>
      notificationEnqueueInputSchema.safeParse(
        enqueueInput(type, { sourceOrderId: order, sourceReservationId: reservation }),
      ).success;
    expect(ok(ENTRY, 20n, null)).toBe(true);
    expect(ok(ENTRY, 20n, 30n)).toBe(false);
    expect(ok(KARAOKE_CONFIRMED, 20n, 30n)).toBe(true);
    expect(ok(KARAOKE_CONFIRMED, 20n, null)).toBe(false);
    expect(ok(KARAOKE_CONFIRMED, null, 30n)).toBe(false);
    expect(ok(GOODS, 20n, 30n)).toBe(false);
    expect(ok(ENTRY_GOODS, 20n, 30n)).toBe(false);
    expect(ok(KARAOKE_CANCELED, null, 30n)).toBe(true);
    expect(ok(KARAOKE_CANCELED, 20n, 30n)).toBe(true);
    expect(ok(KARAOKE_CANCELED, 20n, null)).toBe(false);
    expect(ok(REFUND, 20n, null)).toBe(true);
    expect(ok(REFUND, 20n, 30n)).toBe(true);
    expect(ok(REFUND, null, 30n)).toBe(false);
  });

  describe("internal ids are positive bigint only", () => {
    const badIds: unknown[] = [10, 0n, -1n, "10", 1.5, null, undefined];
    for (const field of ["recipientProfileId", "sourceOrderId"]) {
      for (const bad of badIds) {
        it(`${field} rejects ${String(bad)} (${typeof bad})`, () => {
          const input = enqueueInput(KARAOKE_CONFIRMED, { [field]: bad });
          expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
        });
      }
    }
    for (const bad of [30, 0n, -1n, "30", 1.5, undefined]) {
      it(`sourceReservationId rejects ${String(bad)} (${typeof bad})`, () => {
        const input = enqueueInput(KARAOKE_CONFIRMED, { sourceReservationId: bad });
        expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
      });
    }
    it("rejects a missing recipientProfileId key", () => {
      const { recipientProfileId: _omitted, ...rest } = enqueueInput(ENTRY);
      expect(notificationEnqueueInputSchema.safeParse(rest).success).toBe(false);
    });
  });

  // The input has no slot for these (EML-GEN-003, EML-RCP-001, SPEC-120 §15, §7).
  const absentItems: Array<[string, unknown]> = [
    ["recipientEmail", "user@example.com"],
    ["recipient_email", "user@example.com"],
    ["email", "user@example.com"],
    ["businessCauseKey", "00000000-0000-5000-8000-000000000001"],
    ["business_cause_key", "00000000-0000-5000-8000-000000000001"],
    ["idempotencyKey", "synthetic-idempotency-key"],
    ["requestId", "synthetic-request-id"],
    ["workerId", "synthetic-worker"],
    ["state", "PENDING"],
    ["templateVersion", 1],
  ];
  for (const type of NOTIFICATION_TYPES) {
    for (const [key, value] of absentItems) {
      it(`${type} rejects the top-level item ${key}`, () => {
        const input = enqueueInput(type, { [key]: value });
        expect(notificationEnqueueInputSchema.safeParse(input).success).toBe(false);
      });
    }
  }
});

describe("TC-NTF-PORT-006 UUIDv5 and the fixed cause namespace [EML-GEN-003]", () => {
  // RFC 9562 Appendix A.4 (Figure 22/23), transcribed from the RFC text.
  const RFC_DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  it("matches the RFC 9562 Appendix A.4 test vector", () => {
    expect(uuidV5(RFC_DNS_NAMESPACE, "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("matches the Python documentation vector uuid5(NAMESPACE_DNS, 'python.org')", () => {
    // Not from the RFC: Python standard library documentation (uuid module).
    expect(uuidV5(RFC_DNS_NAMESPACE, "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("is deterministic and returns lowercase version-5 / RFC variant form", () => {
    const first = uuidV5(EXPECTED_CAUSE_NAMESPACE, "ENTRY_PURCHASE_CONFIRMED:x:CONFIRMED");
    const second = uuidV5(EXPECTED_CAUSE_NAMESPACE, "ENTRY_PURCHASE_CONFIRMED:x:CONFIRMED");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV5(EXPECTED_CAUSE_NAMESPACE, "other")).not.toBe(first);
    expect(uuidV5(RFC_DNS_NAMESPACE, "x")).not.toBe(uuidV5(EXPECTED_CAUSE_NAMESPACE, "x"));
  });

  it("rejects a namespace that is not a lowercase UUID without echoing the value", () => {
    for (const namespace of ["not-a-uuid", RFC_DNS_NAMESPACE.toUpperCase(), ""]) {
      expect(() => uuidV5(namespace, "www.example.com")).toThrow();
      if (namespace === "") continue;
      try {
        uuidV5(namespace, "www.example.com");
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).not.toContain(namespace);
      }
    }
  });

  it("NOTIFICATION_CAUSE_NAMESPACE equals the literal fixed in PR-S0-5 (changing it is forbidden)", () => {
    expect(NOTIFICATION_CAUSE_NAMESPACE).toBe(EXPECTED_CAUSE_NAMESPACE);
    expect(NOTIFICATION_CAUSE_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("NOTIFICATION_CAUSE_NAMESPACE is not one of the RFC 9562 predefined namespaces", () => {
    // RFC 9562 §6.6 Table 3: DNS, URL, OID, X500.
    const predefined = [
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
      "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
      "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
    ];
    expect(predefined).not.toContain(NOTIFICATION_CAUSE_NAMESPACE);
  });
});

describe("TC-NTF-PORT-007 business_cause_key derivation [EML-GEN-003, EML-IDM-003, BR-NTF-005]", () => {
  function expectedName(type: NotificationType, ref: string): string {
    return `${type}:${ref}:${EXPECTED_DISCRIMINATOR[type]}`;
  }

  // SPEC-120 §8.2 examples, written out literally.
  it("builds the Canonical name input of SPEC-120 §8.2 for every type", () => {
    expect(notificationBusinessCauseName(ENTRY, ORDER_REF)).toBe(
      `ENTRY_PURCHASE_CONFIRMED:${ORDER_REF}:CONFIRMED`,
    );
    expect(notificationBusinessCauseName(KARAOKE_CONFIRMED, RESERVATION_REF)).toBe(
      `KARAOKE_RESERVATION_CONFIRMED:${RESERVATION_REF}:CONFIRMED`,
    );
    expect(notificationBusinessCauseName(GOODS, ORDER_REF)).toBe(
      `GOODS_PURCHASE_CONFIRMED:${ORDER_REF}:CONFIRMED`,
    );
    expect(notificationBusinessCauseName(ENTRY_GOODS, ORDER_REF)).toBe(
      `ENTRY_GOODS_PURCHASE_CONFIRMED:${ORDER_REF}:CONFIRMED`,
    );
    expect(notificationBusinessCauseName(KARAOKE_CANCELED, RESERVATION_REF)).toBe(
      `KARAOKE_RESERVATION_CANCELED:${RESERVATION_REF}:CANCELED`,
    );
    expect(notificationBusinessCauseName(REFUND, ORDER_REF)).toBe(
      `ORDER_REFUND_SUCCEEDED:${ORDER_REF}:FULL_REFUND_SUCCEEDED`,
    );
  });

  for (const type of NOTIFICATION_TYPES) {
    it(`${type} key = UUIDv5(namespace, name) from the ${SOURCE_REF_FIELD[type]} item`, () => {
      const input = validEnqueueInput(type);
      const ref = String(CONTEXTS[type][SOURCE_REF_FIELD[type]]);
      expect(notificationBusinessCauseKey(input)).toBe(
        uuidV5(EXPECTED_CAUSE_NAMESPACE, expectedName(type, ref)),
      );
    });
  }

  it("uses reservation_ref, not order_ref, for the Karaoke types", () => {
    expect(ORDER_REF).not.toBe(RESERVATION_REF);
    for (const type of [KARAOKE_CONFIRMED, KARAOKE_CANCELED]) {
      expect(notificationBusinessCauseKey(validEnqueueInput(type))).toBe(
        uuidV5(
          EXPECTED_CAUSE_NAMESPACE,
          `${type}:${RESERVATION_REF}:${EXPECTED_DISCRIMINATOR[type]}`,
        ),
      );
      expect(notificationBusinessCauseKey(validEnqueueInput(type))).not.toBe(
        uuidV5(EXPECTED_CAUSE_NAMESPACE, `${type}:${ORDER_REF}:${EXPECTED_DISCRIMINATOR[type]}`),
      );
    }
  });

  it("returns the same value for the same input", () => {
    for (const type of NOTIFICATION_TYPES) {
      const input = validEnqueueInput(type);
      expect(notificationBusinessCauseKey(input)).toBe(notificationBusinessCauseKey(input));
      expect(notificationBusinessCauseKey(validEnqueueInput(type))).toBe(
        notificationBusinessCauseKey(input),
      );
    }
  });

  it("ignores everything except the type and the source public reference", () => {
    const base = notificationBusinessCauseKey(validEnqueueInput(ENTRY));
    const changed = notificationEnqueueInputSchema.parse(
      enqueueInput(ENTRY, {
        recipientProfileId: 99n,
        sourceOrderId: 98n,
        renderContext: {
          ...CONTEXTS[ENTRY],
          event_name: "Another Synthetic Event",
          total: { amount: "1", currency: "JPY" },
          confirmed_at: "2030-01-01T00:00:00.000Z",
          entry_items: [{ offering_name: "Another Ticket", quantity: 9 }],
        },
      }),
    );
    expect(notificationBusinessCauseKey(changed)).toBe(base);
  });

  it("yields a different value when only the source reference changes", () => {
    for (const type of NOTIFICATION_TYPES) {
      const field = SOURCE_REF_FIELD[type];
      const other = notificationEnqueueInputSchema.parse(
        enqueueInput(type, { renderContext: contextWith(type, { [field]: OTHER_REF }) }),
      );
      expect(notificationBusinessCauseKey(other)).not.toBe(
        notificationBusinessCauseKey(validEnqueueInput(type)),
      );
    }
  });

  it("yields different values for different types over the same source reference", () => {
    const keys = [ENTRY, GOODS, ENTRY_GOODS, REFUND].map((type) =>
      notificationBusinessCauseKey(validEnqueueInput(type)),
    );
    expect(new Set(keys).size).toBe(keys.length);
    const reservationKeys = [KARAOKE_CONFIRMED, KARAOKE_CANCELED].map((type) =>
      notificationBusinessCauseKey(validEnqueueInput(type)),
    );
    expect(new Set(reservationKeys).size).toBe(2);
  });

  it("yields pairwise distinct keys for the six types", () => {
    const keys = NOTIFICATION_TYPES.map((type) =>
      notificationBusinessCauseKey(validEnqueueInput(type)),
    );
    expect(new Set(keys).size).toBe(NOTIFICATION_TYPES.length);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("does not accept Idempotency-Key, Request ID or worker ID as inputs (EML-GEN-003)", () => {
    // The derivation takes the enqueue input only (one parameter), and the input has no slot for
    // them (also asserted in TC-NTF-PORT-005).
    expect(notificationBusinessCauseKey.length).toBe(1);
    expect(notificationBusinessCauseName.length).toBe(2);
    expect(
      notificationEnqueueInputSchema.safeParse(
        enqueueInput(ENTRY, { idempotencyKey: "synthetic-idempotency-key" }),
      ).success,
    ).toBe(false);
  });

  it("throws instead of returning a key for an input that bypassed the schema via a cast", () => {
    const valid = enqueueInput(ENTRY);
    const bypassed: unknown[] = [
      { ...valid, notificationType: "ENTRY_PURCHASE_CONFIRMED_V2" },
      { ...valid, renderContext: contextWith(ENTRY, { order_ref: "123" }) },
      { ...valid, renderContext: contextWith(ENTRY, { order_ref: UPPER_REF }) },
      { ...valid, renderContext: contextWithout(ENTRY, "order_ref") },
      { ...valid, idempotencyKey: "synthetic-idempotency-key" },
      { ...valid, sourceOrderId: null, sourceReservationId: null },
      {},
    ];
    for (const input of bypassed) {
      expect(() => notificationBusinessCauseKey(input as never)).toThrow();
    }
  });

  it("notificationBusinessCauseName rejects an unknown type or a non-UUID reference", () => {
    expect(() =>
      notificationBusinessCauseName("ENTRY_PURCHASE_CONFIRMED_V2" as never, ORDER_REF),
    ).toThrow();
    expect(() => notificationBusinessCauseName(ENTRY, "123")).toThrow();
    expect(() => notificationBusinessCauseName(ENTRY, UPPER_REF)).toThrow();
    expect(() => notificationBusinessCauseName(ENTRY, `${ORDER_REF}:CONFIRMED`)).toThrow();
    expect(() => notificationBusinessCauseName(ENTRY, "")).toThrow();
  });
});
