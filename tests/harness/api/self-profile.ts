// Test double and rig for API-AUTH-002 / API-AUTH-004 (PR-L2-1a) and API-AUTH-003 (PR-L2-1b). Test only: the recording
// CurrentProfileStore, its DI fault injection (SPEC-170 TST-FLT: FP.DB.*) and a createApp rig built the
// same way as tests/api/foundation-email-verified-order.test.ts. Synthetic data only; nothing here is
// reachable from production code.
import { createApp } from "../../../apps/api/src/api/app.ts";
import type { CurrentProfileStore } from "../../../apps/api/src/api/services/index.ts";
import {
  AuthFailure,
  type PrincipalRecord,
  type TokenVerifier,
} from "../../../packages/auth/src/index.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../rate-limit/api.ts";

export const WEB = "https://web.example.test";
export const API = "https://api.example.test";
export const GOOD = "e30.e30.c2ln";
export const BAD = "e30.e30.YmFk";
export const SUBJECT = "00000000-0000-4000-8000-0000000000a1";
export const OTHER_SUBJECT = "00000000-0000-4000-8000-0000000000a2";
export const PROFILE_REF = "00000000-0000-4000-8000-0000000000a3";
export const OTHER_PROFILE_REF = "00000000-0000-4000-8000-0000000000a4";
export const PROFILE_PATH = "/api/v1/self/profile";
export const PROVISION_PATH = "/api/v1/self/profile/provision";
/** The unique marker of the display names the tests send (used by the redaction assertions). */
export const NAME_MARKER = "synthetic-name-marker";
export const DIRECTORY_EMAIL = "directory-owner@example.test";
export const bearer = { Authorization: `Bearer ${GOOD}` };

type ReadResult = Awaited<ReturnType<CurrentProfileStore["readCurrentBusinessProfile"]>>;
type UpdateResult = Awaited<ReturnType<CurrentProfileStore["updateCurrentBusinessProfile"]>>;
export type StoredProfile = { publicRef: string; displayName: string | null; updatedAt: string };
/**
 * The result contract of provisionCurrentBusinessProfile (plan C3: CurrentProfileProvision). Declared here
 * so this harness does not import a type that does not exist before the implementation.
 */
export type ProvisionResult =
  | { status: "created"; profile: StoredProfile }
  | { status: "existing"; profile: StoredProfile }
  | { status: "commit_unknown" }
  | { status: "unavailable" };

/**
 * Injection points of the recording store (DI only; the production adapter is never patched).
 * `FP.DB.*` are SPEC-170 Fault Points; `PROFILE.*` are this harness's own injection points, not SPEC-170 Fault Points.
 */
export type ProfileFaultPoint =
  | "FP.DB.INSIDE_STATEMENT"
  | "FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK"
  | "PROFILE.ROW_MISSING"
  | "PROFILE.STORE_THROWS"
  | "PROFILE.RESELECT_EMPTY";

export interface RecordingProfileStore extends CurrentProfileStore {
  readonly reads: string[];
  /** Auth Subjects passed to provisionCurrentBusinessProfile, in call order. */
  readonly provisions: string[];
  provisionCurrentBusinessProfile(authSubject: string): Promise<ProvisionResult>;
  readonly updates: [authSubject: string, displayName: string | null][];
  /** The current row of an Auth Subject (a copy), or undefined. */
  row(authSubject: string): StoredProfile | undefined;
  inject(point: ProfileFaultPoint | undefined): void;
}

export const INITIAL_UPDATED_AT = "2026-11-01T00:00:00.000Z";
export const UPDATED_AT = "2026-11-19T01:02:03.456Z";

/** Deterministic synthetic public_ref of the n-th row the stub creates (a valid UUID, never a real one). */
export const createdRef = (n: number): string =>
  `00000000-0000-4000-8000-${(0xc00 + n).toString(16).padStart(12, "0")}`;

/**
 * A stub that behaves like the repository contract: UPDATE returns the row it wrote; provision returns
 * `existing` for a row that is there and otherwise creates one (display_name null, fixed updatedAt) as `created`.
 */
