import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseOrderRef } from "../../../../src/config/purchase-routes";
import { MockCheckoutScreen } from "../../../../src/mock/dev-ui/mock-checkout-screen";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mockCheckout.pageTitle };

// Dev-only stand-in for Stripe Checkout. The dev layout answers 404 outside UI mock mode.
export default async function Page({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  const ref = parseOrderRef(orderRef);
  if (ref === null) notFound();
  return <MockCheckoutScreen orderRef={ref} />;
}
