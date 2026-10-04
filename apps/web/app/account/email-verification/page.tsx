import type { Metadata } from "next";
import { EmailVerificationPage } from "../../../src/features/auth/email-verification-page";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.auth.verify.pageTitle };

// PG-AUTH-002
export default function Page() {
  return <EmailVerificationPage />;
}