export function createRecordingProfileStore(
  initial: Readonly<Record<string, StoredProfile>> = {
    [SUBJECT]: { publicRef: PROFILE_REF, displayName: null, updatedAt: INITIAL_UPDATED_AT },
    [OTHER_SUBJECT]: {
      publicRef: OTHER_PROFILE_REF,
      displayName: "other-synthetic",
      updatedAt: INITIAL_UPDATED_AT,
    },
  },
): RecordingProfileStore {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, { ...v }]));
  const reads: string[] = [];
  const updates: [string, string | null][] = [];
  const provisions: string[] = [];
  let created = 0;
  let fault: ProfileFaultPoint | undefined;
  return {
    reads,
    updates,
    provisions,
    row: (authSubject) => {
      const found = rows.get(authSubject);
      return found ? { ...found } : undefined;
    },
    inject: (point) => {
      fault = point;
    },
    async readCurrentBusinessProfile(authSubject): Promise<ReadResult> {
      reads.push(authSubject);
      if (fault === "PROFILE.STORE_THROWS") throw new Error("synthetic profile store failure");
      if (fault === "FP.DB.INSIDE_STATEMENT") return { status: "unavailable" };
      if (fault === "PROFILE.ROW_MISSING") return { status: "not_found" };
      const found = rows.get(authSubject);
      return found ? { status: "found", profile: { ...found } } : { status: "not_found" };
    },
    async updateCurrentBusinessProfile(authSubject, displayName): Promise<UpdateResult> {
      updates.push([authSubject, displayName]);
      if (fault === "PROFILE.STORE_THROWS") throw new Error("synthetic profile store failure");
      if (fault === "FP.DB.INSIDE_STATEMENT") return { status: "unavailable" };
      if (fault === "FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK") return { status: "commit_unknown" };
      if (fault === "PROFILE.ROW_MISSING") return { status: "not_found" };
      const found = rows.get(authSubject);
      if (!found) return { status: "not_found" };
      found.displayName = displayName;
      found.updatedAt = UPDATED_AT;
      return { status: "updated", profile: { ...found } };
    },
    async provisionCurrentBusinessProfile(authSubject): Promise<ProvisionResult> {
      provisions.push(authSubject);
      if (fault === "PROFILE.STORE_THROWS") throw new Error("synthetic profile store failure");
      if (fault === "FP.DB.INSIDE_STATEMENT") return { status: "unavailable" };
      const found = rows.get(authSubject);
      if (fault === "PROFILE.RESELECT_EMPTY" && !found)
        throw new Error("synthetic: the reselect after ON CONFLICT found no row");
      if (found) return { status: "existing", profile: { ...found } };
      created += 1;
      const row = { publicRef: createdRef(created), displayName: null, updatedAt: UPDATED_AT };
      rows.set(authSubject, row);
      // The commit happened but its acknowledgement was lost: a resend finds the row (existing).
      if (fault === "FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK") return { status: "commit_unknown" };
      return { status: "created", profile: { ...row } };
    },
  };
}

const directory = (emailVerified: boolean, authSubject = SUBJECT) => ({
  authSubject,
  emailVerified,
});
export type PrincipalKind =
  | "verified"
  | "unverified"
  | "no_profile"
  | "inconsistent"
  | "no_directory"
  | "unverified_no_profile"
  | "admin"
  | "profile_bad_ref"
  | "unknown_role"
  | "directory_mismatch"
  | "email_flag_not_boolean";
const ownProfile = { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT };
export const principalRow = (kind: PrincipalKind = "verified"): PrincipalRecord => {
  switch (kind) {
    case "no_profile":
      return { directory: directory(true), profile: null, roles: [] };
    case "unverified_no_profile":
      return { directory: directory(false), profile: null, roles: [] };
    case "no_directory":
      return { directory: null, profile: null, roles: [] };
    case "inconsistent":
      return {
        directory: directory(true),
        profile: { id: "1", publicRef: PROFILE_REF, authSubject: OTHER_SUBJECT },
        roles: [],
      };
    case "admin":
      return { directory: directory(true), profile: ownProfile, roles: ["ADMINISTRATOR"] };
    case "profile_bad_ref":
      return {
        directory: directory(true),
        profile: { ...ownProfile, publicRef: "not-a-uuid" },
        roles: [],
      };
    case "unknown_role":
      return { directory: directory(true), profile: ownProfile, roles: ["CUSTOMER"] };
    case "directory_mismatch":
      return { directory: directory(true, OTHER_SUBJECT), profile: null, roles: [] };
    case "email_flag_not_boolean":
      return {
        directory: { authSubject: SUBJECT, emailVerified: "yes" as unknown as boolean },
        profile: ownProfile,
        roles: [],
      };
    default:
      return { directory: directory(kind === "verified"), profile: ownProfile, roles: [] };
  }
};

/**
 * A Principal source that follows the recording store: no row for SUBJECT means "verified, no Profile",
 * and a row created by a provision makes the next directory read return a Profile (as the real database).
 */
