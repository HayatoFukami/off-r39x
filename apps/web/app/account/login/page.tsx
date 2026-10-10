import type { Metadata } from "next";
import { LoginPage } from "../../../src/features/auth/login-page";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.auth.login.pageTitle };

// PG-AUTH-003
export default function Page() {
  return <LoginPage />;
}
