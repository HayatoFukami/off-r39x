import { z } from "zod";
import {
  checkoutAttemptId,
  entryTicketId,
  goodsOrderItemId,
  isoUtc,
  karaokeHoldId,
  karaokeReservationId,
  karaokeSlotId,
  karaokeTicketId,
  lowerUuid,
  moneyAmount,
  orderId,
  paymentBindingId,
  refundRecordId,
} from "./wire-values.ts";

export type {
  CheckoutAttemptId,
  EntryTicketId,
  GoodsOrderItemId,
  KaraokeHoldId,
  KaraokeReservationId,
  KaraokeSlotId,
  KaraokeTicketId,
  OrderId,
  PaymentBindingId,
  RefundRecordId,
} from "./wire-values.ts";

// Consistency Review open input (SPEC-150 §43-§44, SPEC-100 §43, SPEC-120 §43.1). This module only
// defines the input shape. The CHECK / UNIQUE constraints and the INSERT belong to the adapter.
// The dedupe key and its parts are not part of this input: SPEC-150 REL-REC-007 does not define
// them completely yet (approved D-4), so a caller cannot supply one.

// SPEC-150 §43 canonical reason codes. They are not Domain States (REL-REC-006).
export const REVIEW_REASON_CODES = [
  "AUTH_PROFILE_RELATION_INCONSISTENT",
  "ROLE_ADMIN_SET_INCONSISTENT",
  "PAY_CHECKOUT_RESULT_UNRESOLVED",
  "PAY_BINDING_INCONSISTENT",
  "PAY_CONFIRMATION_INCONSISTENT",
  "PAY_LATE_SUCCESS_RESOURCE_REUSED",
  "REFUND_RESULT_UNRESOLVED",
  "REFUND_DOMAIN_CANCELLATION_INCOMPLETE",
  "WEBHOOK_CORRELATION_UNRESOLVED",
  "TQR_TOKEN_CORRELATION_INCONSISTENT",
  "TQR_KEY_MIGRATION_FAILED",
  "TQR_CHECKIN_STATE_INCONSISTENT",
  "KRK_HOLD_SLOT_INCONSISTENT",
  "KRK_RESERVATION_TICKET_INCONSISTENT",
  "GDS_INVENTORY_COUNTER_INCONSISTENT",
  "GDS_HANDOFF_STATE_INCONSISTENT",
  "EML_NOTIFICATION_CAUSE_INCONSISTENT",
  "EML_PROVIDER_RESULT_UNRESOLVED",
  "EML_RECIPIENT_RELATION_INCONSISTENT",
  "EML_RENDER_CONTEXT_INVALID",
  "EML_WEBHOOK_UNMATCHED",
  "SECURITY_KEY_VERSION_INCONSISTENT",
] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

const reviewReasonCodeSchema = z.enum(REVIEW_REASON_CODES);

// SPEC-100 §43: the ten target FK columns, each optional on its own. A Notification Request is not
// a target (SPEC-120 §43.1). Unknown keys are rejected.
const targetsObject = z.strictObject({
  orderId: orderId.optional(),
  checkoutAttemptId: checkoutAttemptId.optional(),
  paymentBindingId: paymentBindingId.optional(),
  refundRecordId: refundRecordId.optional(),
  karaokeSlotId: karaokeSlotId.optional(),
  karaokeHoldId: karaokeHoldId.optional(),
  karaokeReservationId: karaokeReservationId.optional(),
  entryTicketId: entryTicketId.optional(),
  karaokeTicketId: karaokeTicketId.optional(),
  goodsOrderItemId: goodsOrderItemId.optional(),
});
export type ReviewCaseTargets = z.infer<typeof targetsObject>;

// SPEC-100 §43 CHECK: at least one target FK is non-null.
function hasTarget(targets: ReviewCaseTargets): boolean {
  return Object.values(targets).some((value) => value !== undefined);
}

// SPEC-120 §43.1: an Email consistency reason targets source_order_id / source_reservation_id only.
function hasOnlyOrderOrReservation(targets: ReviewCaseTargets): boolean {
  return Object.entries(targets).every(
    ([key, value]) => value === undefined || key === "orderId" || key === "karaokeReservationId",
  );
}

