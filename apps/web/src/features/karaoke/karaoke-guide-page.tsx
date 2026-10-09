"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { KaraokeSales } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { SectionHeading } from "../../presentation/components/section-heading";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { buildKaraokeGuideModel } from "./karaoke-guide-model";

const guide = copy.karaoke.guide;

// PG-KRK-001 container: reads after mount through the port; the first render is always loading.
export function KaraokeGuidePage() {
  const api = useApi();
  const [input, setInput] = useState<Loadable<KaraokeSales>>({ kind: "loading" });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.getKaraokeSales()).then((result) => {
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

  const model = buildKaraokeGuideModel(input);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{guide.heading}</h1>
      <div className="flex flex-col gap-2">
        <p>{guide.intro}</p>
        <p>{guide.usageUnit}</p>
        <p>{guide.duration}</p>
        <p>{guide.purchaseLimit}</p>
      </div>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(guide.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            <dt className="font-semibold">{guide.priceLabel}</dt>
            <dd>{model.priceText}</dd>
            <dt className="font-semibold">{guide.periodLabel}</dt>
            <dd>{model.salesPeriodText}</dd>
            <dt className="font-semibold">{guide.statusLabel}</dt>
            <dd className="flex flex-col items-start gap-1">
              <StatusBadge tone={model.saleStatus.tone} label={model.saleStatus.label} />
              <span>{model.saleStatus.description}</span>
            </dd>
          </dl>
          <section aria-labelledby="karaoke-dates" className="flex flex-col gap-3">
            <SectionHeading id="karaoke-dates">{guide.datesHeading}</SectionHeading>
            {model.dates.kind === "empty" ? (
              <PageState state="empty" message={guide.datesEmpty} />
            ) : (
              <ul className="flex flex-col gap-2">
                {model.dates.items.map((item) => (
                  <li key={item.date}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      className="text-brand underline underline-offset-4"
                    >
                      {guide.dateLink(item.text)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
