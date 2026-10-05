import Link from "next/link";
import { CTA_HREF } from "../../config/site";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../components/ui/cn";
import { copy } from "../copy/ja";
import { isFloatingTicketVisible } from "./floating-ticket-visibility";

/** A fixed Link to Entry Ticket sales that follows the scroll (SPEC-050 8.5). Hidden on the excluded Pages. */
export function FloatingTicketButton({ pathname }: { pathname: string }) {
  if (!isFloatingTicketVisible(pathname)) return null;
  return (
    <Link
      prefetch={false}
      href={CTA_HREF}
      data-testid="floating-ticket-button"
      className={cn(
        buttonVariants({ size: "default" }),
        "fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 min-h-11 shadow-lg",
      )}
    >
      {copy.layout.floatingTicket.label}
    </Link>
  );
}
