import { assertNever, type NotificationState } from "@off-r39x/domain";
import { copy } from "../copy/ja";
import type { Tone } from "./order";

export type NotificationPresentation = {
  readonly label: string;
  readonly message: string;
  readonly tone: Tone;
  readonly blocking: false;
  readonly keepsPurchaseSuccess: true;
  readonly actions: readonly [];
};

export function presentNotification(state: NotificationState): NotificationPresentation | null {
  switch (state) {
    case "PENDING":
      return {
        label: copy.notification.PENDING.label,
        message: copy.notification.PENDING.message,
        tone: "pending",
        blocking: false,
        keepsPurchaseSuccess: true,
        actions: [],
      };
    case "SENT":
      return {
        label: copy.notification.SENT.label,
        message: copy.notification.SENT.message,
        tone: "neutral",
        blocking: false,
        keepsPurchaseSuccess: true,
        actions: [],
      };
    case "FAILED_RETRYABLE":
      return {
        label: copy.notification.FAILED_RETRYABLE.label,
        message: copy.notification.FAILED_RETRYABLE.message,
        tone: "review",
        blocking: false,
        keepsPurchaseSuccess: true,
        actions: [],
      };
    case "CANCELED":
      return null;
    default:
      return assertNever(state);
  }
}
