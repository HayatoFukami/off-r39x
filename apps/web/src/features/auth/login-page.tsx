"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useId, useRef, useState } from "react";
import {
  accountPath,
  CONTINUATION_PARAM,
  continuationCancelPath,
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
  fieldErrorMessage,
  normalizeEmail,
  validateLoginForm,
} from "./form-validation";
import { NOTICE_PARAM, PASSWORD_UPDATED_NOTICE } from "./login-notice";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

const linkClass = "text-brand underline underline-offset-4";
// Named so the destination calls below read as page names, not as data.
const RESET_PAGE = "password-reset";

type Failure = "credential" | "unavailable" | null;

// PG-AUTH-003. Credentials live only in the inputs while typing: they are passed to the port and
// never stored, logged or put in a URL (SEC-AUTH-018).
function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = parseContinuation(searchParams.get(CONTINUATION_PARAM));
  const notice = describeContinuation(intent);
  const showUpdated = searchParams.get(NOTICE_PARAM) === PASSWORD_UPDATED_NOTICE;

  const baseId = useId();
  const emailId = `${baseId}-email`;
  const passwordId = `${baseId}-password`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [failure, setFailure] = useState<Failure>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  const errorOf = (field: FieldError["field"]): string | null => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : fieldErrorMessage(found);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validateLoginForm({ email, password });
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
      const result = await auth.signIn({ email: normalizeEmail(email), password });
      if (result.kind === "signed_in") {
        // The destination reads its own current state; the intent carries no values.
        router.push(
          result.emailVerified
            ? continuationPath(intent ?? { key: "mypage", ref: null })
            : accountPath("email-verification", intent),
        );
        return;
      }
      setFailure(result.kind === "credential_failure" ? "credential" : "unavailable");
    } catch {
      setFailure("unavailable");
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  const summaryItems = errors.map((error) => ({
    fieldId: error.field === "email" ? emailId : passwordId,
    message: fieldErrorMessage(error),
  }));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.auth.login.heading}</h1>
      <ContinuationNoticeView notice={notice} />
      {showUpdated ? (
        <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
          {copy.auth.login.passwordUpdated}
        </p>
      ) : null}
      {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
      {failure === "credential" ? (
        <ServiceFailure message={copy.auth.login.credentialFailure} />
      ) : null}
      {failure === "unavailable" ? <ServiceFailure message={copy.auth.login.unavailable} /> : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={submitting ? true : undefined}
        className="flex flex-col gap-4"
      >
        <FormField
          id={emailId}
          label={copy.auth.field.email.label}
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errorOf("email")}
        />
        <FormField
          id={passwordId}
          label={copy.auth.field.password.label}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errorOf("password")}
        />
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? copy.auth.form.submitting : copy.auth.login.submit}
          </Button>
        </div>
      </form>
      <ul className="flex flex-col gap-2 text-sm">
        <li>
          <Link href={accountPath(RESET_PAGE, intent)} prefetch={false} className={linkClass}>
            {copy.auth.login.toPasswordReset}
          </Link>
        </li>
        <li>
          <Link href={accountPath("register", intent)} prefetch={false} className={linkClass}>
            {copy.auth.login.toRegister}
          </Link>
        </li>
        <li>
          <Link href={continuationCancelPath(intent)} prefetch={false} className={linkClass}>
            {copy.auth.login.cancel}
          </Link>
        </li>
      </ul>
    </div>
  );
}

export function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
