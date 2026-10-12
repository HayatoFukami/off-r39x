"use client";

import { useCallback } from "react";
import type { ApiPort } from "../../api-client/port";
import { PageState } from "../../presentation/components/page-state";
import { copy } from "../../presentation/copy/ja";
import { buildReservationListModel } from "./reservation-model";
import { ReservationRowView } from "./reservation-row";
import { useRead } from "./use-read";

// PG-MYP-008 container (SPEC-050 18.8, 20.3). Reservations in time order; both states as text.

export function ReservationListPage() {
  const load = useCallback((api: ApiPort) => api.self.listReservations(), []);
  const { read, reload } = useRead(load);
  const model = buildReservationListModel(read);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.mypage.reservations.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.mypage.reservations.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "empty" ? (
        <PageState state="empty" message={copy.mypage.reservations.empty} />
      ) : null}
      {model.kind === "items" ? (
        <ul className="flex flex-col gap-3">
          {model.items.map((row) => (
            <ReservationRowView key={row.reservationRef} row={row} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
