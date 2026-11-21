import { expect, it } from "vitest";
import { parseServerConfig } from "../../packages/config/src/index.ts";
import { syntheticApiEnv } from "../harness/config/api-env.ts";

const MARKER = "synthetic-cursor-key-marker";
const VERSION_MARKER = "synthetic-version-marker";

function failureOf(overrides: Record<string, string | undefined>): Error {
  try {
    parseServerConfig("api", syntheticApiEnv(overrides));
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected failure");
}

it("TC-INF-SEC-007-004 a rejected cursor key or version never appears in the startup error", () => {
  const good = Buffer.alloc(32, 13);
  const bad33 = Buffer.alloc(33, 13);
  const cases: [Record<string, string | undefined>, string[]][] = [
    [{ LIST_CURSOR_HMAC_KEY: MARKER }, [MARKER]],
    [
      { LIST_CURSOR_HMAC_KEY: bad33.toString("base64") },
      [bad33.toString("base64"), bad33.toString("base64url"), bad33.toString("hex")],
    ],
    [{ LIST_CURSOR_HMAC_KEY_VERSION: VERSION_MARKER }, [VERSION_MARKER]],
    // A valid key with an invalid version must not leak the valid key.
    [
      { LIST_CURSOR_HMAC_KEY_VERSION: "0" },
      [good.toString("base64"), good.toString("base64url"), good.toString("hex")],
    ],
  ];
  for (const [overrides, secrets] of cases) {
    const error = failureOf(overrides);
    expect(error.message).toBe("Invalid server configuration");
    expect(error).not.toHaveProperty("cause");
    const text = [String(error), error.stack ?? "", JSON.stringify(error)].join("\n");
    for (const secret of secrets) expect(text).not.toContain(secret);
  }
});
