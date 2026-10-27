import { EmailVerificationPage } from "../../features/auth/email-verification-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.auth.verify.pageTitle };

// PG-AUTH-002
export default function EmailVerificationRoute() {
  return <EmailVerificationPage />;
}
