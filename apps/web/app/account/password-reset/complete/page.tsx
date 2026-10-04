import type { Metadata } from "next";
import { PasswordResetCompletePage } from "../../../../src/features/auth/password-reset-complete-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.auth.resetComplete.pageTitle };

// PG-AUTH-005
export default function Page() {
  return <PasswordResetCompletePage />;
}
