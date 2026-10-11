"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useId, useRef, useState } from "react";
import { accountPath, CONTINUATION_PARAM, parseContinuation } from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { ErrorSummary } from "../../presentation/components/error-summary";
import { FormField } from "../../presentation/components/form-field";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import {
  type FieldError,
  fieldErrorMessage,
  normalizeEmail,
  validateResetRequestForm,
} from "./form-validation";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";

const linkClass = "text-brand underline underline-offset-4";

type Outcome = "accepted" | "unavailable" | null;

// PG-AUTH-004. Every email gets the same acceptance (SEC-API-027); the Session never changes.
function ResetRequestForm() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const intent = parseContinuation(searchParams.get(CONTINUATION_PARAM));

  const emailId = `${useId()}-email`;
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  const emailError = errors.find((error) => error.field === "email");

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validateResetRequestForm({ email });
    if (!validation.ok) {
      setErrors(validation.errors);
      setOutcome(null);
      requestFocus();
      return;
    }
    setErrors([]);
    setOutcome(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await auth.requestPasswordReset({ email: normalizeEmail(email) });
      setOutcome(result.kind);
    } catch {
      setOutcome("unavailable");
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.auth.reset.heading}</h1>
      {errors.length > 0 ? (
        <ErrorSummary
          items={errors.map((error) => ({ fieldId: emailId, message: fieldErrorMessage(error) }))}
          summaryRef={summaryRef}
        />
      ) : null}
      {outcome === "accepted" ? (
        <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
          {copy.auth.reset.accepted}
        </p>
      ) : null}
      {outcome === "unavailable" ? <ServiceFailure message={copy.auth.reset.unavailable} /> : null}
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
          error={emailError === undefined ? null : fieldErrorMessage(emailError)}
        />
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? copy.auth.form.submitting : copy.auth.reset.submit}
          </Button>
        </div>
      </form>
      <p className="text-sm">
        <Link href={accountPath("login", intent)} prefetch={false} className={linkClass}>
          {copy.auth.reset.backToLogin}
        </Link>
      </p>
    </div>
  );
}

export function PasswordResetRequestPage() {
  return (
    <Suspense fallback={null}>
      <ResetRequestForm />
    </Suspense>
  );
}
