"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useId, useRef, useState } from "react";
import {
  accountPath,
  CONTINUATION_PARAM,
  continuationPath,
  parseContinuation,
} from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { ErrorSummary } from "../../presentation/components/error-summary";
import { FormField } from "../../presentation/components/form-field";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { ContinuationNoticeView } from "./continuation-notice";
import { describeContinuation } from "./continuation-view";
import {
  type FieldError,
  type FieldName,
  fieldErrorMessage,
  normalizeEmail,
  validateRegisterForm,
} from "./form-validation";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

const linkClass = "text-brand underline underline-offset-4";

type Failure = "rejected" | "unavailable" | null;

// PG-AUTH-001. The secret is passed to the port and never stored, logged or put in a URL
// (SEC-AUTH-016 / 018); it is not trimmed.
function RegisterForm() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = parseContinuation(searchParams.get(CONTINUATION_PARAM));
  const notice = describeContinuation(intent);

  const baseId = useId();
  const ids: Record<FieldName, string> = {
    email: `${baseId}-email`,
    password: `${baseId}-password`,
    passwordConfirm: `${baseId}-confirm`,
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [failure, setFailure] = useState<Failure>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  const errorOf = (field: FieldName): string | null => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : fieldErrorMessage(found);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validateRegisterForm({ email, password, passwordConfirm });
    if (!validation.ok) {
      setErrors(validation.errors);
      setFailure(null);
      requestFocus();
      return;
    }
    setErrors([]);
    setFailure(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await auth.signUp({ email: normalizeEmail(email), password });
      if (result.kind === "confirmation_required") {
        router.push(accountPath("email-verification", intent));
        return;
      }
      if (result.kind === "signed_in") {
        router.push(continuationPath(intent ?? { key: "mypage", ref: null }));
        return;
      }
      setFailure(result.kind);
    } catch {
      setFailure("unavailable");
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  const summaryItems = errors.map((error) => ({
    fieldId: ids[error.field],
    message: fieldErrorMessage(error),
  }));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.auth.register.heading}</h1>
      <ContinuationNoticeView notice={notice} />
      {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
      {failure === "rejected" ? <ServiceFailure message={copy.auth.register.rejected} /> : null}
      {failure === "unavailable" ? (
        <ServiceFailure message={copy.auth.register.unavailable} />
      ) : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={submitting ? true : undefined}
        className="flex flex-col gap-4"
      >
        <FormField
          id={ids.email}
          label={copy.auth.field.email.label}
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errorOf("email")}
        />
        <FormField
          id={ids.password}
          label={copy.auth.field.password.label}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={copy.auth.field.password.hint}
          error={errorOf("password")}
        />
        <FormField
          id={ids.passwordConfirm}
          label={copy.auth.field.passwordConfirm.label}
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          error={errorOf("passwordConfirm")}
        />
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? copy.auth.form.submitting : copy.auth.register.submit}
          </Button>
        </div>
      </form>
      <p className="text-sm">
        <Link href={accountPath("login", intent)} prefetch={false} className={linkClass}>
          {copy.auth.register.toLogin}
        </Link>
      </p>
    </div>
  );
}

export function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
