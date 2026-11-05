"use client";

import type { MouseEvent, ReactNode } from "react";
import { HOME_HREF } from "../../config/site";
import { Link } from "../../routing/link";
import { isPlainPrimaryClick } from "./plain-primary-click";

/**
 * The site name Link to the top Page. When the top Page is already shown it scrolls to the top instead.
 * Modified or non-primary clicks are left to the browser's default link behaviour.
 */
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
    if (pathname !== HOME_HREF || !isPlainPrimaryClick(event)) return;
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
