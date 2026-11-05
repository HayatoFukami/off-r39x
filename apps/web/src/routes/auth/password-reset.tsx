import { PasswordResetRequestPage } from "../../features/auth/password-reset-request-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.auth.reset.pageTitle };

// PG-AUTH-004
export default function PasswordResetRoute() {
  return <PasswordResetRequestPage />;
}
