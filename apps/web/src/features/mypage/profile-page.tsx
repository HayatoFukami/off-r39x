"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApiPort } from "../../api-client/port";
import { useApi } from "../../api-client/provider";
import type { ProfileUpdate } from "../../api-client/types";
import { PageState } from "../../presentation/components/page-state";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { buildProfileModel, interpretProfileSave } from "./profile-model";
import { useRead } from "./use-read";

// PG-MYP-002 container (SPEC-050 18.2, 25). One editable field: the display name. The email is text.
// The server decides what a valid name is (DEV-WEB-009): the value goes to the port as typed.

const linkClass = "text-brand underline underline-offset-4";

type Phase = "idle" | "saving";

function ProfileForm({ email, initialName }: { email: string; initialName: string }) {
  const api = useApi();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [savedName, setSavedName] = useState(initialName);
  const [value, setValue] = useState(initialName);
  const [phase, setPhase] = useState<Phase>("idle");
  const [justSaved, setJustSaved] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [focusRequests, setFocusRequests] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusRequests > 0) summaryRef.current?.focus();
  }, [focusRequests]);

  const status = (() => {
    if (phase === "saving") return copy.mypage.profile.status.saving;
    if (value !== savedName) return copy.mypage.profile.status.dirty;
    return justSaved ? copy.mypage.profile.status.saved : "";
  })();

  const onChange = (next: string): void => {
    setValue(next);
    setJustSaved(false);
    setInvalid(null);
    setFailed(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (phase === "saving") return;
    setPhase("saving");
    setJustSaved(false);
    setInvalid(null);
    setFailed(null);
    const result: ProfileUpdate = await api.self
      .updateProfile({ displayName: value })
      .catch((): ProfileUpdate => ({ kind: "unavailable" }));
    setPhase("idle");
    const step = interpretProfileSave(result);
    switch (step.kind) {
      case "saved":
        setSavedName(step.displayName);
        setValue(step.displayName);
        setJustSaved(true);
        return;
      case "invalid":
        setInvalid(step.message);
        setFocusRequests((count) => count + 1);
        return;
      case "failed":
        setFailed(step.message);
        return;
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  };

  const saving = phase === "saving";

  return (
    <div className="flex flex-col gap-4">
      <p>
        <span className="font-medium">{copy.mypage.profile.emailLabel}</span> {email}
      </p>
      <p className="text-sm">{copy.mypage.profile.emailNote}</p>
      {invalid === null ? null : (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="flex flex-col gap-1 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg outline-none"
        >
          <p>{invalid}</p>
          <a
            href={`#${fieldId}`}
            className="underline underline-offset-4"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(fieldId)?.focus();
            }}
          >
            {copy.mypage.profile.displayNameLabel}
          </a>
        </div>
      )}
      {failed === null ? null : (
        <p
          role="alert"
          className="rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          {failed}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm font-medium">
            {copy.mypage.profile.displayNameLabel}
          </label>
          <input
            id={fieldId}
            type="text"
            autoComplete="name"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid === null ? undefined : true}
            aria-describedby={invalid === null ? undefined : errorId}
            className="min-h-9 w-full rounded-base border border-border bg-background px-2 py-1 text-foreground aria-[invalid=true]:border-tone-failure-fg"
          />
          {invalid === null ? null : (
            <p id={errorId} className="text-sm text-tone-failure-fg">
              {invalid}
            </p>
          )}
        </div>
        <div>
          <Button type="submit" disabled={saving} aria-busy={saving ? true : undefined}>
            {copy.mypage.profile.save}
          </Button>
        </div>
        <div role="status" className="text-sm">
          {status}
        </div>
      </form>
      <p className="text-sm">{copy.mypage.profile.passwordNote}</p>
      <p>
        <Link href="/account/password-reset" prefetch={false} className={linkClass}>
          {copy.mypage.profile.passwordReset}
        </Link>
      </p>
    </div>
  );
}

export function ProfilePage() {
  const load = useCallback((api: ApiPort) => api.self.getProfile(), []);
  const { read, reload } = useRead(load);
  const model = buildProfileModel(read);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.mypage.profile.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.mypage.profile.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <ProfileForm email={model.email} initialName={model.displayName} />
      ) : null}
    </div>
  );
}
