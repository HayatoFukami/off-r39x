"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  accountPath,
  CONTINUATION_PARAM,
  continuationPath,
  parseContinuation,
} from "../../auth/continuation";
import { useAuth } from "../../auth/use-auth";
import { useSession } from "../../auth/use-session";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { CONTEXT_PARAM, readContext, removeContextFromUrl } from "./context-param";
import { ServiceFailure } from "./service-failure";

const linkClass = "text-brand underline underline-offset-4";

type Phase =
  | { kind: "waiting" }
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

// PG-AUTH-002. The verification context is read once, removed from the URL at once, kept only in
// memory for a retry, and never rendered or stored (SEC-AUTH-018).
function EmailVerification() {
  const auth = useAuth();
  const { state } = useSession();
  const searchParams = useSearchParams();
  const intent = parseContinuation(searchParams.get(CONTINUATION_PARAM));

  const [context] = useState<string | null>(() => readContext(searchParams.get(CONTEXT_PARAM)));
  const [phase, setPhase] = useState<Phase>(
    context === null ? { kind: "waiting" } : { kind: "verifying" },
  );
  const startedRef = useRef(false);

  const verify = useCallback(async (): Promise<void> => {
    setPhase({ kind: "verifying" });
    try {
      const result = await auth.verifyEmail({ context });
      setPhase({
        kind:
          result.kind === "verified"
            ? "verified"
            : result.kind === "invalid_or_expired"
              ? "invalid"
              : "unavailable",
      });
    } catch {
      setPhase({ kind: "unavailable" });
    }
  }, [auth, context]);

  useEffect(() => {
    if (startedRef.current || context === null) return;
    startedRef.current = true;
    removeContextFromUrl();
    void verify();
  }, [verify, context]);

  const loginLink = (
    <Link href={accountPath("login", intent)} prefetch={false} className={linkClass}>
      {copy.auth.verify.toLogin}
    </Link>
  );
  const authenticated = state.status === "ready" && state.session.kind === "authenticated";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.auth.verify.heading}</h1>

      {phase.kind === "waiting" ? (
        <>
          <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
            {copy.auth.verify.required}
          </p>
          <p className="text-sm">{loginLink}</p>
        </>
      ) : null}

      {phase.kind === "verifying" ? (
        <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
          {copy.auth.verify.verifying}
        </p>
      ) : null}

      {phase.kind === "verified" ? (
        <>
          <p role="status" className="rounded-base border border-border bg-muted p-3 text-sm">
            {copy.auth.verify.verified}
          </p>
          <p className="text-sm">
            {authenticated ? (
              <Link
                href={continuationPath(intent ?? { key: "mypage", ref: null })}
                prefetch={false}
                className={linkClass}
              >
                {copy.auth.verify.continue}
              </Link>
            ) : (
              loginLink
            )}
          </p>
        </>
      ) : null}

      {phase.kind === "invalid" ? (
        <>
          <ServiceFailure message={copy.auth.verify.invalid} />
          <p className="text-sm">{loginLink}</p>
        </>
      ) : null}

      {phase.kind === "unavailable" ? (
        <>
          <ServiceFailure message={copy.auth.verify.unavailable} />
          <div>
            <Button type="button" variant="outline" onClick={() => void verify()}>
              {copy.auth.verify.retry}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function EmailVerificationPage() {
  return (
    <Suspense fallback={null}>
      <EmailVerification />
    </Suspense>
  );
}
