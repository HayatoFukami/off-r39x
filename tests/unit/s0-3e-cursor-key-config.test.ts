import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../../packages/config/src/index.ts";
import { syntheticApiEnv, syntheticWorkerEnv } from "../harness/config/api-env.ts";
import { listCursorEnv } from "../harness/pagination.ts";

type Env = Record<string, string | undefined>;
const parseApi = (overrides: Env) => parseServerConfig("api", syntheticApiEnv(overrides));
const GOOD_KEY = Buffer.alloc(32, 13).toString("base64");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

describe("list cursor key startup validation (INF-SEC-007, API-QRY-005)", () => {
  it("TC-INF-SEC-007-001 a valid API environment yields a frozen listCursor with a copy-returning key and its version", () => {
    for (const version of ["1", "2147483647"]) {
      const config = parseApi({ LIST_CURSOR_HMAC_KEY_VERSION: version });
      if (config.service !== "api") throw new Error("expected the API configuration");
      expect(config.listCursor.hmacKeyVersion).toBe(Number(version));
      expect(Object.isFrozen(config.listCursor)).toBe(true);
      const first = config.listCursor.hmacKey();
      expect(first).toHaveLength(32);
      expect(Buffer.from(first).equals(Buffer.from(GOOD_KEY, "base64"))).toBe(true);
      first.fill(0);
      const second = config.listCursor.hmacKey();
      expect(second).not.toBe(first);
      expect(Buffer.from(second).equals(Buffer.alloc(32, 13))).toBe(true);
    }
    // Not derived from, and not equal to, any other Secret.
    const other = parseApi({
      RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 21).toString("base64"),
      OBS_CORRELATION_HMAC_KEY: Buffer.alloc(32, 22).toString("base64"),
    });
    if (other.service !== "api") throw new Error("expected the API configuration");
    expect(Buffer.from(other.listCursor.hmacKey()).equals(Buffer.alloc(32, 13))).toBe(true);
    for (const fill of [3, 7, 1, 2])
      expect(Buffer.from(other.listCursor.hmacKey()).equals(Buffer.alloc(32, fill))).toBe(false);
  });

  it("TC-INF-SEC-007-002 a missing or malformed LIST_CURSOR_HMAC_KEY is a startup failure", () => {
    const lastIndex = ALPHABET.indexOf(GOOD_KEY[42] as string);
    const nonCanonical = `${GOOD_KEY.slice(0, 42)}${ALPHABET[lastIndex ^ 1]}=`;
    const bad: Record<string, string | undefined> = {
      missing: undefined,
      empty: "",
      "43 characters (no padding)": GOOD_KEY.slice(0, 43),
      "31 bytes ('==')": Buffer.alloc(31, 13).toString("base64"),
      "33 bytes (no padding)": Buffer.alloc(33, 13).toString("base64"),
      "16 bytes": Buffer.alloc(16, 13).toString("base64"),
      "48 bytes": Buffer.alloc(48, 13).toString("base64"),
      "leading space": ` ${GOOD_KEY}`,
      "trailing newline": `${GOOD_KEY}\n`,
      base64url: `${Buffer.alloc(32, 0xfb).toString("base64url")}=`,
      "non-canonical trailing bits": nonCanonical,
      "non-base64 characters": `${GOOD_KEY.slice(0, 40)}!!!=`,
    };
    expect(nonCanonical).not.toBe(GOOD_KEY);
    expect(Buffer.from(nonCanonical, "base64").equals(Buffer.alloc(32, 13))).toBe(true);
    expect(bad.base64url).toMatch(/[-_]/);
    for (const [name, value] of Object.entries(bad))
      expect(() => parseApi({ LIST_CURSOR_HMAC_KEY: value }), name).toThrow(
        "Invalid server configuration",
      );
  });

  it("TC-INF-SEC-007-003 a missing or non-positive-integer LIST_CURSOR_HMAC_KEY_VERSION is a startup failure", () => {
    const bad = [
      undefined,
      "",
      "0",
      "00",
      "01",
      "-1",
      "+1",
      " 1",
      "1 ",
      "1.0",
      "1.5",
      "1e3",
      "0x1",
      "one",
      "2147483648",
      "99999999999999999999",
    ];
    for (const value of bad)
      expect(() => parseApi({ LIST_CURSOR_HMAC_KEY_VERSION: value }), String(value)).toThrow(
        "Invalid server configuration",
      );
    for (const value of ["1", "2147483647"])
      expect(() => parseApi({ LIST_CURSOR_HMAC_KEY_VERSION: value }), value).not.toThrow();
  });

  it("TC-INF-SEC-007-005 workers parse without the cursor key and refuse it (reader matrix, INF-SEC-003)", () => {
    for (const service of ["email-worker", "reconciliation-worker"] as const) {
      const config = parseServerConfig(service, syntheticWorkerEnv(service));
      expect(config, service).not.toHaveProperty("listCursor");
      expect(() =>
        parseServerConfig(service, syntheticWorkerEnv(service, listCursorEnv())),
      ).toThrow("Invalid server configuration");
      // G-d-B (B-1): the non-secret version alone is not a reader-matrix violation.
      const versionOnly = parseServerConfig(
        service,
        syntheticWorkerEnv(service, { LIST_CURSOR_HMAC_KEY_VERSION: "1" }),
      );
      expect(versionOnly, service).not.toHaveProperty("listCursor");
    }
  });
});
