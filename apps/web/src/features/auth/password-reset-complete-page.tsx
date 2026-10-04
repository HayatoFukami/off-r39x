"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../auth/use-auth";
import { ErrorSummary } from "../../presentation/components/error-summary";
import { FormField } from "../../presentation/components/form-field";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { CONTEXT_PARAM, readContext, removeContextFromUrl } from "./context-param";
import {
  type FieldError,
  type FieldName,
  fieldErrorMessage,
  validateResetCompleteForm,
} from "./form-validation";
import { LOGIN_AFTER_UPDATE_PATH } from "./login-notice";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

const linkClass = "text-brand underline underline-offset-4";
const REQUEST_AGAIN_PATH = "/account/password-reset";

function InvalidContext() {
  return (
    <>
      <ServiceFailure message={copy.auth.resetComplete.invalid} />
      <p className="text-sm">
        <Link href={REQUEST_AGAIN_PATH} prefetch={false} className={linkClass}>
          {copy.auth.resetComplete.requestAgain}
        </Link>
      </p>
    </>
  );
}

// PG-AUTH-005. The reset context is read once, removed from the URL at once and kept in memory
// only; the new secret is never stored, logged or put in a URL (SEC-AUTH-016 / 018).
function ResetCompleteForm() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [context] = useState<string | null>(() => readContext(searchParams.get(CONTEXT_PARAM)));

  const baseId = useId();
  const ids: Record<Exclude<FieldName, "email">, string> = {
    password: `${baseId}-password`,
    passwordConfirm: `${baseId}-confirm`,
  };
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [invalidated, setInvalidated] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  useEffect(() => {
    if (context !== null) removeContextFromUrl();
  }, [context]);

  const errorOf = (field: FieldName): string | null => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : fieldErrorMessage(found);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validateResetCompleteForm({ password, passwordConfirm });
    if (!validation.ok) {
      setErrors(validation.errors);
      setUnavailable(false);
      requestFocus();
      return;
    }
    setErrors([]);
    setUnavailable(false);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await auth.completePasswordReset({ context, newPassword: password });
      if (result.kind === "updated") {
        // No automatic Login: the user signs in with the new secret.
        router.replace(LOGIN_AFTER_UPDATE_PATH);
        return;
      }
      if (result.kind === "invalid_context") {
        setInvalidated(true);
        return;
      }
      setUnavailable(true);
    } catch {
      setUnavailable(true);
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  const summaryItems = errors.map((error) => ({
    fieldId: error.field === "password" ? ids.password : ids.passwordConfirm,
    message: fieldErrorMessage(error),
  }));

  if (context === null || invalidated) return <InvalidContext />;

  return (
    <>
      {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
      {unavailable ? <ServiceFailure message={copy.auth.resetComplete.unavailable} /> : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={submitting ? true : undefined}
        className="flex flex-col gap-4"
      >
        <FormField
          id={ids.password}
          label={copy.auth.field.newPassword.label}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={copy.auth.field.password.hint}
          error={errorOf("password")}
        />
        <FormField
          id={ids.passwordConfirm}
          label={copy.auth.field.newPasswordConfirm.label}
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          error={errorOf("passwordConfirm")}
        />
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? copy.auth.form.submitting : copy.auth.resetComplete.submit}
          </Button>
        </div>
      </form>
    </>
  );
}

export function PasswordResetCompletePage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.auth.resetComplete.heading}</h1>
      <Suspense fallback={null}>
        <ResetCompleteForm />
      </Suspense>
    </div>
  );
}
