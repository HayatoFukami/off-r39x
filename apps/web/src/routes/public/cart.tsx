import { CartPage } from "../../features/cart/cart-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.cart.pageTitle };

// PG-CRT-001
export default function CartRoute() {
  return <CartPage />;
}
