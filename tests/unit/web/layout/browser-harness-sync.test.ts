import { describe, expect, it } from "vitest";
import { DB_STORAGE_KEY } from "../../../../apps/web/src/mock/backend/db.ts";
import {
  defaultScenario,
  SCENARIO_STORAGE_KEY,
  scenarioSchema,
} from "../../../../apps/web/src/mock/backend/scenario.ts";
import {
  SESSION_STORAGE_KEY,
  sessionStateSchema,
} from "../../../../apps/web/src/mock/backend/session-store.ts";
import {
  authenticatedSession,
  GOODS_TSHIRT,
  KEYS,
  OFFERING_REGULAR,
  scenarioJson,
  sessionJson,
} from "../../../harness/browser/shell.ts";
import { GOODS, OFFERING } from "../../../harness/mock-seed.ts";

// Keeps the browser harness (storage keys, preseed payloads, seed ids) identical to the S2 mock backend,
// so the Playwright specs cannot drift from the contract they preseed.

describe("TC-DEV-WEB-013-122 browser harness constants match the S2 mock backend", () => {
  it("uses the S2 storage keys", () => {
    expect(KEYS.scenario).toBe(SCENARIO_STORAGE_KEY);
    expect(KEYS.session).toBe(SESSION_STORAGE_KEY);
    expect(KEYS.db).toBe(DB_STORAGE_KEY);
    expect(KEYS.cart).toBe("r39x.cart.v1");
  });

  it("builds a scenario payload equal to the S2 defaults that the schema accepts", () => {
    const parsed: unknown = JSON.parse(scenarioJson());
    expect(parsed).toEqual(defaultScenario());
    expect(scenarioSchema.safeParse(parsed).success).toBe(true);
    expect(
      scenarioSchema.safeParse(JSON.parse(scenarioJson({ sponsorLogos: "fail" }))).success,
    ).toBe(true);
  });

  it("builds session payloads that the S2 session schema accepts", () => {
    expect(sessionStateSchema.safeParse(JSON.parse(sessionJson())).success).toBe(true);
    expect(sessionStateSchema.safeParse(JSON.parse(authenticatedSession())).success).toBe(true);
  });

  it("uses the S2 seed ids for the cart fixtures", () => {
    expect(OFFERING_REGULAR).toBe(OFFERING.regular);
    expect(GOODS_TSHIRT).toBe(GOODS.tshirt);
  });
});
