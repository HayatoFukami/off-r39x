import Link from "next/link";
import { copy } from "../../presentation/copy/ja";
import type { ReservationRow } from "./reservation-model";

// One Reservation of a Mypage list (PG-MYP-001 / 008). The Reservation state and the Karaoke Ticket
// state are two separate texts: a used Ticket is a Ticket state, never a Reservation state.

export function ReservationRowView({ row }: { row: ReservationRow }) {
  return (
    <li className="flex flex-col gap-1 rounded-base border border-border p-3">
      <p>
        <span className="font-medium">{copy.mypage.reservations.dateLabel}</span> {row.dateText}
      </p>
      <p>
        <span className="font-medium">{copy.mypage.reservations.timeLabel}</span> {row.timeText}
      </p>
      <p>
        <span className="font-medium">{copy.mypage.reservations.reservationStateLabel}</span>{" "}
        {row.reservationLabel}
      </p>
      <p>
        <span className="font-medium">{copy.mypage.reservations.ticketStateLabel}</span>{" "}
        {row.ticketLabel}
      </p>
      <Link href={row.href} prefetch={false} className="text-brand underline underline-offset-4">
        {row.linkLabel}
      </Link>
    </li>
  );
}
