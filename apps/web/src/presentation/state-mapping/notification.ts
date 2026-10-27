import { assertNever } from "@off-r39x/domain";
import type { NotificationSummaryStatus } from "../../api-client/types";
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

/**
 * Maps the API-ORD-003 notification_summary status to the non-blocking notice (SPEC-050 16.2 / 16.7).
 * Only ATTENTION_REQUIRED is shown; PENDING, SENT and NONE show nothing.
 */
export function presentNotificationSummary(
  status: NotificationSummaryStatus,
): NotificationPresentation | null {
  switch (status) {
    case "ATTENTION_REQUIRED":
      return {
        label: copy.notification.ATTENTION_REQUIRED.label,
        message: copy.notification.ATTENTION_REQUIRED.message,
        tone: "review",
        blocking: false,
        keepsPurchaseSuccess: true,
        actions: [],
      };
    case "PENDING":
    case "SENT":
    case "NONE":
      return null;
    default:
      return assertNever(status);
  }
}
