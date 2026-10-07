"use client";

import { useState } from "react";
import { copy } from "../copy/ja";
import type { SponsorItemModel } from "./sponsor-area-model";

function SponsorLogoItem({ item }: { item: SponsorItemModel }) {
  const [broken, setBroken] = useState(false);
  const showImage = item.imageSrc !== null && !broken;
  const content = (
    <>
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: sponsor images are operator data, not optimized assets
        <img
          src={item.imageSrc ?? ""}
          alt={item.name}
          onError={() => setBroken(true)}
          className="h-10 w-auto"
        />
      ) : (
        <span>{item.name}</span>
      )}
      {item.externalHref !== null ? (
        <>
          <span className="sr-only">{copy.layout.sponsors.externalSuffix}</span>
          <span aria-hidden="true" className="text-xs">
            ↗
          </span>
        </>
      ) : null}
    </>
  );
  return (
    <li>
      {item.externalHref !== null ? (
        <a
          href={item.externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center gap-1 rounded-base px-1 text-sm underline-offset-4 hover:underline"
        >
          {content}
        </a>
      ) : (
        <span className="inline-flex min-h-10 items-center gap-1 px-1 text-sm">{content}</span>
      )}
    </li>
  );
}

/** Rendered only for a visible model: a hidden area leaves no DOM at all (SPEC-050 8.5). */
export function SponsorLogos({ items }: { items: readonly SponsorItemModel[] }) {
  return (
    <section aria-label={copy.layout.sponsors.regionLabel}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {items.map((item) => (
          <SponsorLogoItem key={item.sponsorRef} item={item} />
        ))}
      </ul>
    </section>
  );
}
