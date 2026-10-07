import Link from "next/link";
import { CART_HREF } from "../../config/site";
import { copy } from "../copy/ja";

/** Cart link: the quantity is text and part of the accessible name, only when it is 1 or more. */
export function CartLink({ count }: { count: number | null }) {
  const hasCount = count !== null && count >= 1;
  return (
    <Link
      prefetch={false}
      href={CART_HREF}
      aria-label={hasCount ? copy.layout.cart.labelWithCount(count) : undefined}
      className="inline-flex min-h-9 items-center gap-1 rounded-base px-2 text-sm font-medium hover:bg-muted"
    >
      <span>{copy.layout.cart.label}</span>
      {hasCount ? (
        <span className="rounded-full bg-brand px-1.5 text-xs text-brand-foreground">{count}</span>
      ) : null}
    </Link>
  );
}
