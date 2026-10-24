import { assertNever, type OrderState } from "@off-r39x/domain";
import { cartLineKey } from "../../api-client/cart-line-key";
import type { ApiPort } from "../../api-client/port";
import type {
  CartLine,
  CartLineResolution,
  CartPurchaseStart,
  CartRejectionReasonCode,
  EntryTicketDetail,
  EntryTicketSummary,
  EventInfo,
  GoodsItemDetail,
  GoodsItemSummary,
  OrderDetail,
  OrderItem,
  OrderSummary,
  QrPresentation,
  Read,
  ReservationDetail,
  ReservationSummary,
  SaleAvailability,
  UtcInstant,
} from "../../api-client/types";
import { toBusinessDateJst } from "../../presentation/format/datetime";
import { multiplyMoney, sumMoney } from "../../presentation/format/money";
import { asBusinessDate, asRef, asUtc } from "./brand";
import type { Clock } from "./clock";
import { createMockDb, type DbState, type MockStorage } from "./db";
import type { IdGenerator } from "./ids";
import { buildKaraokeBuckets, filterSlotsByBusinessDate } from "./karaoke-buckets";
import { applyLatency, type Sleep } from "./latency";
import { decidePurpose, type OrderLineKind } from "./purpose";
import { loadScenario, type Scenario } from "./scenario";
import { loadSessionState } from "./session-store";

export type MockApiDeps = {
  storage: MockStorage;
  clock: Clock;
  sleep: Sleep;
  idGenerator: IdGenerator;
};

type UserRow = DbState["users"][number];
type OrderRow = DbState["orders"][number];
type OrderItemRow = OrderRow["items"][number];
type SlotRow = DbState["slots"][number];

type Ctx = { scenario: Scenario; state: DbState; nowIso: UtcInstant; nowMs: number };
type SelfCtx = Ctx & { user: UserRow; save(): void };

type Denied = "unavailable" | "auth_required" | "email_unverified";
type Viewer = { kind: "unavailable" } | { kind: "guest" } | { kind: "user"; user: UserRow };
type Access = { ok: true; user: UserRow } | { ok: false; reason: Denied };

const UNAVAILABLE = { kind: "unavailable" } as const;
const NOT_FOUND = { kind: "not_found" } as const;

// Orders in these states count toward the per-account purchase limit (section 8.6).
const LIMIT_COUNTED_STATES: readonly OrderState[] = [
  "PREPARED",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "REVIEW_REQUIRED",
];

const BROKEN_SPONSOR_IMAGE = "/mock/sponsors/__broken__.svg";

type Sellable = {
  control: "ENABLED" | "SUSPENDED";
  startsAt: string;
  endsAt: string;
  remaining: number;
};

/** Section 9: the availability of one sellable item for a quantity and the viewer's used quantity. */
function evaluate(
  item: Sellable,
  perAccountLimit: number | null,
  quantity: number,
  used: number,
  nowMs: number,
): SaleAvailability {
  if (item.control === "SUSPENDED") return { kind: "SUSPENDED" };
  if (nowMs < Date.parse(item.startsAt)) {
    return { kind: "BEFORE_SALES", startsAt: asUtc(item.startsAt) };
  }
  if (nowMs >= Date.parse(item.endsAt)) return { kind: "SALES_ENDED" };
  if (item.remaining === 0) return { kind: "SOLD_OUT" };
  if (perAccountLimit !== null && used >= perAccountLimit) {
    return { kind: "PURCHASE_LIMIT_EXCEEDED" };
  }
  if (quantity > item.remaining) {
    return { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: item.remaining };
  }
  if (perAccountLimit !== null && quantity > perAccountLimit - used) {
    return { kind: "PURCHASE_LIMIT_EXCEEDED" };
  }
  const max =
    perAccountLimit === null ? item.remaining : Math.min(item.remaining, perAccountLimit - used);
  return { kind: "ON_SALE", maxSelectableQuantity: max };
}

function usedQuantity(state: DbState, email: string | null, offeringRef: string): number {
  if (email === null) return 0;
  let total = 0;
  for (const order of state.orders) {
    if (order.ownerEmail !== email || !LIMIT_COUNTED_STATES.includes(order.state)) continue;
    for (const item of order.items) {
      if (item.kind === "ENTRY_TICKET" && item.offeringRef === offeringRef) {
        total += item.quantity;
      }
    }
  }
  return total;
}

function toOrderItem(item: OrderItemRow): OrderItem {
  switch (item.kind) {
    case "ENTRY_TICKET":
      return { ...item, offeringRef: asRef<"offering">(item.offeringRef) };
    case "GOODS":
      return { ...item, goodsRef: asRef<"goods">(item.goodsRef) };
    case "KARAOKE":
      return {
        ...item,
        slotRef: asRef<"slot">(item.slotRef),
        usageStart: asUtc(item.usageStart),
        usageEnd: asUtc(item.usageEnd),
      };
    default:
      return assertNever(item);
  }
}

