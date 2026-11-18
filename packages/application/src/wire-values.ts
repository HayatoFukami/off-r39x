import { z } from "zod";

// Value schemas shared by the notification and review-case port inputs. None of the checks echoes
// the offending value into a message.

// SPEC-110 §9: public references are lowercase canonical UUIDs. Uppercase is refused so that one
// reference cannot produce two different Business Cause keys.
export const lowerUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

// SPEC-110 §10: YYYY-MM-DDTHH:mm:ss.sssZ. The round trip through Date refuses dates that do not
// exist and non-canonical forms.
export const isoUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && new Date(time).toISOString() === value;
  });
export type IsoUtc = z.infer<typeof isoUtc>;

const MAX_BIGINT_64 = 9223372036854775807n;
const DECIMAL_AMOUNT = /^(0|[1-9][0-9]*)$/;

// SPEC-110 §11, SPEC-120 §17.3, SPEC-100 §9: minor-unit decimal string plus an ISO 4217 code. The
// shape is checked here; whether a currency is supported is the renderer's decision (§17.3).
export const moneyAmount = z
  .string()
  .regex(DECIMAL_AMOUNT)
  .refine(
    // Zod 4 still runs this after a failed regex, so test the form before calling BigInt().
    (value) => DECIMAL_AMOUNT.test(value) && value.length <= 19 && BigInt(value) <= MAX_BIGINT_64,
  );
export const money = z.strictObject({
  amount: moneyAmount,
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof money>;

// SPEC-120 §10 / §12 positiveInteger; SPEC-100 §9 (quantity is a 32-bit integer).
export const positiveInteger = z.int().min(1).max(2147483647);

// EML-TPL-002: required text is never filled with an empty string.
export const requiredText = z.string().min(1);

// SEC-EML-006: event_name becomes part of the email subject, so a CR or LF would allow header
// injection. Non-empty like requiredText; the check never echoes the value.
export const singleLineText = z
  .string()
  .min(1)
  .regex(/^[^\r\n]+$/);

// SPEC-100 §7.1: Internal IDs are bigint identities. The brand keeps an Order ID from being passed
// where a Reservation ID is expected. A `number` is never accepted.
function internalId<Name extends string>() {
  return z.bigint().positive().brand<Name>();
}
export const businessProfileId = internalId<"BusinessProfileId">();
export const orderId = internalId<"OrderId">();
export const karaokeReservationId = internalId<"KaraokeReservationId">();
export const checkoutAttemptId = internalId<"CheckoutAttemptId">();
export const paymentBindingId = internalId<"PaymentBindingId">();
export const refundRecordId = internalId<"RefundRecordId">();
export const karaokeSlotId = internalId<"KaraokeSlotId">();
export const karaokeHoldId = internalId<"KaraokeHoldId">();
export const entryTicketId = internalId<"EntryTicketId">();
export const karaokeTicketId = internalId<"KaraokeTicketId">();
export const goodsOrderItemId = internalId<"GoodsOrderItemId">();

export type BusinessProfileId = z.infer<typeof businessProfileId>;
export type OrderId = z.infer<typeof orderId>;
export type KaraokeReservationId = z.infer<typeof karaokeReservationId>;
export type CheckoutAttemptId = z.infer<typeof checkoutAttemptId>;
export type PaymentBindingId = z.infer<typeof paymentBindingId>;
export type RefundRecordId = z.infer<typeof refundRecordId>;
export type KaraokeSlotId = z.infer<typeof karaokeSlotId>;
export type KaraokeHoldId = z.infer<typeof karaokeHoldId>;
export type EntryTicketId = z.infer<typeof entryTicketId>;
export type KaraokeTicketId = z.infer<typeof karaokeTicketId>;
export type GoodsOrderItemId = z.infer<typeof goodsOrderItemId>;
