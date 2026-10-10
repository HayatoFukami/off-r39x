"use client";

import type { AuthPort } from "./port";
import { useSession } from "./use-session";

/** The one AuthPort of the SessionProvider, so every listener set of onSessionChange is shared. */
export function useAuth(): AuthPort {
  return useSession().auth;
}
