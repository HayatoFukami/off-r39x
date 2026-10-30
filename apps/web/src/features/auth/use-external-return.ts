"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accountPath, type ContinuationIntent, continuationPath } from "../../auth/continuation";
import { useSession } from "../../auth/use-session";
import { useRouter } from "../../routing/navigation";
import { getBrowserCartLifecycle } from "../cart/cart-lifecycle";
import { RETURNED_PARAM } from "./auth-return";
import { NOTICE_PARAM } from "./login-notice";

// The return of an external-completion sign-in (SPEC-050 15.0, FR-CRT-012 external-completion rule). Used by
// PG-AUTH-003 and PG-AUTH-001, the only screens that receive the result. The query is read once and
// removed from the address bar at once; it carries fixed words only (SEC-AUTH-018).

/** `returned` always goes; `notice` goes only when it is the failure notice (password-updated stays). */
function removeReturnFromUrl(removeNotice: boolean): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(RETURNED_PARAM);
  if (removeNotice) url.searchParams.delete(NOTICE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useExternalReturn({
  returned,
  failed,
  intent,
}: {
  /** `parseReturned` of the `returned` query: the sign-in succeeded at the service. */
  returned: "google" | null;
  /** `parseFailureNotice` of the `notice` query: the sign-in was cancelled or failed. */
  failed: "google" | null;
  intent: ContinuationIntent | null;
}): { googleFailed: boolean; clearGoogleFailed: () => void } {
  const { state } = useSession();
  const router = useRouter();
  const [googleFailed, setGoogleFailed] = useState(failed !== null);
  const urlCleaned = useRef(false);
  const received = useRef(false);

  // Read once, then remove it so that a reload, back or forward never decides again.
  useEffect(() => {
    if (urlCleaned.current) return;
    urlCleaned.current = true;
    const hasReturned = new URL(window.location.href).searchParams.has(RETURNED_PARAM);
    if (hasReturned || failed !== null) removeReturnFromUrl(failed !== null);
  }, [failed]);

  // Only the screen shown by the return decides, and only once the Session is known.
  useEffect(() => {
    if (returned === null || received.current || state.status === "loading") return;
    received.current = true;
    if (state.status === "ready" && state.session.kind === "authenticated") {
      // The Cart is decided by the record made at the start, never by an Account (steps 6 and 9).
      getBrowserCartLifecycle()?.completeExternalAuthentication();
      // The destination reads its own current state; the intent carries no values.
      router.push(
        state.session.emailVerified
          ? continuationPath(intent ?? { key: "mypage", ref: null })
          : accountPath("email-verification", intent),
      );
      return;
    }
    // A Guest or an unconfirmable Session: nothing was received, the record stays.
    setGoogleFailed(true);
  }, [returned, state, intent, router]);

  const clearGoogleFailed = useCallback((): void => setGoogleFailed(false), []);
  return { googleFailed, clearGoogleFailed };
}
