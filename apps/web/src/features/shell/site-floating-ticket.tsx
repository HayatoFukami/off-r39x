"use client";

import { usePathname } from "next/navigation";
import { FloatingTicketButton } from "../../presentation/layout/floating-ticket-button";

/** Container: reads the pathname and hands it to the Floating Ticket Button. */
export function SiteFloatingTicket() {
  return <FloatingTicketButton pathname={usePathname()} />;
}
