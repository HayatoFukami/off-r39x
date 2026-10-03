import type {
  EntryTicketState,
  GoodsHandoffState,
  GoodsItemState,
  KaraokeSlotState,
  KaraokeTicketState,
  OrderPurpose,
  OrderState,
  ReservationState,
} from "@off-r39x/domain";

// Shared presentation-facing types (S1 subset). Money is a decimal string (DEV-TS-006).

export type Ref<T extends string> = string & { readonly __ref: T };

export type Money = { readonly amount: string; readonly currency: string };

export type UtcInstant = string & { readonly __utc: true };

export type BusinessDateJst = string & { readonly __jst: true };

export type SaleAvailability =
  | { kind: "ON_SALE"; maxSelectableQuantity: number | null }
  | { kind: "BEFORE_SALES"; startsAt: UtcInstant }
  | { kind: "SALES_ENDED" }
  | { kind: "SUSPENDED" }
  | { kind: "SOLD_OUT" }
  | { kind: "INSUFFICIENT_QUANTITY"; maxSelectableQuantity: number }
  | { kind: "PURCHASE_LIMIT_EXCEEDED" };

// ---- S2 additions: view models returned by the ApiPort (tests/contracts/s2-mock-backend.md section 1).

export type Read<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "unavailable" } // never converted to Empty
  | { kind: "auth_required" }
  | { kind: "email_unverified" };

// Karaoke cannot be represented as a cart line (FR-CRT-002).
export type CartLine =
  | { kind: "ENTRY_TICKET"; offeringRef: Ref<"offering">; quantity: number }
  | { kind: "GOODS"; goodsRef: Ref<"goods">; quantity: number };

export type CartRejectionReasonCode =
  | "BEFORE_SALES"
  | "SALES_ENDED"
  | "SUSPENDED"
  | "SOLD_OUT"
  | "INSUFFICIENT_QUANTITY"
  | "PURCHASE_LIMIT_EXCEEDED"
  | "ALLOCATION_CONFLICT"
  | "NOT_PUBLIC";

export type CartLineResolution = { lineKey: string } & (
  | { status: "resolved"; name: string; unitPrice: Money; availability: SaleAvailability }
  | { status: "not_public" }
  | { status: "unavailable" }
);

export type CartPurchaseStart =
  | { kind: "created"; orderRef: Ref<"order">; includedLineKeys: readonly string[] }
  | {
      kind: "rejected";
      rejections: readonly { lineKey: string; reason: CartRejectionReasonCode }[];
    }
  | { kind: "auth_required" }
  | { kind: "email_unverified" }
  | { kind: "unavailable" };

export type KaraokePurchaseStart =
  | { kind: "held"; orderRef: Ref<"order"> }
  | { kind: "slot_unavailable" }
  | { kind: "purchase_limit_exceeded" }
  | { kind: "not_on_sale" }
  | { kind: "auth_required" }
  | { kind: "email_unverified" }
  | { kind: "unavailable" };

export type CheckoutStart =
  | { kind: "redirect"; url: string } // top-level navigation only (SEC-WEB-005)
  | { kind: "start_failed" }
  | { kind: "opportunity_expired" }
  | { kind: "state_conflict" }
  | { kind: "auth_required" }
  | { kind: "unavailable" };

export type ProfileUpdate =
  | { kind: "saved"; profile: Profile }
  | { kind: "validation_failed"; field: "displayName" }
  | { kind: "unavailable" };

export type KaraokeSaleStatus = "ON_SALE" | "BEFORE_SALES" | "SALES_ENDED" | "SUSPENDED";
export type SalesPeriod = { startsAt: UtcInstant; endsAt: UtcInstant };

