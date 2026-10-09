import type { ReactNode } from "react";
import { copy } from "../copy/ja";
import { safeExternalHref } from "./safe-url";

// Only an https URL without credentials becomes a link (SEC-WEB-016); otherwise the label is plain text.

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const safe = safeExternalHref(href);
  if (safe === null) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only">{copy.layout.sponsors.externalSuffix}</span>
    </a>
  );
}
