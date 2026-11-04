import { Outlet } from "react-router";
import { AuthGate } from "../../auth/auth-gate";

// Covers /mypage/* and /purchase/*: protected content renders only after the Session check.
export default function SelfLayout() {
  return (
    <AuthGate>
      <Outlet />
    </AuthGate>
  );
}
