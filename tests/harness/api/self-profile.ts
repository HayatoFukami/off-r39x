// Test double and rig for API-AUTH-002 / API-AUTH-004 (PR-L2-1a). Test only: the recording
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
/** The unique marker of the display names the tests send (used by the redaction assertions). */
export const NAME_MARKER = "synthetic-name-marker";
export const DIRECTORY_EMAIL = "directory-owner@example.test";
export const bearer = { Authorization: `Bearer ${GOOD}` };

type ReadResult = Awaited<ReturnType<CurrentProfileStore["readCurrentBusinessProfile"]>>;
type UpdateResult = Awaited<ReturnType<CurrentProfileStore["updateCurrentBusinessProfile"]>>;
export type StoredProfile = { publicRef: string; displayName: string | null; updatedAt: string };

/** SPEC-170 Fault Points used here (DI only; the production adapter is never patched). */
export type ProfileFaultPoint =
  | "FP.DB.INSIDE_STATEMENT"
  | "FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK"
  | "PROFILE.ROW_MISSING"
  | "PROFILE.STORE_THROWS";

export interface RecordingProfileStore extends CurrentProfileStore {
  readonly reads: string[];
  readonly updates: [authSubject: string, displayName: string | null][];
  /** The current row of an Auth Subject (a copy), or undefined. */
  row(authSubject: string): StoredProfile | undefined;
  inject(point: ProfileFaultPoint | undefined): void;
}

export const INITIAL_UPDATED_AT = "2026-11-01T00:00:00.000Z";
export const UPDATED_AT = "2026-11-19T01:02:03.456Z";

/** A stub that behaves like the repository contract: UPDATE returns the row it wrote. */
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
  let fault: ProfileFaultPoint | undefined;
  return {
    reads,
    updates,
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
  };
}

const directory = (emailVerified: boolean, authSubject = SUBJECT) => ({
  authSubject,
  emailVerified,
});
export const principalRow = (
  kind: "verified" | "unverified" | "no_profile" | "inconsistent" = "verified",
): PrincipalRecord =>
  kind === "no_profile"
    ? { directory: directory(true), profile: null, roles: [] }
    : kind === "inconsistent"
      ? {
          directory: directory(true),
          profile: { id: "1", publicRef: PROFILE_REF, authSubject: OTHER_SUBJECT },
          roles: [],
        }
      : {
          directory: directory(kind === "verified"),
          profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
          roles: [],
        };

export interface RigOptions {
  /** Pass no `profiles` dependency to createApp (fail-closed case). */
  readonly omitProfiles?: boolean;
  readonly store?: RecordingProfileStore;
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
    ...(options.omitProfiles ? {} : { profiles: store }),
  });
  const send = async (path: string, init?: RequestInit): Promise<Response> =>
    app.request(path.startsWith("http") ? path : `${API}${path}`, init, peer());
  const patchRaw: SelfProfileRig["patchRaw"] = (body, headers = {}, extraPath = "") =>
    send(`${PROFILE_PATH}${extraPath}`, {
      method: "PATCH",
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
  };
}

export const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; retryable: boolean; details: unknown } }).error;