export const principalFollowing =
  (store: RecordingProfileStore, kind: "verified" | "unverified" = "verified") =>
  (): PrincipalRecord => {
    const row = store.row(SUBJECT);
    if (!row) return principalRow(kind === "verified" ? "no_profile" : "unverified_no_profile");
    const base = principalRow(kind);
    return base.profile
      ? { ...base, profile: { ...base.profile, publicRef: row.publicRef } }
      : base;
  };

export interface RigOptions {
  /** Pass no `profiles` dependency to createApp (fail-closed case). */
  readonly omitProfiles?: boolean;
  readonly store?: RecordingProfileStore;
  /** Mount this profile store instead of the recording one (for example the real repository on a fake pool). */
  readonly profiles?: CurrentProfileStore;
  readonly principal?: () => PrincipalRecord;
  readonly verifier?: TokenVerifier;
  readonly overrides?: Record<string, unknown>;
}
export interface SelfProfileRig {
  readonly app: ReturnType<typeof createApp>;
  readonly store: RecordingProfileStore;
  readonly trs: TestRateLimit;
  /** Rate limit store calls, token verification, directory reads and log events in time order. */
  readonly order: string[];
  readonly records: Record<string, unknown>[];
  readonly lines: string[];
  /** Number of Principal directory reads. */
  principalReads(): number;
  send(path: string, init?: RequestInit): Promise<Response>;
  get(extraPath?: string, headers?: Record<string, string>): Promise<Response>;
  /** PATCH with a raw string body (so JSON escapes and duplicate keys can be sent verbatim). */
  patchRaw(body: string, headers?: Record<string, string>, extraPath?: string): Promise<Response>;
  /** PATCH with a JSON-serialised body. */
  patch(body: unknown, headers?: Record<string, string>): Promise<Response>;
  /** POST /api/v1/self/profile/provision (API-AUTH-003); the default body is `{}`. `extraPath` may be a query. */
  provision(body?: string, headers?: Record<string, string>, extraPath?: string): Promise<Response>;
}

export function selfProfileRig(options: RigOptions = {}): SelfProfileRig {
  const order: string[] = [];
  const records: Record<string, unknown>[] = [];
  const lines: string[] = [];
  let principalReads = 0;
  const store = options.store ?? createRecordingProfileStore();
  const trs = createTestRateLimit({ overrides: options.overrides ?? {} });
  const evaluate = trs.store.evaluate.bind(trs.store);
  trs.store.evaluate = async (mode, rules, id) => {
    order.push(`store:${mode}`);
    return evaluate(mode, rules, id);
  };
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
      const record = JSON.parse(line) as Record<string, unknown>;
      records.push(record);
      order.push(`log:${String(record.event_name)}`);
    },
  );
  const inner: TokenVerifier = options.verifier ?? {
    verify: async (token) => {
      if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
      return { subject: SUBJECT };
    },
  };
  const principal = options.principal ?? (() => principalRow("verified"));
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger,
    auth: {
      verifier: {
        verify: async (token) => {
          order.push("verify");
          return inner.verify(token);
        },
      },
      store: {
        findByAuthSubject: async () => {
          principalReads += 1;
          order.push("db");
          return principal();
        },
      },
    },
    rateLimit: trs.rateLimit,
    ...(options.omitProfiles ? {} : { profiles: options.profiles ?? store }),
  });
  const send = async (path: string, init?: RequestInit): Promise<Response> =>
    app.request(path.startsWith("http") ? path : `${API}${path}`, init, peer());
  const patchRaw: SelfProfileRig["patchRaw"] = (body, headers = {}, extraPath = "") =>
    send(`${PROFILE_PATH}${extraPath}`, {
      method: "PATCH",
      headers: { ...bearer, Origin: WEB, "Content-Type": "application/json", ...headers },
      body,
    });
  const provision: SelfProfileRig["provision"] = (body = "{}", headers = {}, extraPath = "") =>
    send(`${PROVISION_PATH}${extraPath}`, {
      method: "POST",
      headers: { ...bearer, Origin: WEB, "Content-Type": "application/json", ...headers },
      body,
    });
  return {
    app,
    store,
    trs,
    order,
    records,
    lines,
    principalReads: () => principalReads,
    send,
    get: (extraPath = "", headers = bearer) => send(`${PROFILE_PATH}${extraPath}`, { headers }),
    patchRaw,
    patch: (body, headers) => patchRaw(JSON.stringify(body), headers),
    provision,
  };
}

export const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; retryable: boolean; details: unknown } }).error;
