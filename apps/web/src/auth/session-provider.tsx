"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { continuationForPath } from "./continuation";
import { createAuthPort } from "./index";
import { beginLogout, endLogout } from "./logout-signal";
import type { AuthPort } from "./port";
import { SessionContext, type SessionState } from "./use-session";

export function SessionProvider({ children, port }: { children: ReactNode; port?: AuthPort }) {
  const router = useRouter();
  // Created once (lazy initializer). SSR and the first client render always start as "loading".
  const [auth] = useState<AuthPort>(() => port ?? createAuthPort());
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const refresh = (): void => {
      void auth.getSession().then((result) => {
        if (!active) return;
        setState(
          result.kind === "ok"
            ? { status: "ready", session: result.session }
            : { status: "unavailable" },
        );
      });
    };
    refresh();
    const unsubscribe = auth.onSessionChange(refresh);
    // Another tab changed the stored session.
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("storage", refresh);
    };
  }, [auth]);

  // A new route ends the Logout hand-off (the protected page's gate is gone by then).
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every path change
  useEffect(() => {
    endLogout();
  }, [pathname]);

  const signOut = useCallback(async (): Promise<void> => {
    // On a protected page the gate sees the Guest session before Home is shown: it must not
    // redirect to Login then (the final URL is Home).
    if (continuationForPath(window.location.pathname) !== null) beginLogout();
    try {
      // The local session is discarded even when the provider fails (AR-SES-009).
      await auth.signOut();
    } catch (error) {
      endLogout();
      throw error;
    }
    router.push("/");
  }, [auth, router]);

  const value = useMemo(() => ({ state, signOut, auth }), [state, signOut, auth]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
