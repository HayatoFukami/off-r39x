import { useParams } from "react-router";
import { parseOrderRef } from "../../config/purchase-routes";
import { MockCheckoutScreen } from "../../mock/dev-ui/mock-checkout-screen";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mockCheckout.pageTitle };

// Dev-only stand-in for Stripe Checkout. The dev layout shows Not Found outside UI mock mode. The screen is keyed
// by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function MockCheckoutRoute() {
  const { orderRef } = useParams();
  const ref = parseOrderRef(orderRef ?? "");
  if (ref === null) return <NotFoundView />;
  return <MockCheckoutScreen key={orderRef} orderRef={ref} />;
}
