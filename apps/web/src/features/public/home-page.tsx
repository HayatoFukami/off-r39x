"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { AnnouncementSummary, EventInfo, FaqItem } from "../../api-client/types";
import { DateTime } from "../../presentation/components/date-time";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { SectionHeading } from "../../presentation/components/section-heading";
import { copy } from "../../presentation/copy/ja";
import { buildHomeModel, HOME_NEWS_LIMIT, type HomeSection } from "./home-model";

type Section<K extends HomeSection["key"]> = Extract<HomeSection, { key: K }>;

const LOADING = { kind: "loading" } as const;
const linkClass = "text-brand underline underline-offset-4";
const sectionClass = "mt-8 flex flex-col gap-3";

// PG-PUB-001 container: reads after mount through the port; the first render is always loading.
export function HomePage() {
  const api = useApi();
  const [event, setEvent] = useState<Loadable<EventInfo>>(LOADING);
  const [announcements, setAnnouncements] =
    useState<Loadable<readonly AnnouncementSummary[]>>(LOADING);
  const [faqs, setFaqs] = useState<Loadable<readonly FaqItem[]>>(LOADING);
  const tokens = useRef({ event: 0, announcements: 0, faqs: 0 });

  const loadEvent = useCallback(() => {
    tokens.current.event += 1;
    const token = tokens.current.event;
    void settleRead(api.public.getEvent()).then((result) => {
      if (tokens.current.event === token) setEvent(result);
    });
  }, [api]);
  const loadAnnouncements = useCallback(() => {
    tokens.current.announcements += 1;
    const token = tokens.current.announcements;
    void settleRead(api.public.listAnnouncements({ limit: HOME_NEWS_LIMIT })).then((result) => {
      if (tokens.current.announcements === token) setAnnouncements(result);
    });
  }, [api]);
  const loadFaqs = useCallback(() => {
    tokens.current.faqs += 1;
    const token = tokens.current.faqs;
    void settleRead(api.public.listFaqs()).then((result) => {
      if (tokens.current.faqs === token) setFaqs(result);
    });
  }, [api]);

  useEffect(() => {
    const current = tokens.current;
    loadEvent();
    loadAnnouncements();
    loadFaqs();
    return () => {
      // Late results of an unmounted page are ignored.
      current.event += 1;
      current.announcements += 1;
      current.faqs += 1;
    };
  }, [loadEvent, loadAnnouncements, loadFaqs]);

  const reloadAll = (): void => {
    setEvent(LOADING);
    setAnnouncements(LOADING);
    setFaqs(LOADING);
    loadEvent();
    loadAnnouncements();
    loadFaqs();
  };
  const reloadNews = (): void => {
    setAnnouncements(LOADING);
    loadAnnouncements();
  };
  const reloadFaqs = (): void => {
    setFaqs(LOADING);
    loadFaqs();
  };

  const model = buildHomeModel({ event, announcements, faqs });

  if (model.kind === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{copy.home.fallbackHeading}</h1>
        <PageState state="loading" />
      </div>
    );
  }
  if (model.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{copy.home.fallbackHeading}</h1>
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.home.subject)}
          onRetry={reloadAll}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {model.sections.map((section) => {
        switch (section.key) {
          case "hero":
            return <Hero key={section.key} section={section} />;
          case "news":
            return <News key={section.key} section={section} onRetry={reloadNews} />;
          case "salesShortcut":
            return <SalesShortcut key={section.key} section={section} />;
          case "overview":
            return <Overview key={section.key} section={section} />;
          case "schedule":
            return <Schedule key={section.key} section={section} />;
          case "venue":
            return <Venue key={section.key} section={section} />;
          case "notices":
            return <Notices key={section.key} section={section} />;
          case "faq":
            return <Faq key={section.key} section={section} onRetry={reloadFaqs} />;
          default: {
            const unreachable: never = section;
            return unreachable;
          }
        }
      })}
    </div>
  );
}

function Hero({ section }: { section: Section<"hero"> }) {
  return (
    <header className="flex flex-col gap-3 rounded-base bg-hero-gradient px-4 py-10 text-brand-foreground">
      <h1 className="text-3xl font-bold">{section.eventName}</h1>
      {section.periodText === null ? null : <p>{section.periodText}</p>}
      {section.venueName === null ? null : <p>{section.venueName}</p>}
      <p>
        <Link
          href={section.ctaHref}
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-base bg-background px-5 py-2 font-semibold text-brand"
        >
          {copy.layout.cta.buyTickets}
        </Link>
      </p>
    </header>
  );
}

