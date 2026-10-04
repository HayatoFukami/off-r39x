"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { ApiPort } from "../../api-client/port";
import type { Ref } from "../../api-client/types";
import { MYPAGE_PATHS } from "../../config/mypage-routes";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { PageState } from "../../presentation/components/page-state";
import { QrPlaceholder } from "../../presentation/components/qr-placeholder";
import { copy } from "../../presentation/copy/ja";
import { buildKaraokeQrModel } from "./qr-model";
import { useRead } from "./use-read";

// PG-MYP-010 container (SPEC-050 18.10, 24.2, SEC-QR-012 / 013). Synthetic QR placeholder only; the
// Karaoke purpose is told apart from Entry by title, caption, image label and the Reservation facts.

const linkClass = "text-brand underline underline-offset-4";

export function KaraokeQrPage({ reservationRef }: { reservationRef: Ref<"reservation"> }) {
  const loadReservation = useCallback(
    (api: ApiPort) => api.self.getReservation(reservationRef),
    [reservationRef],
  );
  const loadQr = useCallback(
    (api: ApiPort) => api.self.getKaraokeQr(reservationRef),
    [reservationRef],
  );
  const reservation = useRead(loadReservation);
  const qr = useRead(loadQr);
  const model = buildKaraokeQrModel(reservation.read, qr.read);

  if (model.kind === "denied") {
    return (
      <AccessDeniedView
        listHref={MYPAGE_PATHS.reservations}
        listLabel={copy.accessDenied.reservationsLink}
      />
    );
  }

  if (model.kind !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{copy.mypage.heading}</h1>
        {model.kind === "loading" ? (
          <PageState state="loading" />
        ) : (
          <PageState
            state="unavailable"
            message={copy.pageState.unavailable(copy.mypage.reservations.detail.subject)}
            onRetry={() => {
              reservation.reload();
              qr.reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{model.title}</h1>
      <figure className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-base border border-border p-4">
        <figcaption className="text-lg font-bold">{model.title}</figcaption>
        {model.lines.map((line) => (
          <p key={line.label}>
            <span className="font-medium">{line.label}</span> {line.value}
          </p>
        ))}
        {model.presentable && model.matrixSeed !== null ? (
          <>
            <QrPlaceholder matrixSeed={model.matrixSeed} label={model.imageLabel} />
            {model.mockNotice === null ? null : (
              <p className="text-sm">{copy.mypage.qr.mockNotice}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-xl font-bold">{model.primaryLabel}</p>
            {model.disabledReason === null ? null : <p>{model.disabledReason}</p>}
          </>
        )}
      </figure>
      <p>
        <Link href={model.backHref} prefetch={false} className={linkClass}>
          {model.backLabel}
        </Link>
      </p>
    </div>
  );
}
