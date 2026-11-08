import { MockMagicLinkScreen } from "../../mock/dev-ui/mock-magic-link-screen";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mockMagicLink.pageTitle };

// Dev-only stand-in for opening a login link. The dev layout shows Not Found outside UI mock mode.
export default function MockMagicLinkRoute() {
  return <MockMagicLinkScreen />;
}