function News({ section, onRetry }: { section: Section<"news">; onRetry: () => void }) {
  const { list } = section;
  return (
    <section aria-labelledby="home-news" className={sectionClass}>
      <SectionHeading id="home-news">{copy.home.sections.news}</SectionHeading>
      {list.kind === "loading" ? <PageState state="loading" /> : null}
      {list.kind === "empty" ? <PageState state="empty" /> : null}
      {list.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.home.sections.news)}
          onRetry={onRetry}
        />
      ) : null}
      {list.kind === "items" ? (
        <ul className="flex flex-col gap-3">
          {list.items.map((item) => (
            <li key={item.announcementRef} className="flex flex-col gap-1">
              <Link href={item.href} prefetch={false} className={linkClass}>
                {item.title}
              </Link>
              <DateTime instant={item.publishedAt} className="text-sm text-foreground/70" />
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <Link href={section.viewAllHref} prefetch={false} className={linkClass}>
          {copy.home.news.viewAll}
        </Link>
      </p>
    </section>
  );
}

const SHORTCUT_LABEL = {
  entry: copy.home.shortcut.entry,
  karaoke: copy.home.shortcut.karaoke,
  goods: copy.home.shortcut.goods,
} as const;

function SalesShortcut({ section }: { section: Section<"salesShortcut"> }) {
  return (
    <section aria-labelledby="home-shortcut" className={sectionClass}>
      <SectionHeading id="home-shortcut">{copy.home.sections.salesShortcut}</SectionHeading>
      <div className="flex flex-wrap gap-3">
        {section.links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            prefetch={false}
            className="inline-flex min-h-11 items-center rounded-base border border-border px-4 py-2 text-brand"
          >
            {SHORTCUT_LABEL[link.key]}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Overview({ section }: { section: Section<"overview"> }) {
  return (
    <section aria-labelledby="home-overview" className={sectionClass}>
      <SectionHeading id="home-overview">{copy.home.sections.overview}</SectionHeading>
      <p className="font-semibold">{section.eventName}</p>
      <PlainText>{section.overview}</PlainText>
    </section>
  );
}

function Schedule({ section }: { section: Section<"schedule"> }) {
  return (
    <section aria-labelledby="home-schedule" className={sectionClass}>
      <SectionHeading id="home-schedule">{copy.home.sections.schedule}</SectionHeading>
      <PlainText>{section.periodText}</PlainText>
    </section>
  );
}

function Venue({ section }: { section: Section<"venue"> }) {
  return (
    <section aria-labelledby="home-venue" className={sectionClass}>
      <SectionHeading id="home-venue">{copy.home.sections.venue}</SectionHeading>
      {section.venueName === null ? null : <p className="font-semibold">{section.venueName}</p>}
      {section.venueGuide === null ? null : <PlainText>{section.venueGuide}</PlainText>}
      {section.accessInfo === null ? null : <PlainText>{section.accessInfo}</PlainText>}
    </section>
  );
}

function Notices({ section }: { section: Section<"notices"> }) {
  return (
    <section aria-labelledby="home-notices" className={sectionClass}>
      <SectionHeading id="home-notices">{copy.home.sections.notices}</SectionHeading>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {section.items.map((item, index) => (
          // Notices have no id: the original order is their identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list kept in its original order
          <li key={index}>
            <PlainText>{item}</PlainText>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faq({ section, onRetry }: { section: Section<"faq">; onRetry: () => void }) {
  const { list } = section;
  return (
    <section aria-labelledby="home-faq" className={sectionClass}>
      <SectionHeading id="home-faq">{copy.home.sections.faq}</SectionHeading>
      {list.kind === "loading" ? <PageState state="loading" /> : null}
      {list.kind === "empty" ? <PageState state="empty" /> : null}
      {list.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.home.sections.faq)}
          onRetry={onRetry}
        />
      ) : null}
      {list.kind === "items"
        ? list.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1">
              <SectionHeading id={`home-faq-${item.id}`} level={3}>
                {item.question}
              </SectionHeading>
              <PlainText>{item.answer}</PlainText>
            </div>
          ))
        : null}
    </section>
  );
}
