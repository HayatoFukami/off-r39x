import type { Metadata } from "next";
import { CartPage } from "../../src/features/cart/cart-page";
import { copy } from "../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.cart.pageTitle };

// PG-CRT-001
export default function Page() {
  return <CartPage />;
}
