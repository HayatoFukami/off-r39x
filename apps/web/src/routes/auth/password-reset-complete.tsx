import { PasswordResetCompletePage } from "../../features/auth/password-reset-complete-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.auth.resetComplete.pageTitle };

// PG-AUTH-005
export default function PasswordResetCompleteRoute() {
  return <PasswordResetCompletePage />;
}
