"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { AnnouncementSummary } from "../../api-client/types";
import { DateTime } from "../../presentation/components/date-time";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { copy } from "../../presentation/copy/ja";
import { buildAnnouncementListModel } from "./announcement-model";

// PG-PUB-002 container: reads after mount through the port; the first render is always loading.
export function AnnouncementListPage() {
  const api = useApi();
  const [input, setInput] = useState<Loadable<readonly AnnouncementSummary[]>>({
    kind: "loading",
  });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.listAnnouncements()).then((result) => {
      if (token.current === current) setInput(result);
    });
  }, [api]);

  useEffect(() => {
    const ref = token;
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setInput({ kind: "loading" });
    load();
  };

  const list = buildAnnouncementListModel(input);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.announcements.heading}</h1>
      {list.kind === "loading" ? <PageState state="loading" /> : null}
      {list.kind === "empty" ? <PageState state="empty" /> : null}
      {list.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.announcements.subject)}
          onRetry={reload}
        />
      ) : null}
      {list.kind === "items" ? (
        <ul className="flex flex-col gap-4">
          {list.items.map((item) => (
            <li key={item.announcementRef} className="flex flex-col gap-1">
              <Link
                href={item.href}
                prefetch={false}
                className="font-semibold text-brand underline underline-offset-4"
              >
                {item.title}
              </Link>
              <DateTime instant={item.publishedAt} className="text-sm text-foreground/70" />
              <PlainText>{item.excerpt}</PlainText>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
