"use client";

import { usePathname } from "next/navigation";
import { useSession } from "../../auth/use-session";
import { GlobalHeader, type HeaderSession } from "../../presentation/layout/global-header";
import { useCart } from "../cart/use-cart";
import { useCartCount } from "../cart/use-cart-count";

/** Container: reads the cart count and the session, hands plain props to the Global Header. */
export function SiteHeader() {
  const cartCount = useCartCount();
  const cart = useCart();
  const { state, signOut } = useSession();
  const pathname = usePathname();

  // An unavailable session provider falls back to the guest links, never to member links.
  let session: HeaderSession = "guest";
  if (state.status === "loading") session = "loading";
  else if (state.status === "ready" && state.session.kind === "authenticated") {
    session = "authenticated";
  }

  return (
    <GlobalHeader
      cartCount={cartCount}
      session={session}
      pathname={pathname}
      onLogout={() => {
        // The Browser Cart is cleared after every Logout, even if the sign-out failed (FR-CRT-012).
        void signOut().finally(() => {
          cart.clear();
        });
      }}
    />
  );
}
