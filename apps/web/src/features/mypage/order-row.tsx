import Link from "next/link";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import type { OrderListRow } from "./order-list-model";

// One Order of a Mypage list (PG-MYP-001 / 003). The state is text; the tone only colours the badge.
// A row carries the Order's own facts and one link to its detail: never a link to a right.

export function OrderRowView({ row, showSummary }: { row: OrderListRow; showSummary: boolean }) {
  return (
    <li className="flex flex-col gap-1 rounded-base border border-border p-3">
      <div>
        <StatusBadge tone={row.tone} label={row.stateLabel} />
      </div>
      <p className="font-bold">{row.purposeLabel}</p>
      {showSummary ? (
        <p>
          <span className="font-medium">{copy.mypage.orders.itemsLabel}</span> {row.summary}
        </p>
      ) : null}
      <p>
        <span className="font-medium">{copy.purchase.createdAtLabel}</span> {row.createdAtText}
      </p>
      <p>
        <span className="font-medium">{copy.purchase.totalLabel}</span> {row.totalText}
      </p>
      <Link href={row.href} prefetch={false} className="text-brand underline underline-offset-4">
        {row.linkLabel}
      </Link>
    </li>
  );
}