// SPEC-150 §44 REL-REC-008: details hold only allowlisted state, public refs, amount / currency,
// provider status category and timestamps.
// The "state" and "provider_status_category" kinds are NOT accepted yet: no owner defines the
// allowlisted vocabulary (UCR U-6), a token shape check cannot tell an allowlisted value from an
// unknown one or from a Secret made of upper-case letters, digits and "_", and this port must not
// invent the vocabulary (AGENTS.md §7). Add each kind back as a closed enum once it is specified.
// What the structure prevents in the accepted kinds: an email address, free text and lower-case or
// mixed-case Secrets (a UUID, a decimal amount and a canonical timestamp have fixed forms), a
// numeric Internal ID (number and boolean values have no slot), and nested values or a raw body.
// What it does not prevent, and the caller must not pass: a public_ref that is really some other
// UUID-shaped value.
const detailValue = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("public_ref"), value: lowerUuid }),
  z.strictObject({
    kind: z.literal("money"),
    amount: moneyAmount,
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.strictObject({ kind: z.literal("timestamp"), value: isoUtc }),
]);

const detailKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const detailsSchema = z.record(detailKey, detailValue);
export type ReviewCaseDetails = z.infer<typeof detailsSchema>;

// Generated or later-owned columns (public reference, opened / resolved times, resolution note)
// and the dedupe key have no slot.
const reviewCaseOpenInputBase = z
  .strictObject({
    reasonCode: reviewReasonCodeSchema,
    targets: targetsObject,
    details: detailsSchema,
  })
  .superRefine((input, context) => {
    if (!hasTarget(input.targets)) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "at least one target is required",
      });
      return;
    }
    if (input.reasonCode.startsWith("EML_") && !hasOnlyOrderOrReservation(input.targets)) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "an email reason targets an order or a reservation only",
      });
    }
  });

// The public type carries the two target constraints, so a value typed ReviewCaseOpenInput has
// already satisfied them at compile time; the schema above enforces them at run time. z.infer of
// a superRefine schema cannot express them, hence the explicit type and the cast below.
type AtLeastOne<T> = {
  [Key in keyof T]-?: { [Name in Key]-?: NonNullable<T[Name]> } & {
    [Name in Exclude<keyof T, Key>]?: T[Name];
  };
}[keyof T];
// SPEC-120 §43.1: an email reason targets an order or a reservation only. Pick alone would just
// leave the other keys out of the type, so a variable that also holds one of them would still be
// assignable; each other known key is forbidden explicitly as an optional never.
type EmailTargets = AtLeastOne<Pick<ReviewCaseTargets, "orderId" | "karaokeReservationId">> & {
  readonly [Key in Exclude<keyof ReviewCaseTargets, "orderId" | "karaokeReservationId">]?: never;
};
type EmailReasonCode = Extract<ReviewReasonCode, `EML_${string}`>;
type NonEmailReasonCode = Exclude<ReviewReasonCode, EmailReasonCode>;

export type ReviewCaseOpenInput =
  | {
      readonly reasonCode: EmailReasonCode;
      readonly targets: EmailTargets;
      readonly details: ReviewCaseDetails;
    }
  | {
      readonly reasonCode: NonEmailReasonCode;
      readonly targets: AtLeastOne<ReviewCaseTargets>;
      readonly details: ReviewCaseDetails;
    };

// Fails to compile when the explicit type drifts from the run-time shape (an added, removed or
// retyped item): the explicit type must stay assignable to what the schema accepts.
type AssertAssignable<Narrow extends Wide, Wide> = Narrow;
export type ReviewCaseOpenInputIsParsable = AssertAssignable<
  ReviewCaseOpenInput,
  z.infer<typeof reviewCaseOpenInputBase>
>;

export const reviewCaseOpenInputSchema = reviewCaseOpenInputBase as unknown as z.ZodType<
  ReviewCaseOpenInput,
  z.input<typeof reviewCaseOpenInputBase>
>;
