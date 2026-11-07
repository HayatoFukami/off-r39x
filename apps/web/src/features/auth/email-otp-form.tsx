"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { accountPath, type ContinuationIntent, continuationPath } from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { ErrorSummary } from "../../presentation/components/error-summary";
import { FormField } from "../../presentation/components/form-field";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { useRouter } from "../../routing/navigation";
import {
  type FieldError,
  fieldErrorMessage,
  normalizeEmail,
  validateOtpCodeForm,
  validateResetRequestForm,
} from "./form-validation";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

type Step = "request" | "code";
type Pending = "request" | "verify" | null;
type Failure = "invalid" | "expired" | "unavailable" | null;

const failureMessage: Record<Exclude<Failure, null>, string> = {
  invalid: copy.auth.otp.codeInvalid,
  expired: copy.auth.otp.codeExpired,
  unavailable: copy.auth.otp.unavailable,
};

// PG-AUTH-001 / 003 Email OTP: request a code, then enter it. The code lives only in this component's
// state while typing and is emptied on every submit; it never reaches a URL, a storage or a log
// (SEC-AUTH-018). The answer to the request is the same for every email (SEC-API-027).
export function EmailOtpForm({
  mode,
  intent,
  email,
  onEmailChange,
  cartBlocked,
  onCartFailure,
}: {
  mode: "login" | "register";
  intent: ContinuationIntent | null;
  email: string;
  onEmailChange: (email: string) => void;
  cartBlocked: boolean;
  onCartFailure: (kind: "cart_busy" | "cart_blocked") => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const baseId = useId();
  const emailId = `${baseId}-email`;
  const codeId = `${baseId}-code`;
  const [step, setStep] = useState<Step>("request");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [failure, setFailure] = useState<Failure>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();
  const shownStep = useRef<Step>(step);

  // The control that held the focus leaves the DOM when the step changes, so the step that appears takes
  // it, once and only on a change (not at the first display, not on a resend that stays in the step).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    document.getElementById(step === "code" ? codeId : emailId)?.focus();
  }, [step, codeId, emailId]);

  const errorOf = (field: FieldError["field"]): string | null => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : fieldErrorMessage(found);
  };

  // An alert and the sent status are never shown together.
  const showInputErrors = (found: readonly FieldError[]): void => {
    setErrors(found);
    setFailure(null);
    setSent(false);
    requestFocus();
  };

  const begin = (kind: Exclude<Pending, null>): void => {
    setErrors([]);
    setFailure(null);
    setSent(false);
    pendingRef.current = true;
    setPending(kind);
  };

  const end = (): void => {
    pendingRef.current = false;
    setPending(null);
  };

  const requestCode = async (): Promise<void> => {
    if (pendingRef.current) return;
    const validation = validateResetRequestForm({ email });
    if (!validation.ok) {
      showInputErrors(validation.errors);
      return;
    }
    begin("request");
    try {
      const result = await auth.requestEmailOtp({ email: normalizeEmail(email) });
      if (result.kind === "sent") {
        setStep("code");
        setSent(true);
      } else if (result.kind === "cart_busy" || result.kind === "cart_blocked") {
        onCartFailure(result.kind);
      } else {
        setFailure("unavailable");
      }
    } catch {
      setFailure("unavailable");
    }
    end();
  };

  const submitCode = async (): Promise<void> => {
    if (pendingRef.current) return;
    const submitted = code;
    setCode("");
    const validation = validateOtpCodeForm({ code: submitted });
    if (!validation.ok) {
      showInputErrors(validation.errors);
      return;
    }
    begin("verify");
    try {
      const result = await auth.signInWithEmailOtp({
        email: normalizeEmail(email),
        code: submitted,
      });
      if (result.kind === "signed_in") {
        // The destination reads its own current state; the intent carries no values.
        router.push(
          result.emailVerified
            ? continuationPath(intent ?? { key: "mypage", ref: null })
            : accountPath("email-verification", intent),
        );
        return;
      }
      if (result.kind === "cart_busy" || result.kind === "cart_blocked") {
        onCartFailure(result.kind);
      } else if (result.kind === "code_invalid") {
        setFailure("invalid");
      } else if (result.kind === "code_expired") {
        setFailure("expired");
      } else {
        setFailure("unavailable");
      }
    } catch {
      setFailure("unavailable");
    }
    end();
  };

  const changeEmail = (): void => {
    setStep("request");
    setCode("");
    setErrors([]);
    setFailure(null);
    setSent(false);
  };

  const onSubmit =
    (action: () => Promise<void>) =>
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void action();
    };

  const summaryItems = errors.map((error) => ({
    fieldId: error.field === "code" ? codeId : emailId,
    message: fieldErrorMessage(error),
  }));
  const busy = pending !== null;

  return (
    <div className="flex flex-col gap-4">
      {failure !== null ? <ServiceFailure message={failureMessage[failure]} /> : null}
      {sent ? (
        <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
          {copy.auth.otp.sent}
        </p>
      ) : null}
      {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
      {step === "request" ? (
        <form
          noValidate
          onSubmit={onSubmit(requestCode)}
          aria-busy={busy ? true : undefined}
          className="flex flex-col gap-4"
        >
          <FormField
            id={emailId}
            label={copy.auth.field.email.label}
            type="email"
            autoComplete="email"
            value={email}
            onChange={onEmailChange}
            error={errorOf("email")}
          />
          <div>
            <Button type="submit" disabled={busy || cartBlocked}>
              {pending === "request" ? copy.auth.form.submitting : copy.auth.otp.send}
            </Button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={onSubmit(submitCode)}
          aria-busy={busy ? true : undefined}
          className="flex flex-col gap-4"
        >
          <FormField
            id={codeId}
            label={copy.auth.field.otpCode.label}
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={setCode}
            error={errorOf("code")}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || cartBlocked}>
              {pending === "verify"
                ? copy.auth.form.submitting
                : mode === "login"
                  ? copy.auth.otp.submitLogin
                  : copy.auth.otp.submitRegister}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || cartBlocked}
              onClick={() => void requestCode()}
            >
              {copy.auth.otp.resend}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={changeEmail}>
              {copy.auth.otp.changeEmail}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
