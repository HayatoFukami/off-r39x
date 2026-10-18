import type { EntryTicketDetail, QrPresentation, ReservationDetail } from "../../api-client/types";
import { entryTicketHref, reservationHref } from "../../config/purchase-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatBusinessDate, formatJstTimeRange } from "../../presentation/format/datetime";
import { presentEntryTicket } from "../../presentation/state-mapping/entry-ticket";
import { presentReservationTicket } from "../../presentation/state-mapping/karaoke";

// View models of PG-MYP-007 / 010 (SPEC-050 18.7, 18.10, 24.2, SEC-QR-012 / 013). Pure. The QR is
// drawn only when the detail state and the QR presentation both allow it and agree on the purpose;
// the mock matrix seed is returned for drawing only, and only for a presentable QR.

export type QrPageModel =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      purpose: "ENTRY" | "KARAOKE";
      title: string;
      imageLabel: string;
      presentable: boolean;
      matrixSeed: string | null;
      primaryLabel: string;
      disabledReason: string | null;
      mockNotice: string | null;
      lines: readonly { label: string; value: string }[];
      backHref: string;
      backLabel: string;
    };

type Pair<A, B> =
  | { kind: "both"; a: A; b: B }
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" };

/** denied beats loading, loading beats a failure, and a failure is unavailable. */
function combine<A, B>(a: Loadable<A>, b: Loadable<B>): Pair<A, B> {
  if (a.kind === "not_found" || b.kind === "not_found") return { kind: "denied" };
  if (a.kind === "loading" || b.kind === "loading") return { kind: "loading" };
  if (a.kind !== "ok" || b.kind !== "ok") return { kind: "unavailable" };
  return { kind: "both", a: a.data, b: b.data };
}

type Decision = { kind: "unavailable" } | { kind: "draw"; seed: string } | { kind: "withhold" };

/** Fail closed: a presentable detail with a refusing / wrong-purpose presentation is unavailable. */
function decide(detailAllows: boolean, purpose: "ENTRY" | "KARAOKE", qr: QrPresentation): Decision {
  if (!detailAllows) return { kind: "withhold" };
  if (qr.kind === "presentable" && qr.purpose === purpose) {
    return { kind: "draw", seed: qr.mockMatrixSeed };
  }
  return { kind: "unavailable" };
}

export function buildEntryQrModel(
  ticket: Loadable<EntryTicketDetail>,
  qr: Loadable<QrPresentation>,
): QrPageModel {
  const pair = combine(ticket, qr);
  if (pair.kind !== "both") return pair;
  const presented = presentEntryTicket(pair.a.state);
  const decision = decide(presented.qrPresentable, "ENTRY", pair.b);
  if (decision.kind === "unavailable") return { kind: "unavailable" };
  const draw = decision.kind === "draw";
  return {
    kind: "ready",
    purpose: "ENTRY",
    title: copy.qr.ENTRY,
    imageLabel: copy.mypage.qr.imageLabel.ENTRY,
    presentable: draw,
    matrixSeed: draw ? decision.seed : null,
    primaryLabel: presented.label,
    disabledReason: draw ? null : presented.disabledReason,
    mockNotice: draw ? copy.mypage.qr.mockNotice : null,
    lines: [{ label: copy.mypage.qr.ticketStateLabel, value: presented.label }],
    backHref: entryTicketHref(pair.a.ticketRef),
    backLabel: copy.mypage.qr.backToTicket,
  };
}

export function buildKaraokeQrModel(
  reservation: Loadable<ReservationDetail>,
  qr: Loadable<QrPresentation>,
): QrPageModel {
  const pair = combine(reservation, qr);
  if (pair.kind !== "both") return pair;
  const detail = pair.a;
  const presented = presentReservationTicket(detail.reservationState, detail.ticketState);
  const decision = decide(presented.qrPresentable, "KARAOKE", pair.b);
  if (decision.kind === "unavailable") return { kind: "unavailable" };
  const draw = decision.kind === "draw";
  return {
    kind: "ready",
    purpose: "KARAOKE",
    title: copy.qr.KARAOKE,
    imageLabel: copy.mypage.qr.imageLabel.KARAOKE,
    presentable: draw,
    matrixSeed: draw ? decision.seed : null,
    primaryLabel: presented.primaryLabel,
    disabledReason: draw ? null : presented.disabledReason,
    mockNotice: draw ? copy.mypage.qr.mockNotice : null,
    lines: [
      { label: copy.mypage.qr.dateLabel, value: formatBusinessDate(detail.date) },
      {
        label: copy.mypage.qr.timeLabel,
        value: formatJstTimeRange(detail.usageStart, detail.usageEnd),
      },
      { label: copy.mypage.qr.reservationStateLabel, value: presented.reservationLabel },
      { label: copy.mypage.qr.ticketStateLabel, value: presented.ticketLabel },
    ],
    backHref: reservationHref(detail.reservationRef),
    backLabel: copy.mypage.qr.backToReservation,
  };
}
