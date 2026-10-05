import { type ReactNode, useId } from "react";
import { copy } from "../copy/ja";
import { safeExternalHref } from "./safe-url";

// Only an https URL without credentials becomes a link (SEC-WEB-016); otherwise the label is plain text.
// The link text is the accessible name; "external site" is its description, so the name stays exact.

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const noteId = useId();
  const safe = safeExternalHref(href);
  if (safe === null) return <span className={className}>{children}</span>;
  return (
    <>
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={noteId}
        className={className}
      >
        {children}
      </a>
      <span id={noteId} className="sr-only">
        {copy.layout.sponsors.externalSuffix}
      </span>
    </>
  );
}
