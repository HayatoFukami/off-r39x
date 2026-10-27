import { RegisterPage } from "../../features/auth/register-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.auth.register.pageTitle };

// PG-AUTH-001
export default function RegisterRoute() {
  return <RegisterPage />;
}
