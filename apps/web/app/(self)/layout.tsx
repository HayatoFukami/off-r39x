import type { ReactNode } from "react";
import { AuthGate } from "../../src/auth/auth-gate";

// Covers /mypage/* and /purchase/*: protected content renders only after the Session check.
export default function SelfLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
