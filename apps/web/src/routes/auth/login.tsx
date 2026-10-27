import { LoginPage } from "../../features/auth/login-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.auth.login.pageTitle };

// PG-AUTH-003
export default function LoginRoute() {
  return <LoginPage />;
}
