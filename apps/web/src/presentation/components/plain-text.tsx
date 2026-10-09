import type { ReactNode } from "react";
import { cn } from "./ui/cn";

// Public content is plain text: never HTML or Markdown, never auto-linked (SEC-WEB-017〜020).
// Line breaks are kept by CSS white-space, not by inserted markup.

export function PlainText({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("whitespace-pre-line break-words", className)}>{children}</p>;
}
