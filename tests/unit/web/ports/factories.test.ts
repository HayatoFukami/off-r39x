import { describe, expect, it } from "vitest";
import { createApiPort } from "../../../../apps/web/src/api-client/index.ts";
import { createAuthPort } from "../../../../apps/web/src/auth/index.ts";
import { DB_STORAGE_KEY } from "../../../../apps/web/src/mock/backend/db.ts";
import {
  defaultScenario,
  SCENARIO_STORAGE_KEY,
  saveScenario,
} from "../../../../apps/web/src/mock/backend/scenario.ts";
import { SESSION_STORAGE_KEY } from "../../../../apps/web/src/mock/backend/session-store.ts";
import { createMemoryStorage } from "../../../harness/mock-backend.ts";
import { EMAIL, TEST_PASSWORD } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s3-layout.md section 3.1 (DEV-WEB-011 fail closed, DEV-WEB-010 mock selection).

const MOCK = { NEXT_PUBLIC_UI_MOCK: "1" } as const;

describe("TC-DEV-WEB-011-101 createApiPort / createAuthPort fail closed unless UI mock is enabled (DEV-WEB-011)", () => {
  it.each([
    [{}],
    [{ NEXT_PUBLIC_UI_MOCK: "0" }],
    [{ NEXT_PUBLIC_UI_MOCK: "true" }],
    [{ NEXT_PUBLIC_UI_MOCK: "" }],
  ])("createApiPort throws 'real api client not implemented' for env %j", (env) => {
    const storage = createMemoryStorage();
    expect(() => createApiPort({ env, storage })).toThrow("real api client not implemented");
    expect(storage.writes).toEqual([]);
  });

  it.each([[{}], [{ NEXT_PUBLIC_UI_MOCK: "0" }], [{ NEXT_PUBLIC_UI_MOCK: "yes" }]])(
    "createAuthPort throws 'real auth client not implemented' for env %j",
    (env) => {
      const storage = createMemoryStorage();
      expect(() => createAuthPort({ env, storage })).toThrow("real auth client not implemented");
      expect(storage.writes).toEqual([]);
    },
  );
});

describe("TC-DEV-WEB-010-111 mock mode selects the mock ports on the injected storage (DEV-WEB-010)", () => {
  it("serves seeded public data through the api port and stores the DB in the injected storage", async () => {
    const storage = createMemoryStorage();
    const api = createApiPort({ env: MOCK, storage });
    const result = await api.public.listSponsorLogos();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.map((logo) => logo.name)).toEqual([
      "Sponsor Alpha",
      "Sponsor Bravo",
      "Sponsor Charlie",
    ]);
    expect(Object.keys(storage.dump())).toContain(DB_STORAGE_KEY);
  });

  it("reads the scenario from the injected storage on every call", async () => {
    const storage = createMemoryStorage();
    const api = createApiPort({ env: MOCK, storage });
    expect((await api.public.listSponsorLogos()).kind).toBe("ok");

    saveScenario(storage, { ...defaultScenario(), sponsorLogos: "fail" });
    expect(await api.public.listSponsorLogos()).toEqual({ kind: "unavailable" });

    saveScenario(storage, { ...defaultScenario(), sponsorLogos: "none" });
    expect(await api.public.listSponsorLogos()).toEqual({ kind: "ok", data: [] });
    expect(Object.keys(storage.dump())).toContain(SCENARIO_STORAGE_KEY);
  });

  it("shares session, DB and scenario between the auth port and the api port", async () => {
    const storage = createMemoryStorage();
    const api = createApiPort({ env: MOCK, storage });
    const auth = createAuthPort({ env: MOCK, storage });

    expect(await auth.getSession()).toEqual({ kind: "ok", session: { kind: "guest" } });
    expect((await api.self.getProfile()).kind).toBe("auth_required");

    const signedIn = await auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD });
    expect(signedIn).toEqual({ kind: "signed_in", emailVerified: true });
    expect(Object.keys(storage.dump())).toContain(SESSION_STORAGE_KEY);
    const profile = await api.self.getProfile();
    expect(profile.kind).toBe("ok");
    if (profile.kind === "ok") expect(profile.data.email).toBe(EMAIL.demo);

    expect(await auth.signOut()).toEqual({ kind: "signed_out" });
    expect((await api.self.getProfile()).kind).toBe("auth_required");
  });

  it("does not persist the password anywhere in the injected storage", async () => {
    const storage = createMemoryStorage();
    const auth = createAuthPort({ env: MOCK, storage });
    await auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD });
    for (const value of Object.values(storage.dump())) expect(value).not.toContain(TEST_PASSWORD);
  });
});
