import { defineAuditChange } from "../audit-events.ts";

// The table of initial data targets (SPEC-100 section 13.5 DB-SEED-001..004, SPEC-180 INF-SEED-003).
// Table and column names are constants here; no identifier is ever built from the input. Goods and
// Karaoke rows are added to this table only after the upstream specifications list them.

/** One input column. `required` columns must be present and non-null; the others default to NULL. */
export type InputColumn =
  | { readonly name: string; readonly kind: "text"; readonly required: boolean }
  | { readonly name: string; readonly kind: "timestamp"; readonly required: boolean }
  | {
      readonly name: string;
      readonly kind: "integer";
      readonly required: boolean;
      readonly min: number;
      readonly max: number;
      readonly sqlType: "bigint" | "integer";
    }
  | { readonly name: string; readonly kind: "currency"; readonly required: boolean };

export type FixedColumn = { readonly name: string; readonly sql: string };

export type InitialDataTarget = {
  /** Top-level key of the input JSON. */
  readonly key: "event" | "entry_ticket_offerings";
  readonly cardinality: "one" | "many";
  /** `tableEmpty`: created when the table has no row. `noChildrenOf`: created when the parent has none. */
  readonly condition: "tableEmpty" | "noChildrenOf";
  readonly table: "app.events" | "app.entry_ticket_offerings";
  readonly auditTargetType: "PUBLIC_CONTENT" | "ENTRY_TICKET_OFFERING";
  readonly afterState: "SUSPENDED" | null;
  /** Input columns, in table column order. */
  readonly columns: readonly InputColumn[];
  /** [earlier, later] pairs that must satisfy earlier < later when both are present. */
  readonly periods: readonly (readonly [string, string])[];
  /** Columns the command always sets itself (DB-SEED-001 fixed values, DB-SEED-004). */
  readonly fixed: readonly FixedColumn[];
};

const text = (name: string, required = false): InputColumn => ({
  name,
  kind: "text",
  required,
});
const timestamp = (name: string, required = false): InputColumn => ({
  name,
  kind: "timestamp",
  required,
});

export const INITIAL_DATA_TARGETS: readonly InitialDataTarget[] = [
  {
    key: "event",
    cardinality: "one",
    condition: "tableEmpty",
    table: "app.events",
    auditTargetType: "PUBLIC_CONTENT",
    afterState: null,
    columns: [
      text("name", true),
      text("summary"),
      timestamp("starts_at"),
      timestamp("ends_at"),
      text("venue_name"),
      text("venue_details"),
      text("access_information"),
      text("participant_notices"),
    ],
    periods: [["starts_at", "ends_at"]],
    fixed: [{ name: "business_timezone", sql: "'Asia/Tokyo'" }],
  },
  {
    key: "entry_ticket_offerings",
    cardinality: "many",
    condition: "noChildrenOf",
    table: "app.entry_ticket_offerings",
    auditTargetType: "ENTRY_TICKET_OFFERING",
    afterState: "SUSPENDED",
    columns: [
      text("name", true),
      text("description"),
      {
        name: "unit_amount",
        kind: "integer",
        required: true,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        sqlType: "bigint",
      },
      { name: "currency", kind: "currency", required: true },
      timestamp("sales_starts_at", true),
      timestamp("sales_ends_at", true),
      {
        name: "sales_capacity",
        kind: "integer",
        required: true,
        min: 0,
        max: 2147483647,
        sqlType: "integer",
      },
      {
        name: "purchase_limit",
        kind: "integer",
        required: true,
        min: 1,
        max: 2147483647,
        sqlType: "integer",
      },
      timestamp("checkin_opens_at"),
      timestamp("checkin_closes_at"),
    ],
    periods: [
      ["sales_starts_at", "sales_ends_at"],
      ["checkin_opens_at", "checkin_closes_at"],
    ],
    fixed: [
      { name: "sale_control_state", sql: "'SUSPENDED'" },
      { name: "held_quantity", sql: "0" },
      { name: "committed_quantity", sql: "0" },
    ],
  },
];

/** The one Audit change spec for PROVISION.INITIAL_DATA_SEED (SPEC-160 section 35, OBS-AUD-014). */
export const INITIAL_DATA_AUDIT_CHANGE = defineAuditChange({
  operationIds: ["PROVISION.INITIAL_DATA_SEED"],
  states: ["SUSPENDED"],
  fields: INITIAL_DATA_TARGETS.flatMap((target) => [
    ...target.columns.map((column) => column.name),
    ...target.fixed.map((column) => column.name),
  ]).filter((name, index, all) => all.indexOf(name) === index),
  summary: {},
});