function orderSummary(order: OrderRow): OrderSummary {
  return {
    orderRef: asRef<"order">(order.ref),
    purpose: order.purpose,
    state: order.state,
    createdAt: asUtc(order.createdAt),
    total: order.total,
    summary: order.items.map((i) => `${i.name} ×${i.quantity}`).join("、"),
  };
}

function orderDetail(state: DbState, order: OrderRow, scenario: Scenario): OrderDetail {
  const confirmed = order.state === "CONFIRMED";
  const reservation = state.reservations.find((r) => r.orderRef === order.ref);
  return {
    ...orderSummary(order),
    items: order.items.map(toOrderItem),
    // Entitlements exist only on a CONFIRMED Order, for every kind at once (BR-ORD-015).
    entitlements: confirmed
      ? {
          entryTicketRefs: state.tickets
            .filter((t) => t.orderRef === order.ref)
            .map((t) => asRef<"ticket">(t.ref)),
          reservationRef: reservation === undefined ? null : asRef<"reservation">(reservation.ref),
          goodsItems: state.goodsItems
            .filter((g) => g.orderRef === order.ref)
            .map((g) => ({
              ref: asRef<"goodsItem">(g.ref),
              itemState: g.itemState,
              handoffState: g.handoffState,
            })),
        }
      : { entryTicketRefs: [], reservationRef: null, goodsItems: [] },
    receiptUrl: order.receiptUrl,
    notice:
      confirmed && scenario.notification === "failed_retryable" ? { kind: "email_delayed" } : null,
  };
}

/** Deterministic, token-free value derived from a ref. Carries no QR material (SEC-QR-012/013). */
function mockMatrixSeed(ref: string): string {
  let hash = 2166136261;
  for (let i = 0; i < ref.length; i += 1) {
    hash = Math.imul(hash ^ ref.charCodeAt(i), 16777619) >>> 0;
  }
  return `mock-seed-${hash % 100000000}`;
}

function releaseAllocation(state: DbState, order: OrderRow): void {
  for (const item of order.items) {
    switch (item.kind) {
      case "ENTRY_TICKET": {
        const offering = state.offerings.find((o) => o.ref === item.offeringRef);
        if (offering !== undefined) offering.remaining += item.quantity;
        break;
      }
      case "GOODS": {
        const goods = state.goods.find((g) => g.ref === item.goodsRef);
        if (goods !== undefined) goods.remaining += item.quantity;
        break;
      }
      case "KARAOKE": {
        const slot = state.slots.find((s) => s.ref === item.slotRef);
        if (slot !== undefined && slot.state === "HELD") slot.state = "AVAILABLE";
        break;
      }
      default:
        assertNever(item);
    }
  }
  for (const goodsItem of state.goodsItems) {
    if (goodsItem.orderRef === order.ref) {
      goodsItem.itemState = "CANCELED";
      goodsItem.handoffState = "VOID";
    }
  }
}

function confirmOrder(
  state: DbState,
  order: OrderRow,
  nowIso: UtcInstant,
  idGenerator: IdGenerator,
): void {
  order.receiptUrl = `https://receipt.example.com/mock/${order.ref}`;
  for (const item of order.items) {
    switch (item.kind) {
      case "ENTRY_TICKET":
        for (let n = 0; n < item.quantity; n += 1) {
          state.tickets.push({
            ref: idGenerator(),
            orderRef: order.ref,
            offeringName: item.name,
            state: "VALID",
            issuedAt: nowIso,
          });
        }
        break;
      case "GOODS":
        break;
      case "KARAOKE": {
        const slot = state.slots.find((s) => s.ref === item.slotRef);
        if (slot !== undefined) slot.state = "SOLD";
        state.reservations.push({
          ref: idGenerator(),
          orderRef: order.ref,
          slotRef: item.slotRef,
          reservationState: "CONFIRMED",
          ticketState: "VALID",
        });
        break;
      }
      default:
        assertNever(item);
    }
  }
  for (const goodsItem of state.goodsItems) {
    if (goodsItem.orderRef === order.ref) {
      goodsItem.itemState = "FULFILLABLE";
      goodsItem.handoffState = "PENDING";
    }
  }
}

function transitionOrder(
  state: DbState,
  order: OrderRow,
  next: OrderState,
  nowIso: UtcInstant,
  idGenerator: IdGenerator,
): void {
  order.state = next;
  switch (next) {
    case "CONFIRMED":
      confirmOrder(state, order, nowIso, idGenerator);
      break;
    case "PAYMENT_FAILED":
    case "CANCELED":
    case "EXPIRED":
      releaseAllocation(state, order);
      break;
    case "PREPARED":
    case "AWAITING_PAYMENT":
    case "REVIEW_REQUIRED":
      break;
    default:
      assertNever(next);
  }
}

