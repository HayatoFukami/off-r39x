"use client";

import { FloatingTicketButton } from "../../presentation/layout/floating-ticket-button";
import { usePathname } from "../../routing/navigation";

/** Container: reads the pathname and hands it to the Floating Ticket Button. */
export function SiteFloatingTicket() {
  return <FloatingTicketButton pathname={usePathname()} />;
}
