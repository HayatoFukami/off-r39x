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
import { buildEntryTicketDetailModel } from "./entry-ticket-model";
import { useRead } from "./use-read";

// PG-MYP-006 container (SPEC-050 18.6, 20.2, 25, 26.2). The Ticket is read, never issued: the QR is a
// link only for a VALID Ticket; otherwise a disabled action whose reason is on the page as text.

const linkClass = "text-brand underline underline-offset-4";

export function EntryTicketDetailPage({ ticketRef }: { ticketRef: Ref<"ticket"> }) {
  const load = useCallback((api: ApiPort) => api.self.getEntryTicket(ticketRef), [ticketRef]);
  const { read, reload } = useRead(load);
  const model = buildEntryTicketDetailModel(read);
  const baseId = useId();
  const infoId = `${baseId}-info`;
  const reasonId = `${baseId}-reason`;
  const detail = copy.mypage.entryTickets.detail;

  // Ownership failure: nothing of the Ticket was rendered before this view (SPEC-050 26.2).
  if (model.kind === "denied") {
    return (
      <AccessDeniedView
        listHref={MYPAGE_PATHS.entryTickets}
        listLabel={copy.accessDenied.entryTicketsLink}
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
            <p>
              <span className="font-medium">{detail.kindLabel}</span> {model.name}
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{detail.stateLabel}</span>
              <StatusBadge tone={model.tone} label={model.stateLabel} />
            </p>
            <p>{model.description}</p>
            <p>
              <span className="font-medium">{detail.issuedAtLabel}</span> {model.issuedAtText}
            </p>
            <p>
              <span className="font-medium">{detail.usableLabel}</span> {model.usableText}
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
                {copy.mypage.entryTickets.orderLink}
              </Link>
            </p>
          </section>
          <p>
            <Link href={MYPAGE_PATHS.entryTickets} prefetch={false} className={linkClass}>
              {detail.backToList}
            </Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
