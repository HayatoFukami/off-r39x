// SPEC-110 §25 API-AUTH-002 / API-AUTH-003 / API-AUTH-004 application service. No hono, ApiFailure, routes or
// middleware here (DEV-DEP-001): the route maps these results to HTTP.
import { normalizeDisplayName } from "@off-r39x/domain";

export type ProfileRecord = { publicRef: string; displayName: string | null; updatedAt: string };

/** Port. Structurally satisfied by the @off-r39x/db adapter; this layer does not import db. */
export interface CurrentProfileStore {
  readCurrentBusinessProfile(
    authSubject: string,
  ): Promise<
    | { status: "found"; profile: ProfileRecord }
    | { status: "not_found" }
    | { status: "unavailable" }
  >;
  updateCurrentBusinessProfile(
    authSubject: string,
    displayName: string | null,
  ): Promise<
    | { status: "updated"; profile: ProfileRecord }
    | { status: "not_found" }
    | { status: "commit_unknown" }
    | { status: "unavailable" }
  >;
  provisionCurrentBusinessProfile(
    authSubject: string,
  ): Promise<
    | { status: "created"; profile: ProfileRecord }
    | { status: "existing"; profile: ProfileRecord }
    | { status: "commit_unknown" }
    | { status: "unavailable" }
  >;
}

export type ReadCurrentProfileResult =
  | { kind: "ok"; profile: ProfileRecord }
  | { kind: "profile_missing" }
  | { kind: "database_unavailable" };

export type UpdateCurrentProfileResult =
  | { kind: "ok"; profile: ProfileRecord }
  | { kind: "invalid_display_name" }
  | { kind: "profile_missing" }
  | { kind: "database_unavailable" }
  | { kind: "commit_unknown" };

/** `subject` is the verified Auth Subject of the Principal; nothing else selects the row. */
export async function readCurrentProfile(
  store: CurrentProfileStore,
  subject: string,
): Promise<ReadCurrentProfileResult> {
  const result = await store.readCurrentBusinessProfile(subject);
  if (result.status === "found") return { kind: "ok", profile: result.profile };
  return result.status === "not_found"
    ? { kind: "profile_missing" }
    : { kind: "database_unavailable" };
}

export type ProvisionCurrentProfileResult =
  | { kind: "created" | "existing"; profile: ProfileRecord }
  | { kind: "commit_unknown" }
  | { kind: "database_unavailable" };

/** API-AUTH-003. `subject` is the verified Auth Subject; the Domain key is `auth_subject` alone. */
export async function provisionCurrentProfile(
  store: CurrentProfileStore,
  subject: string,
): Promise<ProvisionCurrentProfileResult> {
  const result = await store.provisionCurrentBusinessProfile(subject);
  if (result.status === "created" || result.status === "existing")
    return { kind: result.status, profile: result.profile };
  return result.status === "commit_unknown"
    ? { kind: "commit_unknown" }
    : { kind: "database_unavailable" };
}

export async function updateCurrentProfile(
  store: CurrentProfileStore,
  subject: string,
  request: { display_name: string | null },
): Promise<UpdateCurrentProfileResult> {
  // SPEC-030 §9.2 precondition runs before any database work.
  const normalized = normalizeDisplayName(request.display_name);
  if (!normalized.ok) return { kind: "invalid_display_name" };
  const result = await store.updateCurrentBusinessProfile(subject, normalized.value);
  if (result.status === "updated") return { kind: "ok", profile: result.profile };
  if (result.status === "not_found") return { kind: "profile_missing" };
  return result.status === "commit_unknown"
    ? { kind: "commit_unknown" }
    : { kind: "database_unavailable" };
}
