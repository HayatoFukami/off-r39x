import type { Metadata } from "next";
import { PasswordResetRequestPage } from "../../../src/features/auth/password-reset-request-page";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.auth.reset.pageTitle };

// PG-AUTH-004
export default function Page() {
  return <PasswordResetRequestPage />;
}
