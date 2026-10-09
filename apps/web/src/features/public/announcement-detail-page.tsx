"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { Announcement, Ref } from "../../api-client/types";
import { DateTime } from "../../presentation/components/date-time";
import type { Loadable } from "../../presentation/components/list-state";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { copy } from "../../presentation/copy/ja";
import { buildAnnouncementDetailModel } from "./announcement-model";

const linkClass = "text-brand underline underline-offset-4";

// PG-PUB-003 container: reads after mount through the port; the first render is always loading.
export function AnnouncementDetailPage({
  announcementRef,
}: {
  announcementRef: Ref<"announcement">;
}) {
  const api = useApi();
  const [input, setInput] = useState<Loadable<Announcement>>({ kind: "loading" });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.getAnnouncement(announcementRef)).then((result) => {
      if (token.current === current) setInput(result);
    });
  }, [api, announcementRef]);

  useEffect(() => {
    const ref = token;
    setInput({ kind: "loading" });
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setInput({ kind: "loading" });
    load();
  };

  const model = buildAnnouncementDetailModel(input);

  // Not Found shows the shared view only: nothing of the announcement is exposed (SPEC-050 11.3, 19.1).
  if (model.kind === "not_found") return <NotFoundView />;

  if (model.kind !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{copy.announcements.heading}</h1>
        {model.kind === "loading" ? (
          <PageState state="loading" />
        ) : (
          <PageState
            state="unavailable"
            message={copy.pageState.unavailable(copy.announcements.subject)}
            onRetry={reload}
          />
        )}
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{model.title}</h1>
      <DateTime instant={model.publishedAt} className="text-sm text-foreground/70" />
      <PlainText>{model.body}</PlainText>
      <p className="flex flex-wrap gap-4">
        <Link href={model.listHref} prefetch={false} className={linkClass}>
          {copy.announcements.backToList}
        </Link>
        <Link href={model.homeHref} prefetch={false} className={linkClass}>
          {copy.announcements.backHome}
        </Link>
      </p>
    </article>
  );
}
