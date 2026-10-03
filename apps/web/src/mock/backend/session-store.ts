import { z } from "zod";
import type { MockStorage } from "./db";

// The mock session lives in its own storage entry. It holds no credential (SEC-AUTH-018).

export const SESSION_STORAGE_KEY = "r39x.mock.session.v1";

export const sessionStateSchema = z.strictObject({
  version: z.literal(1),
  session: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("guest") }),
    z.strictObject({
      kind: z.literal("authenticated"),
      email: z.string(),
      emailVerified: z.boolean(),
    }),
  ]),
  pendingVerificationEmail: z.string().nullable(),
});

export type SessionStoreState = z.infer<typeof sessionStateSchema>;

export type SessionLoad =
  | { kind: "ok"; state: SessionStoreState }
  | { kind: "corrupted"; message: string };

const CORRUPTED_MESSAGE = "The stored mock session is not valid. Sign out to recover.";

export function loadSessionState(storage: MockStorage): SessionLoad {
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (raw === null) {
    return {
      kind: "ok",
      state: { version: 1, session: { kind: "guest" }, pendingVerificationEmail: null },
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "corrupted", message: CORRUPTED_MESSAGE };
  }
  const parsed = sessionStateSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "corrupted", message: CORRUPTED_MESSAGE };
  }
  return { kind: "ok", state: parsed.data };
}

/** Validates, then stores. An invalid state throws and leaves the storage untouched. */
export function saveSessionState(storage: MockStorage, state: SessionStoreState): void {
  const parsed = sessionStateSchema.parse(state);
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(parsed));
}
