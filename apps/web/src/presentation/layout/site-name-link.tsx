"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { HOME_HREF } from "../../config/site";

/** The site name Link to the top Page. When the top Page is already shown it scrolls to the top instead. */
export function SiteNameLink({
  pathname,
  className,
  children,
}: {
  pathname: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (pathname !== HOME_HREF) return;
    event.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };
  return (
    <Link prefetch={false} href={HOME_HREF} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}
