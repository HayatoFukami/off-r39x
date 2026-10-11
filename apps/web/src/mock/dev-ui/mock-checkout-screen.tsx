import Link from "next/link";
import type { Ref } from "../../api-client/types";
import { purchaseOrderHref } from "../../config/purchase-routes";
import { copy } from "../../presentation/copy/ja";

// Stand-in for Stripe Checkout (dev only, design section 6). It reads and writes nothing: no port, no
// storage. Both buttons only return to the Purchase Status, which reads the Order state (PAY-BRW-001..003).
// There is no input field: it never handles card numbers.

const linkClass =
  "inline-flex min-h-11 items-center justify-center rounded-base border border-border px-4 py-2 text-sm font-medium";

export function MockCheckoutScreen({ orderRef }: { orderRef: Ref<"order"> }) {
  const returnHref = purchaseOrderHref(orderRef);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{copy.mockCheckout.heading}</h1>
      <p>{copy.mockCheckout.note}</p>
      <p className="flex flex-wrap gap-3">
        <Link
          href={returnHref}
          prefetch={false}
          className={`${linkClass} bg-brand text-brand-foreground`}
        >
          {copy.mockCheckout.pay}
        </Link>
        <Link href={returnHref} prefetch={false} className={linkClass}>
          {copy.mockCheckout.back}
        </Link>
      </p>
    </div>
  );
}
