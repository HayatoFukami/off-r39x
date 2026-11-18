import { z } from "zod";
import { uuidV5 } from "./uuid-v5.ts";
import {
  businessProfileId,
  isoUtc,
  karaokeReservationId,
  lowerUuid,
  money,
  orderId,
  positiveInteger,
  requiredText,
  singleLineText,
} from "./wire-values.ts";

export type {
  BusinessProfileId,
  IsoUtc,
  KaraokeReservationId,
  Money,
  OrderId,
} from "./wire-values.ts";

// Notification Request enqueue input (SPEC-120 §8-§14, §16, §17). This module only defines the
// input shape and the pure Business Cause derivation. It does not write to a database, resolve a
// recipient, render a template or send anything; persistence and convergence on the UNIQUE key
// belong to the adapter that implements the port.

// SPEC-120 §9. These are not Domain States (EML-NTF-003); they stay in this layer.
export const NOTIFICATION_TYPES = [
  "ENTRY_PURCHASE_CONFIRMED",
  "KARAOKE_RESERVATION_CONFIRMED",
  "GOODS_PURCHASE_CONFIRMED",
  "ENTRY_GOODS_PURCHASE_CONFIRMED",
  "KARAOKE_RESERVATION_CANCELED",
  "ORDER_REFUND_SUCCEEDED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// SPEC-120 §9 / §16: one template and version per type. The mapped type turns a missing type into
// a compile error, so no type can fall through to a default template (EML-TPL-001).
export const NOTIFICATION_TEMPLATES: {
  readonly [Type in NotificationType]: {
    readonly templateId: string;
    readonly templateVersion: 1;
  };
} = {
  ENTRY_PURCHASE_CONFIRMED: { templateId: "entry-purchase-confirmation", templateVersion: 1 },
  KARAOKE_RESERVATION_CONFIRMED: {
    templateId: "karaoke-reservation-confirmation",
    templateVersion: 1,
  },
  GOODS_PURCHASE_CONFIRMED: { templateId: "goods-purchase-confirmation", templateVersion: 1 },
  ENTRY_GOODS_PURCHASE_CONFIRMED: {
    templateId: "entry-goods-purchase-confirmation",
    templateVersion: 1,
  },
  KARAOKE_RESERVATION_CANCELED: {
    templateId: "karaoke-reservation-cancellation",
    templateVersion: 1,
  },
  ORDER_REFUND_SUCCEEDED: { templateId: "order-refund-succeeded", templateVersion: 1 },
};

// SPEC-120 §10-§14 and §17.1 (event_name). Keys are the stored JSON names, so they stay snake_case.
// app_base_url is not stored (§17.1). There is no slot for an email address, a Secret, an internal
// ID or a raw QR payload (§46). event_name is part of the subject, so it refuses CR / LF
// (SEC-EML-006); the other text items never reach the subject.
const entryItem = z.strictObject({ offering_name: requiredText, quantity: positiveInteger });
const goodsItem = z.strictObject({ goods_name: requiredText, quantity: positiveInteger });
const entryItems = z.array(entryItem).min(1);
const goodsItems = z.array(goodsItem).min(1);

const entryPurchaseContext = z.strictObject({
  event_name: singleLineText,
  order_ref: lowerUuid,
  confirmed_at: isoUtc,
  total: money,
  entry_items: entryItems,
});

const karaokeConfirmedContext = z.strictObject({
  event_name: singleLineText,
  order_ref: lowerUuid,
  reservation_ref: lowerUuid,
  confirmed_at: isoUtc,
  usage_start: isoUtc,
  usage_end: isoUtc,
  total: money,
  slot_display_name: requiredText.nullable(),
});

const goodsPurchaseContext = z.strictObject({
  event_name: singleLineText,
  order_ref: lowerUuid,
  confirmed_at: isoUtc,
  total: money,
  goods_items: goodsItems,
  handoff_instructions: requiredText.nullable(),
});

// SPEC-120 §12.1: both item arrays are required, so one side missing is rejected.
const entryGoodsPurchaseContext = z.strictObject({
  event_name: singleLineText,
  order_ref: lowerUuid,
  confirmed_at: isoUtc,
  total: money,
  entry_items: entryItems,
  goods_items: goodsItems,
  handoff_instructions: requiredText.nullable(),
});

// SPEC-120 §13 allows only a label generated from a server-side allowlist, and no such allowlist
// is specified yet. Until it is, only null is accepted (approved D-5).
const karaokeCanceledContext = z.strictObject({
  event_name: singleLineText,
  reservation_ref: lowerUuid,
  canceled_at: isoUtc,
  usage_start: isoUtc,
  usage_end: isoUtc,
  cancellation_reason_label: z.null(),
});

const orderRefundContext = z.strictObject({
  event_name: singleLineText,
  order_ref: lowerUuid,
  refunded_at: isoUtc,
  refunded_total: money,
});

export const renderContextSchemas = {
  ENTRY_PURCHASE_CONFIRMED: entryPurchaseContext,
  KARAOKE_RESERVATION_CONFIRMED: karaokeConfirmedContext,
  GOODS_PURCHASE_CONFIRMED: goodsPurchaseContext,
  ENTRY_GOODS_PURCHASE_CONFIRMED: entryGoodsPurchaseContext,
  KARAOKE_RESERVATION_CANCELED: karaokeCanceledContext,
  ORDER_REFUND_SUCCEEDED: orderRefundContext,
} as const satisfies { readonly [Type in NotificationType]: z.ZodType };

export type RenderContextOf<Type extends NotificationType> = z.infer<
  (typeof renderContextSchemas)[Type]
>;

// SPEC-120 §8.1 / §10-§14 "Source" lines and SPEC-100 §42 CHECK. The recipient is a Business
// Profile ID only; the email address is resolved by the Worker (§15, EML-RCP-001). The Business
// Cause key, state, template version, Idempotency-Key, Request ID and worker ID have no slot: the
// objects are strict, so passing any of them is rejected.
export const notificationEnqueueInputSchema = z.discriminatedUnion("notificationType", [
  z.strictObject({
    notificationType: z.literal("ENTRY_PURCHASE_CONFIRMED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId,
    sourceReservationId: z.null(),
    renderContext: entryPurchaseContext,
  }),
  z.strictObject({
    notificationType: z.literal("KARAOKE_RESERVATION_CONFIRMED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId,
    sourceReservationId: karaokeReservationId,
    renderContext: karaokeConfirmedContext,
  }),
  z.strictObject({
    notificationType: z.literal("GOODS_PURCHASE_CONFIRMED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId,
    sourceReservationId: z.null(),
    renderContext: goodsPurchaseContext,
  }),
  z.strictObject({
    notificationType: z.literal("ENTRY_GOODS_PURCHASE_CONFIRMED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId,
    sourceReservationId: z.null(),
    renderContext: entryGoodsPurchaseContext,
  }),
  z.strictObject({
    notificationType: z.literal("KARAOKE_RESERVATION_CANCELED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId.nullable(),
    sourceReservationId: karaokeReservationId,
    renderContext: karaokeCanceledContext,
  }),
  z.strictObject({
    notificationType: z.literal("ORDER_REFUND_SUCCEEDED"),
    recipientProfileId: businessProfileId,
    sourceOrderId: orderId,
    sourceReservationId: karaokeReservationId.nullable(),
    renderContext: orderRefundContext,
  }),
]);
export type NotificationEnqueueInput = z.infer<typeof notificationEnqueueInputSchema>;

// SPEC-120 §8.2: a source code constant, never changed per environment. Changing it would
// disconnect the Business Cause keys of notifications that already exist from new ones and break
// duplicate prevention, so it must not be changed.
export const NOTIFICATION_CAUSE_NAMESPACE = "af5a24eb-3aaf-46ed-9da5-4bce2fe5cf9f";

// SPEC-120 §8.2 examples: the event discriminator is fixed per type.
const EVENT_DISCRIMINATORS: { readonly [Type in NotificationType]: string } = {
  ENTRY_PURCHASE_CONFIRMED: "CONFIRMED",
  KARAOKE_RESERVATION_CONFIRMED: "CONFIRMED",
  GOODS_PURCHASE_CONFIRMED: "CONFIRMED",
  ENTRY_GOODS_PURCHASE_CONFIRMED: "CONFIRMED",
  KARAOKE_RESERVATION_CANCELED: "CANCELED",
  ORDER_REFUND_SUCCEEDED: "FULL_REFUND_SUCCEEDED",
};

const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

// "<notification_type>:<source_public_ref>:<event_discriminator>". Both arguments are checked on
// entry. A failure names the check, never the value.
export function notificationBusinessCauseName(
  type: NotificationType,
  sourcePublicRef: string,
): string {
  const checkedType = notificationTypeSchema.parse(type);
  const checkedRef = lowerUuid.parse(sourcePublicRef);
  return `${checkedType}:${checkedRef}:${EVENT_DISCRIMINATORS[checkedType]}`;
}

// The source public reference that SPEC-120 §10-§14 put into the Business Cause of each type.
function sourcePublicRefOf(input: NotificationEnqueueInput): string {
  switch (input.notificationType) {
    case "ENTRY_PURCHASE_CONFIRMED":
    case "GOODS_PURCHASE_CONFIRMED":
    case "ENTRY_GOODS_PURCHASE_CONFIRMED":
    case "ORDER_REFUND_SUCCEEDED":
      return input.renderContext.order_ref;
    case "KARAOKE_RESERVATION_CONFIRMED":
    case "KARAOKE_RESERVATION_CANCELED":
      return input.renderContext.reservation_ref;
  }
}

// business_cause_key = UUIDv5(NOTIFICATION_CAUSE_NAMESPACE, name). It depends on the type and the
// source reference only: an Idempotency-Key, Request ID or worker ID is neither a parameter nor
// part of the input (EML-GEN-003). The input is re-validated so that a value that slipped past the
// type system never produces a key.
export function notificationBusinessCauseKey(input: NotificationEnqueueInput): string {
  const checked = notificationEnqueueInputSchema.parse(input);
  return uuidV5(
    NOTIFICATION_CAUSE_NAMESPACE,
    notificationBusinessCauseName(checked.notificationType, sourcePublicRefOf(checked)),
  );
}
