import { MockGoogleScreen } from "../../mock/dev-ui/mock-google-screen";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mockGoogle.pageTitle };

// Dev-only stand-in for the Google sign-in screen. The dev layout shows Not Found outside UI mock mode.
export default function MockGoogleRoute() {
  return <MockGoogleScreen />;
}