export type EventInfo = {
  name: string;
  overview: string | null;
  startsAt: UtcInstant | null;
  endsAt: UtcInstant | null;
  venueName: string | null;
  venueGuide: string | null;
  accessInfo: string | null;
  notices: readonly string[] | null; // unset fields are null (no guessed values)
};
export type FaqItem = { id: string; question: string; answer: string };
export type AnnouncementSummary = {
  announcementRef: Ref<"announcement">;
  title: string;
  publishedAt: UtcInstant;
  excerpt: string;
};
// body is the original text: never sanitized or escaped here.
export type Announcement = AnnouncementSummary & { body: string };
export type SponsorLogo = {
  sponsorRef: Ref<"sponsor">;
  name: string;
  imageUrl: string | null;
  linkUrl: string | null;
};
export type EntryOffering = {
  offeringRef: Ref<"offering">;
  name: string;
  description: string;
  unitPrice: Money;
  salesPeriod: SalesPeriod;
  availability: SaleAvailability;
  perAccountLimit: number | null;
};
export type KaraokeSales = {
  price: Money;
  salesPeriod: SalesPeriod;
  saleStatus: KaraokeSaleStatus;
  salesDates: readonly BusinessDateJst[];
};
export type KaraokeDaySlot = {
  slotRef: Ref<"slot">;
  usageStart: UtcInstant;
  usageEnd: UtcInstant;
  state: KaraokeSlotState;
};
export type KaraokeBucket = {
  startHour: number;
  totalSlots: number;
  availableSlots: number;
  slots: readonly KaraokeDaySlot[];
};
export type KaraokeDay = {
  date: BusinessDateJst;
  saleStatus: KaraokeSaleStatus;
  buckets: readonly KaraokeBucket[];
  previousDate: BusinessDateJst | null;
  nextDate: BusinessDateJst | null;
};
export type KaraokeSlotDetail = {
  slotRef: Ref<"slot">;
  date: BusinessDateJst;
  usageStart: UtcInstant;
  usageEnd: UtcInstant;
  price: Money;
  state: KaraokeSlotState;
  saleStatus: KaraokeSaleStatus;
  purchasable: boolean; // state === "AVAILABLE" && saleStatus === "ON_SALE"
};
export type GoodsSummary = {
  goodsRef: Ref<"goods">;
  name: string;
  shortDescription: string;
  unitPrice: Money;
  availability: SaleAvailability;
};
export type GoodsDetail = {
  goodsRef: Ref<"goods">;
  name: string;
  description: string;
  unitPrice: Money;
  salesPeriod: SalesPeriod;
  availability: SaleAvailability;
  venuePickupOnly: true;
};
export type Profile = { email: string; displayName: string };
export type OrderItem =
  | {
      kind: "ENTRY_TICKET";
      offeringRef: Ref<"offering">;
      name: string;
      quantity: number;
      unitPrice: Money;
      subtotal: Money;
    }
  | {
      kind: "GOODS";
      goodsRef: Ref<"goods">;
      name: string;
      quantity: number;
      unitPrice: Money;
      subtotal: Money;
    }
  | {
      kind: "KARAOKE";
      slotRef: Ref<"slot">;
      name: string;
      usageStart: UtcInstant;
      usageEnd: UtcInstant;
      quantity: 1;
      unitPrice: Money;
      subtotal: Money;
    };
export type OrderSummary = {
  orderRef: Ref<"order">;
  purpose: OrderPurpose;
  state: OrderState;
  createdAt: UtcInstant;
  total: Money;
  summary: string;
};
export type OrderEntitlements = {
  entryTicketRefs: readonly Ref<"ticket">[];
  reservationRef: Ref<"reservation"> | null;
  goodsItems: readonly {
    ref: Ref<"goodsItem">;
    itemState: GoodsItemState;
    handoffState: GoodsHandoffState;
  }[];
};
export type OrderDetail = OrderSummary & {
  items: readonly OrderItem[]; // purchase-time Snapshot
  entitlements: OrderEntitlements; // always present; empty unless CONFIRMED
  receiptUrl: string | null;
  notice: { kind: "email_delayed" } | null;
};
export type EntryTicketSummary = {
  ticketRef: Ref<"ticket">;
  offeringName: string;
  state: EntryTicketState;
  orderRef: Ref<"order">;
};
export type EntryTicketDetail = EntryTicketSummary & { issuedAt: UtcInstant };
export type ReservationSummary = {
  reservationRef: Ref<"reservation">;
  orderRef: Ref<"order">;
  date: BusinessDateJst;
  usageStart: UtcInstant;
  usageEnd: UtcInstant;
  reservationState: ReservationState;
  ticketState: KaraokeTicketState;
};
export type ReservationDetail = ReservationSummary & {
  slotRef: Ref<"slot">;
  price: Money;
  receiptUrl: string | null;
};
export type GoodsItemSummary = {
  goodsItemRef: Ref<"goodsItem">;
  goodsName: string;
  quantity: number;
  itemState: GoodsItemState;
  handoffState: GoodsHandoffState;
  orderRef: Ref<"order">;
  orderState: OrderState;
};
export type GoodsItemDetail = GoodsItemSummary & {
  unitPrice: Money;
  subtotal: Money;
  receiptUrl: string | null;
};
export type QrPresentation =
  | { kind: "presentable"; purpose: "ENTRY" | "KARAOKE"; mockMatrixSeed: string }
  | { kind: "not_presentable"; ticketState: EntryTicketState | KaraokeTicketState };
