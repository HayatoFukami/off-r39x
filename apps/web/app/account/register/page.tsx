import type { Metadata } from "next";
import { RegisterPage } from "../../../src/features/auth/register-page";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.auth.register.pageTitle };

// PG-AUTH-001
export default function Page() {
  return <RegisterPage />;
}
