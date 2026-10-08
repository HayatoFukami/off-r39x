"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createAuthPort } from "./index";
import type { AuthPort } from "./port";
import { sameSessionState } from "./session-equality";
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
        const next: SessionState =
          result.kind === "ok"
            ? { status: "ready", session: result.session }
            : { status: "unavailable" };
        setState((prev) => (sameSessionState(prev, next) ? prev : next));
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

  const signOut = useCallback(async (): Promise<void> => {
    // The local session is discarded even when the provider fails (AR-SES-009).
    await auth.signOut();
    router.push("/");
  }, [auth, router]);

  const value = useMemo(() => ({ state, signOut }), [state, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
