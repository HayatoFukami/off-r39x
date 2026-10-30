"use client";

import { useId, useRef, useState } from "react";
import type { ContinuationIntent } from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { useSession } from "../../auth/use-session";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { isSafeCheckoutUrl } from "../purchase/cart-purchase-flow";
import { externalFailurePath, externalReturnPath } from "./auth-return";
import { ServiceFailure } from "./service-failure";

// The Google method of PG-AUTH-003 / PG-AUTH-001. It is a button, not a link: the hand-off is a full-page
// navigation to the URL the port returns (SEC-WEB-013). The sign-in completes outside the page, so the
// result is decided by the screen the user returns to, not here (FR-CRT-012 external-completion rule).
export function GoogleSignIn({
  page,
  intent,
  cartBlocked,
  onCartFailure,
  onAttempt,
}: {
  page: "login" | "register";
  intent: ContinuationIntent | null;
  cartBlocked: boolean;
  onCartFailure: (kind: "cart_busy" | "cart_blocked") => void;
  /** Called when a start is made, so that a message of an earlier attempt is not shown beside it. */
  onAttempt?: () => void;
}) {
  const auth = useAuth();
  const { state } = useSession();
  const hintId = useId();
  const [starting, setStarting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [signedInSeen, setSignedInSeen] = useState(false);
  const startingRef = useRef(false);

  // A Session that cannot be confirmed is not a Guest; an Email-unverified Session is not either.
  const signedIn = signedInSeen || (state.status === "ready" && state.session.kind !== "guest");
  const canStart = state.status === "ready" && !signedIn && !cartBlocked && !starting;
  // The reason of a disabled start is text around it (SPEC-050 25). `loading` is brief, so it gives none.
  const sessionUnavailable = state.status === "unavailable";
  const hint = sessionUnavailable
    ? copy.auth.google.sessionUnavailable
    : signedIn
      ? copy.auth.google.signedIn
      : null;

  const start = async (): Promise<void> => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setUnavailable(false);
    onAttempt?.();
    try {
      const result = await auth.startGoogleSignIn({
        successPath: externalReturnPath("google", page, intent),
        failurePath: externalFailurePath("google", page, intent),
      });
      // The URL is checked again at the last moment (SEC-WEB-013); one that does not pass is never followed.
      if (result.kind === "redirect" && isSafeCheckoutUrl(result.url)) {
        // A full-page navigation: the button stays unavailable until the page is left.
        window.location.assign(result.url);
        return;
      }
      if (result.kind === "redirect" || result.kind === "unavailable") setUnavailable(true);
      else if (result.kind === "already_signed_in") setSignedInSeen(true);
      else onCartFailure(result.kind);
    } catch {
      setUnavailable(true);
    }
    startingRef.current = false;
    setStarting(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {unavailable ? <ServiceFailure message={copy.auth.google.unavailable} /> : null}
      {hint !== null ? (
        <p id={hintId} className="text-sm">
          {hint}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={!canStart}
          aria-describedby={hint !== null ? hintId : undefined}
          onClick={() => void start()}
        >
          {starting
            ? copy.auth.form.submitting
            : page === "login"
              ? copy.auth.google.startLogin
              : copy.auth.google.startRegister}
        </Button>
      </div>
    </div>
  );
}
