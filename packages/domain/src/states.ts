export const ORDER_STATES = [
  "PREPARED",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PAYMENT_FAILED",
  "CANCELED",
  "EXPIRED",
  "REVIEW_REQUIRED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_PURPOSES = [
  "ENTRY_TICKET_PURCHASE",
  "KARAOKE_PURCHASE",
  "GOODS_PURCHASE",
  "ENTRY_GOODS_PURCHASE",
] as const;
export type OrderPurpose = (typeof ORDER_PURPOSES)[number];

export const ENTRY_TICKET_STATES = ["VALID", "USED", "CANCELED", "EXPIRED"] as const;
export type EntryTicketState = (typeof ENTRY_TICKET_STATES)[number];

export const KARAOKE_SLOT_STATES = ["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"] as const;
export type KaraokeSlotState = (typeof KARAOKE_SLOT_STATES)[number];

export const KARAOKE_HOLD_STATES = ["ACTIVE", "COMMITTED", "RELEASED", "EXPIRED"] as const;
export type KaraokeHoldState = (typeof KARAOKE_HOLD_STATES)[number];

export const RESERVATION_STATES = ["CONFIRMED", "CANCELED"] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export const KARAOKE_TICKET_STATES = ["VALID", "USED", "CANCELED", "EXPIRED"] as const;
export type KaraokeTicketState = (typeof KARAOKE_TICKET_STATES)[number];

export const GOODS_ITEM_STATES = ["PENDING_PAYMENT", "FULFILLABLE", "CANCELED"] as const;
export type GoodsItemState = (typeof GOODS_ITEM_STATES)[number];

export const GOODS_HANDOFF_STATES = ["PENDING", "COMPLETED", "VOID"] as const;
export type GoodsHandoffState = (typeof GOODS_HANDOFF_STATES)[number];

export const NOTIFICATION_STATES = ["PENDING", "SENT", "FAILED_RETRYABLE", "CANCELED"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export const PUBLICATION_STATES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];
