"use client";

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
import { Link } from "../../routing/link";
import { useRouter, useSearchParams } from "../../routing/navigation";
import { CartRecovery } from "../cart/cart-recovery";
import { useCart } from "../cart/use-cart";
import { type AuthMethod, DEFAULT_AUTH_METHOD } from "./auth-methods";
import { parseFailureNotice, parseReturned, RETURNED_PARAM } from "./auth-return";
import { ContinuationNoticeView } from "./continuation-notice";
import { describeContinuation } from "./continuation-view";
import { EmailOtpForm } from "./email-otp-form";
import {
  type FieldError,
  fieldErrorMessage,
  normalizeEmail,
  validateLoginForm,
} from "./form-validation";
import { GoogleSignIn } from "./google-sign-in";
import { NOTICE_PARAM, PASSWORD_UPDATED_NOTICE } from "./login-notice";
import { MethodSelector } from "./method-selector";
import { ServiceFailure } from "./service-failure";
import { useErrorSummaryFocus } from "./use-error-summary-focus";
import { useExternalReturn } from "./use-external-return";

const linkClass = "text-brand underline underline-offset-4";
// Named so the destination calls below read as page names, not as data.
const RESET_PAGE = "password-reset";

type Failure = "credential" | "unavailable" | "cart_busy" | "cart_blocked" | null;

// PG-AUTH-003. Credentials live only in the inputs while typing: they are passed to the port and
// never stored, logged or put in a URL (SEC-AUTH-018).
function LoginForm() {
  const auth = useAuth();
  const cart = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = parseContinuation(searchParams.get(CONTINUATION_PARAM));
  const notice = describeContinuation(intent);
  const showUpdated = searchParams.get(NOTICE_PARAM) === PASSWORD_UPDATED_NOTICE;
  // A return from Google is read here, once, by the screen the user comes back to (SPEC-050 15.0).
  const { googleFailed, clearGoogleFailed } = useExternalReturn({
    returned: parseReturned(searchParams.get(RETURNED_PARAM)),
    failed: parseFailureNotice(searchParams.get(NOTICE_PARAM)),
    intent,
  });

  const baseId = useId();
  const emailId = `${baseId}-email`;
  const passwordId = `${baseId}-password`;
  const [method, setMethod] = useState<AuthMethod>(DEFAULT_AUTH_METHOD);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [failure, setFailure] = useState<Failure>(null);
  const [submitting, setSubmitting] = useState(false);
  const cartBlocked = failure === "cart_blocked" || cart.state.kind === "blocked";
  const cartNeedsRecovery = cartBlocked || cart.state.kind === "storage_unavailable";
  const cartBusy = failure === "cart_busy" || cart.state.kind === "busy";
  const submittingRef = useRef(false);
  const { summaryRef, requestFocus } = useErrorSummaryFocus();

  const errorOf = (field: FieldError["field"]): string | null => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : fieldErrorMessage(found);
  };

  // Switching method drops the password and every message of the other method.
  const onMethodChange = (next: AuthMethod): void => {
    clearGoogleFailed();
    setMethod(next);
    setPassword("");
    setErrors([]);
    setFailure(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submittingRef.current) return;
    clearGoogleFailed();
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
      if (result.kind === "cart_busy") setFailure("cart_busy");
      else if (result.kind === "cart_blocked") setFailure("cart_blocked");
      else setFailure(result.kind === "credential_failure" ? "credential" : "unavailable");
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
      <MethodSelector
        legend={copy.auth.method.legendLogin}
        value={method}
        onChange={onMethodChange}
        disabled={submitting}
      />
      {googleFailed ? <ServiceFailure message={copy.auth.google.failed} /> : null}
      {method === "password" ? (
        <>
          {errors.length > 0 ? <ErrorSummary items={summaryItems} summaryRef={summaryRef} /> : null}
          {failure === "credential" ? (
            <ServiceFailure message={copy.auth.login.credentialFailure} />
          ) : null}
          {failure === "unavailable" ? (
            <ServiceFailure message={copy.auth.login.unavailable} />
          ) : null}
        </>
      ) : null}
      {cartBusy ? <p role="status">{copy.auth.login.cartBusy}</p> : null}
      {cartNeedsRecovery ? <CartRecovery onRecovered={() => setFailure(null)} /> : null}
      {method === "google" ? (
        <GoogleSignIn
          page="login"
          intent={intent}
          cartBlocked={cartBlocked}
          onCartFailure={setFailure}
          onAttempt={clearGoogleFailed}
        />
      ) : null}
      {method === "password" ? (
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
            <Button type="submit" disabled={submitting || cartBlocked}>
              {submitting ? copy.auth.form.submitting : copy.auth.login.submit}
            </Button>
          </div>
        </form>
      ) : null}
      {method === "email-otp" ? (
        <EmailOtpForm
          mode="login"
          intent={intent}
          email={email}
          onEmailChange={setEmail}
          cartBlocked={cartBlocked}
          onCartFailure={setFailure}
        />
      ) : null}
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
