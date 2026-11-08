import { normalizeDisplayName } from "../../api-client/display-name-policy";
import type { Profile, ProfileUpdate } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";

// View model of PG-MYP-002 (SPEC-050 18.2). Pure. A failed read is unavailable: there is no fallback
// to another Profile and no Access Denied (the route takes no reference).

export type ProfileModel =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; email: string; displayName: string | null };

export function buildProfileModel(input: Loadable<Profile>): ProfileModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "ok":
      return { kind: "ready", email: input.data.email, displayName: input.data.displayName };
    case "not_found":
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

/**
 * UX pre-check before the port is called (SPEC-050 18.2, SPEC-030 9.2). The API stays the authority
 * (DEV-WEB-009): a blank value is fine (it clears the name), and the input is never trimmed here.
 */
export function checkDisplayNameInput(
  value: string,
): { kind: "ok" } | { kind: "invalid"; message: string } {
  const result = normalizeDisplayName(value);
  if (result.ok) return { kind: "ok" };
  switch (result.reason) {
    case "too_long":
      return { kind: "invalid", message: copy.mypage.profile.error.tooLong };
    case "control_character":
      return { kind: "invalid", message: copy.mypage.profile.error.controlCharacter };
    default: {
      const unreachable: never = result.reason;
      return unreachable;
    }
  }
}

/** After a save: keep what the user typed meanwhile; adopt the saved name (unset = empty) only if the input is unchanged. */
export function resolveInputAfterSave(input: {
  current: string;
  submitted: string;
  saved: string | null;
}): string {
  return input.current === input.submitted ? (input.saved ?? "") : input.current;
}

export type ProfileSaveStep =
  | { kind: "saved"; displayName: string | null }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string };

/** The server decides what is valid (DEV-WEB-009): the UI only turns the answer into a step. */
export function interpretProfileSave(result: ProfileUpdate): ProfileSaveStep {
  switch (result.kind) {
    case "saved":
      return { kind: "saved", displayName: result.profile.displayName };
    case "validation_failed":
      return { kind: "invalid", message: copy.mypage.profile.error.invalid };
    case "unavailable":
      return { kind: "failed", message: copy.mypage.profile.error.unavailable };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}
