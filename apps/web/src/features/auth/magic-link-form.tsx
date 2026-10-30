"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import type { ContinuationIntent } from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { useSession } from "../../auth/use-session";
import { ErrorSummary } from "../../presentation/components/error-summary";
import { FormField } from "../../presentation/components/form-field";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { externalFailurePath, externalReturnPath } from "./auth-return";
import {
  type FieldError,
  fieldErrorMessage,
  normalizeEmail,
  validateResetRequestForm,
} from "./form-validation";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

// The Magic Link method of PG-AUTH-003 / PG-AUTH-001: send a login link, then show that it was sent. The
// link is opened outside this page (in the mail, in another Tab or on another device), so nothing here
// navigates and nothing here decides the result: the screen the link opens does (FR-CRT-012
// external-completion rule). The answer to a send is the same for every email (SEC-API-027), and the
// email is passed to the port only: never kept in a URL, a storage or a log (SEC-AUTH-018).
export function MagicLinkForm({
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
  /** Called when a send is made, so that a message of an earlier attempt is not shown beside it. */
  onAttempt?: () => void;
}) {
  const auth = useAuth();
  const { state } = useSession();
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const hintId = `${baseId}-signed-in`;
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [sent, setSent] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Once a link was sent, the button offers a resend (it stays so when a later send does not succeed).
  const [hasSent, setHasSent] = useState(false);
  const [signedInSeen, setSignedInSeen] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  // A Session that cannot be confirmed is not a Guest; an Email-unverified Session is not either.
  const signedIn = signedInSeen || (state.status === "ready" && state.session.kind !== "guest");
  const canSend = state.status === "ready" && !signedIn && !cartBlocked && !pending;

  const send = async (): Promise<void> => {
    if (pendingRef.current) return;
    const validation = validateResetRequestForm({ email });
    if (!validation.ok) {
      // Nothing is asked of the port and the Cart is not touched.
      setErrors(validation.errors);
      setSent(false);
      setUnavailable(false);
      requestFocus();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setErrors([]);
    setSent(false);
    setUnavailable(false);
    onAttempt?.();
    try {
      const result = await auth.requestMagicLink({
        email: normalizeEmail(email),
        successPath: externalReturnPath("magic-link", page, intent),
        failurePath: externalFailurePath("magic-link", page, intent),
      });
      if (result.kind === "sent") {
        setSent(true);
        setHasSent(true);
      } else if (result.kind === "unavailable") setUnavailable(true);
      else if (result.kind === "already_signed_in") setSignedInSeen(true);
      else onCartFailure(result.kind);
    } catch {
      setUnavailable(true);
    }
    pendingRef.current = false;
    setPending(false);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send();
  };

  const summaryItems = errors.map((error) => ({
    fieldId: emailId,
    message: fieldErrorMessage(error),
  }));
  const emailError = errors.find((error) => error.field === "email");

  return (
    <div className="flex flex-col gap-4">
      {unavailable ? <ServiceFailure message={copy.auth.magicLink.unavailable} /> : null}
      {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
      {signedIn ? (
        <p id={hintId} className="text-sm">
          {copy.auth.magicLink.signedIn}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={pending ? true : undefined}
        className="flex flex-col gap-4"
      >
        <FormField
          id={emailId}
          label={copy.auth.field.email.label}
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={emailError === undefined ? null : fieldErrorMessage(emailError)}
        />
        {sent ? (
          <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
            {copy.auth.magicLink.sent}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            disabled={!canSend}
            aria-describedby={signedIn ? hintId : undefined}
          >
            {pending
              ? copy.auth.form.submitting
              : hasSent
                ? copy.auth.magicLink.resend
                : copy.auth.magicLink.send}
          </Button>
        </div>
      </form>
    </div>
  );
}
