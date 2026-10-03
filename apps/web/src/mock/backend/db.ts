import {
  ENTRY_TICKET_STATES,
  GOODS_HANDOFF_STATES,
  GOODS_ITEM_STATES,
  KARAOKE_SLOT_STATES,
  KARAOKE_TICKET_STATES,
  ORDER_PURPOSES,
  ORDER_STATES,
  PUBLICATION_STATES,
  RESERVATION_STATES,
} from "@off-r39x/domain";
import { z } from "zod";
import type { Clock } from "./clock";
import { buildSeed } from "./seed";

// The mock business database: one JSON value in the injected storage (design section 4).
// Every level of the schema is strict, so unknown keys, enum values and versions are rejected.

export const DB_STORAGE_KEY = "r39x.mock.db.v1";

export interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
const money = z.strictObject({ amount: z.string(), currency: z.string() });
const control = z.enum(["ENABLED", "SUSPENDED"]);
const publication = z.enum(PUBLICATION_STATES);
const quantity = z.number().int().min(1);

const orderItem = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ENTRY_TICKET"),
    offeringRef: z.string(),
    name: z.string(),
    quantity,
    unitPrice: money,
    subtotal: money,
  }),
  z.strictObject({
    kind: z.literal("GOODS"),
    goodsRef: z.string(),
    name: z.string(),
    quantity,
    unitPrice: money,
    subtotal: money,
  }),
  z.strictObject({
    kind: z.literal("KARAOKE"),
    slotRef: z.string(),
    name: z.string(),
    usageStart: instant,
    usageEnd: instant,
    quantity: z.literal(1),
    unitPrice: money,
    subtotal: money,
  }),
]);

const idempotency = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cart"),
    ownerEmail: z.string(),
    key: z.string(),
    orderRef: z.string(),
    includedLineKeys: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("karaoke"),
    ownerEmail: z.string(),
    key: z.string(),
    orderRef: z.string(),
  }),
  z.strictObject({
    kind: z.literal("checkout"),
    ownerEmail: z.string(),
    key: z.string(),
    orderRef: z.string(),
    url: z.string(),
  }),
]);

export const dbStateSchema = z.strictObject({
  version: z.literal(1),
  users: z.array(
    z.strictObject({ email: z.string(), displayName: z.string(), emailVerified: z.boolean() }),
  ),
  offerings: z.array(
    z.strictObject({
      ref: z.string(),
      name: z.string(),
      description: z.string(),
      unitPrice: money,
      startsAt: instant,
      endsAt: instant,
      control,
      remaining: z.number().int().min(0),
      perAccountLimit: z.number().int().min(1).nullable(),
      published: z.boolean(),
    }),
  ),
  goods: z.array(
    z.strictObject({
      ref: z.string(),
      name: z.string(),
      shortDescription: z.string(),
      description: z.string(),
      unitPrice: money,
      startsAt: instant,
      endsAt: instant,
      control,
      remaining: z.number().int().min(0),
      published: z.boolean(),
    }),
  ),
  karaoke: z.strictObject({
    price: money,
    startsAt: instant,
    endsAt: instant,
    salesDates: z.array(z.string()),
  }),
  slots: z.array(
    z.strictObject({
      ref: z.string(),
      usageStart: instant,
      usageEnd: instant,
      state: z.enum(KARAOKE_SLOT_STATES),
    }),
  ),
  announcements: z.array(
    z.strictObject({
      ref: z.string(),
      title: z.string(),
      excerpt: z.string(),
      body: z.string(),
      publishedAt: instant,
      publication,
    }),
  ),
  faqs: z.array(
    z.strictObject({
      id: z.string(),
      question: z.string(),
      answer: z.string(),
      publication,
    }),
  ),
  event: z.strictObject({
    name: z.string(),
    overview: z.string(),
    startsAt: instant,
    endsAt: instant,
    venueName: z.string(),
    venueGuide: z.string(),
    accessInfo: z.string(),
    notices: z.array(z.string()),
  }),
  sponsors: z.array(
    z.strictObject({
      ref: z.string(),
      name: z.string(),
      displayOrder: z.number().int(),
      publication,
      imageUrl: z.string(),
      linkUrl: z.string().nullable(),
    }),
  ),
  orders: z.array(
    z.strictObject({
      ref: z.string(),
      ownerEmail: z.string(),
      purpose: z.enum(ORDER_PURPOSES),
      state: z.enum(ORDER_STATES),
      createdAt: instant,
      items: z.array(orderItem),
      total: money,
      receiptUrl: z.string().nullable(),
      pendingWebhook: z.boolean(),
      webhookReads: z.number().int().min(0),
    }),
  ),
  tickets: z.array(
    z.strictObject({
      ref: z.string(),
      orderRef: z.string(),
      offeringName: z.string(),
      state: z.enum(ENTRY_TICKET_STATES),
      issuedAt: instant,
    }),
  ),
  reservations: z.array(
    z.strictObject({
      ref: z.string(),
      orderRef: z.string(),
      slotRef: z.string(),
      reservationState: z.enum(RESERVATION_STATES),
      ticketState: z.enum(KARAOKE_TICKET_STATES),
    }),
  ),
  goodsItems: z.array(
    z.strictObject({
      ref: z.string(),
      orderRef: z.string(),
      goodsRef: z.string(),
      goodsName: z.string(),
      quantity,
      itemState: z.enum(GOODS_ITEM_STATES),
      handoffState: z.enum(GOODS_HANDOFF_STATES),
    }),
  ),
  idempotency: z.array(idempotency),
});

export type DbState = z.infer<typeof dbStateSchema>;

export type DbLoad = { kind: "ready"; state: DbState } | { kind: "corrupted"; message: string };

export interface MockDb {
  /** Seeds and stores on the first call. A corrupted value is reported and never rewritten. */
  load(): DbLoad;
  /** Validates, then stores. An invalid state throws and leaves the storage untouched. */
  save(state: DbState): void;
  /** Explicit recovery: stores a seed relative to the current clock instant and returns it. */
  reset(): DbState;
}

// The message never echoes the stored value.
const CORRUPTED_MESSAGE = "The stored mock database is not valid. Reset it to recover.";

export function createMockDb(deps: { storage: MockStorage; clock: Clock }): MockDb {
  const { storage, clock } = deps;

  const write = (state: DbState): string => {
    const serialized = JSON.stringify(dbStateSchema.parse(state));
    storage.setItem(DB_STORAGE_KEY, serialized);
    return serialized;
  };

  return {
    load() {
      const stored = storage.getItem(DB_STORAGE_KEY);
      const raw = stored ?? write(buildSeed(clock.now()));
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return { kind: "corrupted", message: CORRUPTED_MESSAGE };
      }
      // Parsing builds a fresh object, so the caller can never alias the stored value.
      const parsed = dbStateSchema.safeParse(json);
      if (!parsed.success) {
        return { kind: "corrupted", message: CORRUPTED_MESSAGE };
      }
      return { kind: "ready", state: parsed.data };
    },
    save(state) {
      write(state);
    },
    reset() {
      const serialized = write(buildSeed(clock.now()));
      return dbStateSchema.parse(JSON.parse(serialized));
    },
  };
}
