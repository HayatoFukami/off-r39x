"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { ApiPort } from "../../api-client/port";
import { PageState } from "../../presentation/components/page-state";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { buildEntryTicketListModel } from "./entry-ticket-model";
import { useRead } from "./use-read";

// PG-MYP-005 container (SPEC-050 18.5, 20.2). Each Ticket shows its own state as text.

const linkClass = "text-brand underline underline-offset-4";

export function EntryTicketListPage() {
  const load = useCallback((api: ApiPort) => api.self.listEntryTickets(), []);
  const { read, reload } = useRead(load);
  const model = buildEntryTicketListModel(read);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.mypage.entryTickets.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.mypage.entryTickets.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "empty" ? (
        <PageState state="empty" message={copy.mypage.entryTickets.empty} />
      ) : null}
      {model.kind === "items" ? (
        <ul className="flex flex-col gap-3">
          {model.items.map((row) => (
            <li
              key={row.ticketRef}
              className="flex flex-col gap-1 rounded-base border border-border p-3"
            >
              <p className="font-bold">{row.name}</p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{copy.mypage.entryTickets.stateLabel}</span>
                <StatusBadge tone={row.tone} label={row.stateLabel} />
              </p>
              <Link href={row.href} prefetch={false} className={linkClass}>
                {row.linkLabel}
              </Link>
              <Link href={row.orderHref} prefetch={false} className={linkClass}>
                {copy.mypage.entryTickets.orderLink}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
