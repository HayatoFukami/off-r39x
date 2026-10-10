"use client";

import { createContext, useContext } from "react";
import type { AuthPort, Session } from "./port";

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "unavailable" };

export type SessionContextValue = {
  state: SessionState;
  signOut(): Promise<void>;
  /** The single AuthPort of the provider. Screens reach it through useAuth(). */
  auth: AuthPort;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession must be used within SessionProvider");
  return value;
}
