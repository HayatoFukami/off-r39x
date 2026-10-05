"use client";

import Link from "next/link";
import { useCallback, useId } from "react";
import type { ApiPort } from "../../api-client/port";
import type { Ref } from "../../api-client/types";
import { MYPAGE_PATHS } from "../../config/mypage-routes";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { PageState } from "../../presentation/components/page-state";
import { SectionHeading } from "../../presentation/components/section-heading";
import { StatusBadge } from "../../presentation/components/status-badge";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { ReceiptLink } from "./receipt-link";
import { buildReservationDetailModel } from "./reservation-model";
import { useRead } from "./use-read";

// PG-MYP-009 container (SPEC-050 18.9, 20.3, 23, 26.2). The Reservation is read, never created: the QR
// is a link only for CONFIRMED + VALID; otherwise a disabled action whose reason is on the page as text.

const linkClass = "text-brand underline underline-offset-4";

export function ReservationDetailPage({ reservationRef }: { reservationRef: Ref<"reservation"> }) {
  const load = useCallback(
    (api: ApiPort) => api.self.getReservation(reservationRef),
    [reservationRef],
  );
  const { read, reload } = useRead(load);
  const model = buildReservationDetailModel(read);
  const baseId = useId();
  const infoId = `${baseId}-info`;
  const reasonId = `${baseId}-reason`;
  const detail = copy.mypage.reservations.detail;

  // Ownership failure: nothing of the Reservation was rendered before this view (SPEC-050 26.2).
  if (model.kind === "denied") {
    return (
      <AccessDeniedView
        listHref={MYPAGE_PATHS.reservations}
        listLabel={copy.accessDenied.reservationsLink}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{detail.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(detail.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <>
          <section aria-labelledby={infoId} className="flex flex-col gap-3">
            <SectionHeading id={infoId}>{detail.infoHeading}</SectionHeading>
            <div>
              <StatusBadge tone={model.tone} label={model.primaryLabel} />
            </div>
            <p>
              <span className="font-medium">{copy.mypage.reservations.dateLabel}</span>{" "}
              {model.dateText}
            </p>
            <p>
              <span className="font-medium">{detail.startLabel}</span> {model.startText}
            </p>
            <p>
              <span className="font-medium">{detail.endLabel}</span> {model.endText}
            </p>
            <p>
              <span className="font-medium">{copy.mypage.reservations.reservationStateLabel}</span>{" "}
              {model.reservationLabel}
            </p>
            <p>
              <span className="font-medium">{copy.mypage.reservations.ticketStateLabel}</span>{" "}
              {model.ticketLabel}
            </p>
            {model.qr.kind === "link" ? (
              <p>
                <Link href={model.qr.href} prefetch={false} className={linkClass}>
                  {model.qr.label}
                </Link>
              </p>
            ) : (
              <div className="flex flex-col items-start gap-1">
                <Button type="button" variant="outline" disabled aria-describedby={reasonId}>
                  {model.qr.label}
                </Button>
                <p id={reasonId} className="text-sm">
                  {model.qr.reason}
                </p>
              </div>
            )}
            <p>
              <Link href={model.orderHref} prefetch={false} className={linkClass}>
                {copy.mypage.reservations.orderLink}
              </Link>
            </p>
            <ReceiptLink href={model.receiptHref} />
          </section>
          <p>
            <Link href={MYPAGE_PATHS.reservations} prefetch={false} className={linkClass}>
              {detail.backToList}
            </Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
