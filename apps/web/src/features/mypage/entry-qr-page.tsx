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
import { buildEntryQrModel } from "./qr-model";
import { useRead } from "./use-read";

// PG-MYP-007 container (SPEC-050 18.7, 24.2, SEC-QR-012 / 013). Synthetic QR placeholder only. The
// purpose title appears only once the ownership decision is made, so no purpose text precedes it.

const linkClass = "text-brand underline underline-offset-4";

export function EntryQrPage({ ticketRef }: { ticketRef: Ref<"ticket"> }) {
  const loadTicket = useCallback((api: ApiPort) => api.self.getEntryTicket(ticketRef), [ticketRef]);
  const loadQr = useCallback((api: ApiPort) => api.self.getEntryQr(ticketRef), [ticketRef]);
  const ticket = useRead(loadTicket);
  const qr = useRead(loadQr);
  const model = buildEntryQrModel(ticket.read, qr.read);

  if (model.kind === "denied") {
    return (
      <AccessDeniedView
        listHref={MYPAGE_PATHS.entryTickets}
        listLabel={copy.accessDenied.entryTicketsLink}
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
            message={copy.pageState.unavailable(copy.mypage.entryTickets.detail.subject)}
            onRetry={() => {
              ticket.reload();
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