/** Section 11.4: the order state a simulated webhook yields on this read, or null for no change. */
function webhookResult(outcome: Scenario["paymentOutcome"], reads: number): OrderState | null {
  switch (outcome) {
    case "confirm_after_recheck":
      return reads >= 2 ? "CONFIRMED" : null;
    case "confirm":
      return "CONFIRMED";
    case "remain_awaiting":
      return null;
    case "payment_failed":
      return "PAYMENT_FAILED";
    case "review_required":
      return "REVIEW_REQUIRED";
    case "expire":
      return "EXPIRED";
    case "cancel":
      return "CANCELED";
    default:
      return assertNever(outcome);
  }
}

function isValidQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1;
}

export function createMockApi(deps: MockApiDeps): ApiPort {
  const { storage, clock, sleep, idGenerator } = deps;
  const db = createMockDb({ storage, clock });

  /** Scenario, latency (once), then the DB. Null means the mock cannot answer (fail closed). */
  async function open(): Promise<Ctx | null> {
    const loaded = loadScenario(storage);
    if (loaded.kind === "corrupted") return null;
    await applyLatency(sleep, loaded.scenario);
    const state = db.load();
    if (state.kind === "corrupted") return null;
    const nowIso = clock.now();
    return { scenario: loaded.scenario, state: state.state, nowIso, nowMs: Date.parse(nowIso) };
  }

  function viewerOf(state: DbState): Viewer {
    const loaded = loadSessionState(storage);
    if (loaded.kind === "corrupted") return { kind: "unavailable" };
    const { session } = loaded.state;
    if (session.kind === "guest") return { kind: "guest" };
    const user = state.users.find((u) => u.email === session.email);
    return user === undefined ? { kind: "guest" } : { kind: "user", user };
  }

  function access(viewer: Viewer): Access {
    switch (viewer.kind) {
      case "unavailable":
        return { ok: false, reason: "unavailable" };
      case "guest":
        return { ok: false, reason: "auth_required" };
      case "user":
        return viewer.user.emailVerified
          ? { ok: true, user: viewer.user }
          : { ok: false, reason: "email_unverified" };
      default:
        return assertNever(viewer);
    }
  }

  async function publicRead<T>(fn: (ctx: Ctx) => Read<T>): Promise<Read<T>> {
    const ctx = await open();
    if (ctx === null || ctx.scenario.publicFetch === "fail") return UNAVAILABLE;
    return fn(ctx);
  }

  async function selfRead<T>(fn: (ctx: SelfCtx) => Read<T>): Promise<Read<T>> {
    const ctx = await open();
    if (ctx === null) return UNAVAILABLE;
    const gate = access(viewerOf(ctx.state));
    if (!gate.ok) return { kind: gate.reason };
    return fn({ ...ctx, user: gate.user, save: () => db.save(ctx.state) });
  }

  function viewerEmail(viewer: Viewer): string | null {
    return viewer.kind === "user" ? viewer.user.email : null;
  }

  function slotView(state: DbState, ref: string): SlotRow | undefined {
    return state.slots.find((s) => s.ref === ref);
  }

  function ownedOrder(ctx: SelfCtx, ref: string): OrderRow | undefined {
    return ctx.state.orders.find((o) => o.ref === ref && o.ownerEmail === ctx.user.email);
  }

  function reservationSummary(ctx: SelfCtx, ref: string): ReservationSummary | null {
    const reservation = ctx.state.reservations.find((r) => r.ref === ref);
    if (reservation === undefined || ownedOrder(ctx, reservation.orderRef) === undefined) {
      return null;
    }
    const slot = slotView(ctx.state, reservation.slotRef);
    if (slot === undefined) return null;
    return {
      reservationRef: asRef<"reservation">(reservation.ref),
      orderRef: asRef<"order">(reservation.orderRef),
      date: toBusinessDateJst(asUtc(slot.usageStart)),
      usageStart: asUtc(slot.usageStart),
      usageEnd: asUtc(slot.usageEnd),
      reservationState: reservation.reservationState,
      ticketState: reservation.ticketState,
    };
  }

  function goodsItemSummary(ctx: SelfCtx, ref: string): GoodsItemSummary | null {
    const item = ctx.state.goodsItems.find((g) => g.ref === ref);
    if (item === undefined) return null;
    const order = ownedOrder(ctx, item.orderRef);
    if (order === undefined) return null;
    return {
      goodsItemRef: asRef<"goodsItem">(item.ref),
      goodsName: item.goodsName,
      quantity: item.quantity,
      itemState: item.itemState,
      handoffState: item.handoffState,
      orderRef: asRef<"order">(order.ref),
      orderState: order.state,
    };
  }

  function ticketSummary(ctx: SelfCtx, ref: string): EntryTicketDetail | null {
    const ticket = ctx.state.tickets.find((t) => t.ref === ref);
    if (ticket === undefined || ownedOrder(ctx, ticket.orderRef) === undefined) return null;
    return {
      ticketRef: asRef<"ticket">(ticket.ref),
      offeringName: ticket.offeringName,
      state: ticket.state,
      orderRef: asRef<"order">(ticket.orderRef),
      issuedAt: asUtc(ticket.issuedAt),
    };
  }

  const publicApi: ApiPort["public"] = {
    getEvent: () =>
      publicRead<EventInfo>((ctx) => {
        const { event } = ctx.state;
        if (ctx.scenario.eventFields === "missing_optional") {
          return {
            kind: "ok",
            data: {
              name: event.name,
              overview: null,
              startsAt: null,
              endsAt: null,
              venueName: null,
              venueGuide: null,
              accessInfo: null,
              notices: null,
            },
          };
        }
        return {
          kind: "ok",
          data: {
            name: event.name,
            overview: event.overview,
            startsAt: asUtc(event.startsAt),
            endsAt: asUtc(event.endsAt),
            venueName: event.venueName,
            venueGuide: event.venueGuide,
            accessInfo: event.accessInfo,
            notices: event.notices,
          },
        };
      }),

    listFaqs: () =>
      publicRead((ctx) => ({
        kind: "ok",
        data:
          ctx.scenario.publicFetch === "empty"
            ? []
            : ctx.state.faqs
                .filter((f) => f.publication === "PUBLISHED")
                .map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
      })),

    listAnnouncements: (q) =>
      publicRead((ctx) => {
        if (ctx.scenario.publicFetch === "empty") return { kind: "ok", data: [] };
        const sorted = ctx.state.announcements
          .filter((a) => a.publication === "PUBLISHED")
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
        const limited = q?.limit === undefined ? sorted : sorted.slice(0, q.limit);
        return {
          kind: "ok",
          data: limited.map((a) => ({
            announcementRef: asRef<"announcement">(a.ref),
            title: a.title,
            publishedAt: asUtc(a.publishedAt),
            excerpt: a.excerpt,
          })),
        };
      }),

    getAnnouncement: (ref) =>
      publicRead((ctx) => {
        const found = ctx.state.announcements.find(
          (a) => a.ref === ref && a.publication === "PUBLISHED",
        );
        if (found === undefined) return NOT_FOUND;
        return {
          kind: "ok",
          data: {
            announcementRef: asRef<"announcement">(found.ref),
            title: found.title,
            publishedAt: asUtc(found.publishedAt),
            excerpt: found.excerpt,
            body: found.body,
          },
        };
      }),

    // The footer must keep working when other public reads fail, so publicFetch does not apply.
    listSponsorLogos: async () => {
      const ctx = await open();
      if (ctx === null) return UNAVAILABLE;
      const mode = ctx.scenario.sponsorLogos;
      if (mode === "fail") return UNAVAILABLE;
      if (mode === "none") return { kind: "ok", data: [] };
      const data = ctx.state.sponsors
        .filter((s) => s.publication === "PUBLISHED")
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((s) => ({
          sponsorRef: asRef<"sponsor">(s.ref),
          name: s.name,
          imageUrl: mode === "image_broken" ? BROKEN_SPONSOR_IMAGE : s.imageUrl,
          linkUrl: s.linkUrl,
        }));
      return { kind: "ok", data };
    },

    listEntryOfferings: async () => {
      const ctx = await open();
      if (ctx === null || ctx.scenario.publicFetch === "fail") return UNAVAILABLE;
      const viewer = viewerOf(ctx.state);
      if (viewer.kind === "unavailable") return UNAVAILABLE;
      if (ctx.scenario.publicFetch === "empty") return { kind: "ok", data: [] };
      const email = viewerEmail(viewer);
      return {
        kind: "ok",
        data: ctx.state.offerings
          .filter((o) => o.published)
          .map((o) => ({
            offeringRef: asRef<"offering">(o.ref),
            name: o.name,
            description: o.description,
            unitPrice: o.unitPrice,
            salesPeriod: { startsAt: asUtc(o.startsAt), endsAt: asUtc(o.endsAt) },
            availability: evaluate(
              o,
              o.perAccountLimit,
              1,
              usedQuantity(ctx.state, email, o.ref),
              ctx.nowMs,
            ),
            perAccountLimit: o.perAccountLimit,
          })),
      };
    },

    getKaraokeSales: () =>
      publicRead((ctx) => {
        const { karaoke } = ctx.state;
        return {
          kind: "ok",
          data: {
            price: karaoke.price,
            salesPeriod: { startsAt: asUtc(karaoke.startsAt), endsAt: asUtc(karaoke.endsAt) },
            saleStatus: ctx.scenario.karaokeSales,
            salesDates:
              ctx.scenario.publicFetch === "empty" ? [] : karaoke.salesDates.map(asBusinessDate),
          },
        };
      }),

    getKaraokeDay: (date) =>
      publicRead((ctx) => {
        const dates = ctx.state.karaoke.salesDates;
        const index = dates.indexOf(date);
        if (index < 0) return NOT_FOUND;
        const slots = ctx.state.slots.map((s) => ({
          slotRef: asRef<"slot">(s.ref),
          usageStart: asUtc(s.usageStart),
          usageEnd: asUtc(s.usageEnd),
          state: s.state,
        }));
        const saleStatus = ctx.scenario.karaokeSales;
        const previous = dates[index - 1];
        const next = dates[index + 1];
        return {
          kind: "ok",
          data: {
            date,
            saleStatus,
            buckets:
              ctx.scenario.publicFetch === "empty"
                ? []
                : buildKaraokeBuckets(filterSlotsByBusinessDate(slots, date), { saleStatus }),
            previousDate: previous === undefined ? null : asBusinessDate(previous),
            nextDate: next === undefined ? null : asBusinessDate(next),
          },
        };
      }),

    getKaraokeSlot: (ref) =>
      publicRead((ctx) => {
        const slot = slotView(ctx.state, ref);
        if (slot === undefined) return NOT_FOUND;
        const saleStatus = ctx.scenario.karaokeSales;
        return {
          kind: "ok",
          data: {
            slotRef: asRef<"slot">(slot.ref),
            date: toBusinessDateJst(asUtc(slot.usageStart)),
            usageStart: asUtc(slot.usageStart),
            usageEnd: asUtc(slot.usageEnd),
            price: ctx.state.karaoke.price,
            state: slot.state,
            saleStatus,
            purchasable: slot.state === "AVAILABLE" && saleStatus === "ON_SALE",
          },
        };
      }),

    listGoods: () =>
      publicRead((ctx) => ({
        kind: "ok",
        data:
          ctx.scenario.publicFetch === "empty"
            ? []
            : ctx.state.goods
                .filter((g) => g.published)
                .map((g) => ({
                  goodsRef: asRef<"goods">(g.ref),
                  name: g.name,
                  shortDescription: g.shortDescription,
                  unitPrice: g.unitPrice,
                  availability: evaluate(g, null, 1, 0, ctx.nowMs),
                })),
      })),

    getGoods: (ref) =>
      publicRead((ctx) => {
        const goods = ctx.state.goods.find((g) => g.ref === ref && g.published);
        if (goods === undefined) return NOT_FOUND;
        return {
          kind: "ok",
          data: {
            goodsRef: asRef<"goods">(goods.ref),
            name: goods.name,
            description: goods.description,
            unitPrice: goods.unitPrice,
            salesPeriod: { startsAt: asUtc(goods.startsAt), endsAt: asUtc(goods.endsAt) },
            availability: evaluate(goods, null, 1, 0, ctx.nowMs),
            venuePickupOnly: true,
          },
        };
      }),

    resolveCartLines: async (lines) => {
      const ctx = await open();
      if (ctx === null || ctx.scenario.publicFetch === "fail") return UNAVAILABLE;
      if (ctx.scenario.cart.state === "fail") return UNAVAILABLE;
      const viewer = viewerOf(ctx.state);
      if (viewer.kind === "unavailable") return UNAVAILABLE;
      const email = viewerEmail(viewer);
      const data: CartLineResolution[] = lines.map((line, index) => {
        const lineKey = cartLineKey(line);
        if (ctx.scenario.cart.state === "partial" && index === 0) {
          return { lineKey, status: "unavailable" };
        }
        switch (line.kind) {
          case "ENTRY_TICKET": {
            const offering = ctx.state.offerings.find(
              (o) => o.ref === line.offeringRef && o.published,
            );
            if (offering === undefined) return { lineKey, status: "not_public" };
            return {
              lineKey,
              status: "resolved",
              name: offering.name,
              unitPrice: offering.unitPrice,
              availability: evaluate(
                offering,
                offering.perAccountLimit,
                line.quantity,
                usedQuantity(ctx.state, email, offering.ref),
                ctx.nowMs,
              ),
            };
          }
          case "GOODS": {
            const goods = ctx.state.goods.find((g) => g.ref === line.goodsRef && g.published);
            if (goods === undefined) return { lineKey, status: "not_public" };
            return {
              lineKey,
              status: "resolved",
              name: goods.name,
              unitPrice: goods.unitPrice,
              availability: evaluate(goods, null, line.quantity, 0, ctx.nowMs),
            };
          }
          default:
            return assertNever(line);
        }
      });
      return { kind: "ok", data };
    },
  };

  /**
   * Natural rejection reason of one cart line, or null when the line can be purchased.
   * `taken` is the quantity already allocated to earlier accepted lines with the same key.
   */
  function rejectionOf(
    ctx: Ctx,
    line: CartLine,
    email: string,
    taken: number,
  ): CartRejectionReasonCode | null {
    let availability: SaleAvailability;
    switch (line.kind) {
      case "ENTRY_TICKET": {
        const offering = ctx.state.offerings.find((o) => o.ref === line.offeringRef && o.published);
        if (offering === undefined) return "NOT_PUBLIC";
        availability = evaluate(
          { ...offering, remaining: offering.remaining - taken },
          offering.perAccountLimit,
          line.quantity,
          usedQuantity(ctx.state, email, offering.ref) + taken,
          ctx.nowMs,
        );
        break;
      }
      case "GOODS": {
        const goods = ctx.state.goods.find((g) => g.ref === line.goodsRef && g.published);
        if (goods === undefined) return "NOT_PUBLIC";
        availability = evaluate(
          { ...goods, remaining: goods.remaining - taken },
          null,
          line.quantity,
          0,
          ctx.nowMs,
        );
        break;
      }
      default:
        return assertNever(line);
    }
    return availability.kind === "ON_SALE" ? null : availability.kind;
  }

  const purchaseApi: ApiPort["purchase"] = {
    startCartPurchase: async (lines, o): Promise<CartPurchaseStart> => {
      const ctx = await open();
      if (ctx === null) return UNAVAILABLE;
      const gate = access(viewerOf(ctx.state));
      if (!gate.ok) return { kind: gate.reason };
      if (ctx.scenario.cart.purchaseStart === "unavailable") return UNAVAILABLE;
      if (lines.length === 0 || lines.some((l) => !isValidQuantity(l.quantity))) {
        throw new RangeError("A purchase needs at least one line with an integer quantity >= 1");
      }
      const email = gate.user.email;
      const { state } = ctx;

      const replay = state.idempotency.find(
        (r) => r.kind === "cart" && r.ownerEmail === email && r.key === o.idempotencyKey,
      );
      if (replay !== undefined && replay.kind === "cart") {
        return {
          kind: "created",
          orderRef: asRef<"order">(replay.orderRef),
          includedLineKeys: replay.includedLineKeys,
        };
      }

      // Duplicate lines are allocated in order against the quantity already taken (BR-ORD-014).
      const taken = new Map<string, number>();
      const reasons = lines.map((line) => {
        const key = cartLineKey(line);
        const before = taken.get(key) ?? 0;
        const reason = rejectionOf(ctx, line, email, before);
        if (reason === null) taken.set(key, before + line.quantity);
        return reason;
      });
      const forced = ctx.scenario.cart.purchaseStart;
      if (forced === "reject_one" || forced === "limit") {
        if (reasons[0] === null) {
          reasons[0] = forced === "reject_one" ? "ALLOCATION_CONFLICT" : "PURCHASE_LIMIT_EXCEEDED";
        }
      }
      const rejections = lines.flatMap((line, index) => {
        const reason = reasons[index];
        return reason === null || reason === undefined
          ? []
          : [{ lineKey: cartLineKey(line), reason }];
      });
      // All-or-nothing (BR-ORD-014): a rejection leaves every stored value unchanged.
      if (rejections.length > 0) return { kind: "rejected", rejections };

      const orderRef = idGenerator();
      const items: OrderItemRow[] = [];
      for (const line of lines) {
        switch (line.kind) {
          case "ENTRY_TICKET": {
            const offering = state.offerings.find((x) => x.ref === line.offeringRef);
            if (offering === undefined) break;
            offering.remaining -= line.quantity;
            items.push({
              kind: "ENTRY_TICKET",
              offeringRef: offering.ref,
              name: offering.name,
              quantity: line.quantity,
              unitPrice: offering.unitPrice,
              subtotal: multiplyMoney(offering.unitPrice, line.quantity),
            });
            break;
          }
          case "GOODS": {
            const goods = state.goods.find((x) => x.ref === line.goodsRef);
            if (goods === undefined) break;
            goods.remaining -= line.quantity;
            items.push({
              kind: "GOODS",
              goodsRef: goods.ref,
              name: goods.name,
              quantity: line.quantity,
              unitPrice: goods.unitPrice,
              subtotal: multiplyMoney(goods.unitPrice, line.quantity),
            });
            state.goodsItems.push({
              ref: idGenerator(),
              orderRef,
              goodsRef: goods.ref,
              goodsName: goods.name,
              quantity: line.quantity,
              itemState: "PENDING_PAYMENT",
              handoffState: "PENDING",
            });
            break;
          }
          default:
            assertNever(line);
        }
      }
      const includedLineKeys = lines.map(cartLineKey);
      state.orders.push({
        ref: orderRef,
        ownerEmail: email,
        purpose: decidePurpose(lines.map((l): OrderLineKind => l.kind)),
        state: "PREPARED",
        createdAt: ctx.nowIso,
        items,
        total: sumMoney(items.map((i) => i.subtotal)),
        receiptUrl: null,
        pendingWebhook: false,
        webhookReads: 0,
      });
      state.idempotency.push({
        kind: "cart",
        ownerEmail: email,
        key: o.idempotencyKey,
        orderRef,
        includedLineKeys,
      });
      db.save(state);
      return { kind: "created", orderRef: asRef<"order">(orderRef), includedLineKeys };
    },

    startKaraokePurchase: async (slotRef, o) => {
      const ctx = await open();
      if (ctx === null) return UNAVAILABLE;
      const gate = access(viewerOf(ctx.state));
      if (!gate.ok) return { kind: gate.reason };
      const email = gate.user.email;
      const { state } = ctx;

      const replay = state.idempotency.find(
        (r) => r.kind === "karaoke" && r.ownerEmail === email && r.key === o.idempotencyKey,
      );
      if (replay !== undefined) {
        return { kind: "held", orderRef: asRef<"order">(replay.orderRef) };
      }
      if (ctx.scenario.karaokeHold === "conflict") return { kind: "slot_unavailable" };
      if (ctx.scenario.karaokeHold === "limit") return { kind: "purchase_limit_exceeded" };
      if (ctx.scenario.karaokeSales !== "ON_SALE") return { kind: "not_on_sale" };
      const slot = slotView(state, slotRef);
      if (slot === undefined || slot.state !== "AVAILABLE") return { kind: "slot_unavailable" };

      slot.state = "HELD";
      const orderRef = idGenerator();
      const price = state.karaoke.price;
      state.orders.push({
        ref: orderRef,
        ownerEmail: email,
        purpose: decidePurpose(["KARAOKE"]),
        state: "PREPARED",
        createdAt: ctx.nowIso,
        items: [
          {
            kind: "KARAOKE",
            slotRef: slot.ref,
            name: "カラオケ利用枠",
            usageStart: slot.usageStart,
            usageEnd: slot.usageEnd,
            quantity: 1,
            unitPrice: price,
            subtotal: multiplyMoney(price, 1),
          },
        ],
        total: price,
        receiptUrl: null,
        pendingWebhook: false,
        webhookReads: 0,
      });
      state.idempotency.push({
        kind: "karaoke",
        ownerEmail: email,
        key: o.idempotencyKey,
        orderRef,
      });
      db.save(state);
      return { kind: "held", orderRef: asRef<"order">(orderRef) };
    },

    startCheckout: async (orderRef, o) => {
      const ctx = await open();
      if (ctx === null) return UNAVAILABLE;
      const gate = access(viewerOf(ctx.state));
      // CheckoutStart has no email_unverified result: a guest and an unverified user look alike.
      if (!gate.ok) return gate.reason === "unavailable" ? UNAVAILABLE : { kind: "auth_required" };
      const email = gate.user.email;
      const { state } = ctx;

      // Another user's Order and a nonexistent Order are not distinguished (SPEC-110 section 22).
      const order = state.orders.find((x) => x.ref === orderRef && x.ownerEmail === email);
      if (order === undefined) return { kind: "state_conflict" };

      // Key-only replay deliberately simplifies SPEC-110 section 18 (the real API answers 409
      // IDEMPOTENCY_KEY_REUSED for another Order); see tests/contracts/s2-mock-backend.md 11.3.
      const replay = state.idempotency.find(
        (r) => r.kind === "checkout" && r.ownerEmail === email && r.key === o.idempotencyKey,
      );
      if (replay !== undefined && replay.kind === "checkout") {
        return { kind: "redirect", url: replay.url };
      }
      if (order.state !== "PREPARED") return { kind: "state_conflict" };
      if (ctx.scenario.checkout === "start_failed") return { kind: "start_failed" };

      const isKaraoke = order.items.some((i) => i.kind === "KARAOKE");
      if (
        ctx.scenario.checkout === "opportunity_expired" ||
        (isKaraoke && ctx.scenario.karaokeHold === "expire_before_checkout")
      ) {
        transitionOrder(state, order, "EXPIRED", ctx.nowIso, idGenerator);
        db.save(state);
        return { kind: "opportunity_expired" };
      }

      // The Browser Return never confirms: only the simulated webhook (self.getOrder) can.
      const url = `/dev/mock-checkout/${order.ref}`;
      order.state = "AWAITING_PAYMENT";
      order.pendingWebhook = true;
      order.webhookReads = 0;
      state.idempotency.push({
        kind: "checkout",
        ownerEmail: email,
        key: o.idempotencyKey,
        orderRef: order.ref,
        url,
      });
      db.save(state);
      return { kind: "redirect", url };
    },
  };

  const selfApi: ApiPort["self"] = {
    getProfile: () =>
      selfRead((ctx) => ({
        kind: "ok",
        data: { email: ctx.user.email, displayName: ctx.user.displayName },
      })),

    updateProfile: async (input) => {
      const ctx = await open();
      if (ctx === null) return UNAVAILABLE;
      // ProfileUpdate has no authentication result; the UI never calls this as a guest.
      const gate = access(viewerOf(ctx.state));
      if (!gate.ok) return UNAVAILABLE;
      if (input.displayName.trim() === "") {
        return { kind: "validation_failed", field: "displayName" };
      }
      // The value is stored as given. A maximum length is not defined (UCR-100-001).
      gate.user.displayName = input.displayName;
      db.save(ctx.state);
      return {
        kind: "saved",
        profile: { email: gate.user.email, displayName: gate.user.displayName },
      };
    },

    listOrders: () =>
      selfRead((ctx) => ({
        kind: "ok",
        data: ctx.state.orders
          .map((order, index) => ({ order, index }))
          .filter(({ order }) => order.ownerEmail === ctx.user.email)
          .sort(
            (a, b) =>
              Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt) || b.index - a.index,
          )
          .map(({ order }) => orderSummary(order)),
      })),

    getOrder: (ref) =>
      selfRead((ctx) => {
        const order = ownedOrder(ctx, ref);
        if (order === undefined) return NOT_FOUND;
        // Simulated webhook (PAY-BRW-001..003): the Order state only moves here, per scenario.
        if (order.pendingWebhook && order.state === "AWAITING_PAYMENT") {
          order.webhookReads += 1;
          const next = webhookResult(ctx.scenario.paymentOutcome, order.webhookReads);
          if (next !== null) {
            order.pendingWebhook = false;
            transitionOrder(ctx.state, order, next, ctx.nowIso, idGenerator);
          }
          ctx.save();
        }
        return { kind: "ok", data: orderDetail(ctx.state, order, ctx.scenario) };
      }),

    listEntryTickets: () =>
      selfRead((ctx) => {
        const data: EntryTicketSummary[] = [];
        for (const ticket of ctx.state.tickets) {
          const detail = ticketSummary(ctx, ticket.ref);
          if (detail !== null) {
            data.push({
              ticketRef: detail.ticketRef,
              offeringName: detail.offeringName,
              state: detail.state,
              orderRef: detail.orderRef,
            });
          }
        }
        return { kind: "ok", data };
      }),

    getEntryTicket: (ref) =>
      selfRead((ctx) => {
        const detail = ticketSummary(ctx, ref);
        return detail === null ? NOT_FOUND : { kind: "ok", data: detail };
      }),

    getEntryQr: (ref) =>
      selfRead((ctx): Read<QrPresentation> => {
        const detail = ticketSummary(ctx, ref);
        if (detail === null) return NOT_FOUND;
        if (detail.state !== "VALID") {
          return { kind: "ok", data: { kind: "not_presentable", ticketState: detail.state } };
        }
        return {
          kind: "ok",
          data: { kind: "presentable", purpose: "ENTRY", mockMatrixSeed: mockMatrixSeed(ref) },
        };
      }),

    listReservations: () =>
      selfRead((ctx) => {
        const data: ReservationSummary[] = [];
        for (const reservation of ctx.state.reservations) {
          const summary = reservationSummary(ctx, reservation.ref);
          if (summary !== null) data.push(summary);
        }
        return { kind: "ok", data };
      }),

    getReservation: (ref) =>
      selfRead((ctx): Read<ReservationDetail> => {
        const summary = reservationSummary(ctx, ref);
        const reservation = ctx.state.reservations.find((r) => r.ref === ref);
        if (summary === null || reservation === undefined) return NOT_FOUND;
        const order = ownedOrder(ctx, reservation.orderRef);
        return {
          kind: "ok",
          data: {
            ...summary,
            slotRef: asRef<"slot">(reservation.slotRef),
            price: ctx.state.karaoke.price,
            receiptUrl: order?.receiptUrl ?? null,
          },
        };
      }),

    getKaraokeQr: (ref) =>
      selfRead((ctx): Read<QrPresentation> => {
        const summary = reservationSummary(ctx, ref);
        if (summary === null) return NOT_FOUND;
        if (summary.reservationState !== "CONFIRMED" || summary.ticketState !== "VALID") {
          return {
            kind: "ok",
            data: { kind: "not_presentable", ticketState: summary.ticketState },
          };
        }
        return {
          kind: "ok",
          data: { kind: "presentable", purpose: "KARAOKE", mockMatrixSeed: mockMatrixSeed(ref) },
        };
      }),

    listGoodsItems: () =>
      selfRead((ctx) => {
        const data: GoodsItemSummary[] = [];
        for (const item of ctx.state.goodsItems) {
          const summary = goodsItemSummary(ctx, item.ref);
          if (summary !== null) data.push(summary);
        }
        return { kind: "ok", data };
      }),

    getGoodsItem: (ref) =>
      selfRead((ctx): Read<GoodsItemDetail> => {
        const summary = goodsItemSummary(ctx, ref);
        const item = ctx.state.goodsItems.find((g) => g.ref === ref);
        if (summary === null || item === undefined) return NOT_FOUND;
        const order = ownedOrder(ctx, item.orderRef);
        const line = order?.items.find((i) => i.kind === "GOODS" && i.goodsRef === item.goodsRef);
        if (order === undefined || line === undefined) return NOT_FOUND;
        return {
          kind: "ok",
          data: {
            ...summary,
            unitPrice: line.unitPrice,
            subtotal: multiplyMoney(line.unitPrice, item.quantity),
            receiptUrl: order.receiptUrl,
          },
        };
      }),
  };

  return { public: publicApi, purchase: purchaseApi, self: selfApi };
}
