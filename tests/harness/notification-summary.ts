import type {
  NotificationSummaryStatus,
  OrderDetail,
} from "../../apps/web/src/api-client/types.ts";
import type { Scenario } from "../../apps/web/src/mock/backend/scenario.ts";
import * as notificationMapping from "../../apps/web/src/presentation/state-mapping/notification.ts";
import type { ScenarioPatch } from "./mock-backend.ts";

// Test-only helpers for the notification summary (API-ORD-003 notification_summary, SPEC-120 7.2 EML-NTF-003,
// SPEC-050 16.2 / 16.7). Never imported from production code.

/** Every summary status (a display DTO, not a Domain State: EML-NTF-003). */
export const SUMMARY_STATUSES: readonly NotificationSummaryStatus[] = [
  "NONE",
  "PENDING",
  "SENT",
  "ATTENTION_REQUIRED",
];

/** notification_summary as the port returns it: null when only the summary could not be read. */
export type NotificationSummary = OrderDetail["notificationSummary"];

/** The mock scenario values for the simulated internal confirmation-notification state. */
export const NOTIFICATION_SCENARIOS: readonly Scenario["notification"][] = [
  "sent",
  "pending",
  "failed_retryable",
  "canceled",
  "summary_unavailable",
];

/** True while a presenter that takes an internal Notification State is still exported (SPEC-050 16.2). */
export const exportsInternalStatePresenter = (): boolean =>
  "presentNotification" in notificationMapping;

/** True when the removed OrderDetail.notice property is present. */
export const hasLegacyNotice = (detail: OrderDetail): boolean => "notice" in detail;

/** `detail` with the given notification_summary. */
export const withSummary = (detail: OrderDetail, summary: NotificationSummary): OrderDetail => ({
  ...detail,
  notificationSummary: summary,
});

/** A scenario patch for the simulated internal notification state. */
export const notificationScenario = (value: Scenario["notification"]): ScenarioPatch => ({
  notification: value,
});
