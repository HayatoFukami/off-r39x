import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTree,
  type FileMap,
  findingsOf,
  REPO_ROOT,
  type RunResult,
  removeTree,
  runScript,
  SAMPLE,
  SYNTHETIC_OK,
  withScan,
} from "../../harness/script-fixtures.ts";

// scripts/secret-scan.mts (SPEC-190 section 37 "Secret scan", DEV-SEC-004, DEV-WEB-013, TST-DAT-002 / 003 / 010,
// SEC-QR-012 / 013, ACC-DEV-007). Contract: tests/contracts/s9-finalize.md section 3.
// Finding line: `FINDING <rule-id> <relative/path>:<line>`. The matched value is NEVER printed.
// All sample values come from the harness, assembled at run time from fragments.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function scan(files: FileMap, args: readonly string[] = []): RunResult {
  const root = createTree(files, "r39x-secret-");
  roots.push(root);
  return runScript("secret-scan.mts", ["--root", root, ...args]);
}

function expectFinding(result: RunResult, rule: string, file: string): void {
  expect(
    findingsOf(result).some((l) => l.startsWith(`FINDING ${rule} ${file}:`)),
    `${rule} ${file}\n${result.stdout}`,
  ).toBe(true);
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/^FAIL secret-scan findings=\d+$/m);
  expect(result.stdout).not.toMatch(/^OK /m);
}

function expectNoFinding(result: RunResult): void {
  expect(findingsOf(result)).toEqual([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^OK secret-scan files=\d+$/m);
}

const SRC = "apps/web/src/leak.ts";
const line = (text: string): string => `export const v = "${text}";\n`;

describe("TC-DEV-SEC-004-001 a clean tree passes", () => {
  it("exits 0 with one OK line: reserved-domain data, an empty env example and a placeholder QR shape are allowed", () => {
    const result = scan(cleanWithBuildSkipped());
    expectNoFinding(result);
    expect(result.stdout).toMatch(/^SKIP build-output /m);
  });

  it("reserved synthetic e-mail domains never match", () => {
    const files = withScan({
      "apps/web/src/emails.ts": Object.values(SYNTHETIC_OK)
        .map((e) => line(e))
        .join(""),
    });
    expectNoFinding(scan(files));
  });
});

describe("TC-DEV-SEC-004-002 the real repository has no finding (default root)", () => {
  it("exits 0 from the repository root and from another working directory with --root", () => {
    const direct = runScript("secret-scan.mts", []);
    expect(findingsOf(direct)).toEqual([]);
    expect(direct.status).toBe(0);
    expect(direct.stdout).toMatch(/^OK secret-scan files=\d+$/m);
    const viaRoot = runScript("secret-scan.mts", ["--root", REPO_ROOT], {
      cwd: join(REPO_ROOT, "tests"),
    });
    expect(viaRoot.status).toBe(0);
  });
});

describe("TC-DEV-SEC-004-003 credential formats are findings (DEV-SEC-004, TST-DAT-003)", () => {
  const cases: [string, string][] = [
    ["stripe-key", SAMPLE.stripeLive],
    ["stripe-key", SAMPLE.stripeTest],
    ["webhook-secret", SAMPLE.webhookSecret],
    ["resend-key", SAMPLE.resendKey],
    ["jwt", SAMPLE.jwt],
    ["private-key", SAMPLE.privateKeyHeader],
    ["database-url", SAMPLE.databaseUrl],
  ];
  for (const [rule, value] of cases) {
    it(`${rule}: found in source, reported with rule and file:line only (value redacted)`, () => {
      const result = scan(withScan({ [SRC]: `// header\n${line(value)}` }));
      expectFinding(result, rule, SRC);
      expect(findingsOf(result)).toContain(`FINDING ${rule} ${SRC}:2`);
      expect(result.output).not.toContain(value);
      expect(result.output).not.toContain(value.slice(0, 12));
    });
  }

  it("env-secret: a committed env assignment with a real-looking value, also in a dotfile", () => {
    const result = scan(withScan({ ".env.local": `${SAMPLE.envSecret}\n` }));
    expectFinding(result, "env-secret", ".env.local");
    expect(result.output).not.toContain("AbCdEfGh12345678");
  });

  it("env-secret: empty, <placeholder> and ${VAR} values in an env example are fine", () => {
    expectNoFinding(
      scan(withScan({ ".env.example": "STRIPE_SECRET_KEY=\nRESEND_API_KEY=<set-in-vault>\n" })),
    );
  });
});

describe("TC-DEV-SEC-004-004 raw QR tokens and the mock matrix seed (SEC-QR-012 / 013, TST-DAT-010, DEV-WEB-013)", () => {
  it("raw-qr-token: an Entry and a Karaoke token-shaped value is a finding anywhere, tests included", () => {
    for (const value of [SAMPLE.rawQr, SAMPLE.rawQrKaraoke]) {
      for (const file of [SRC, "tests/unit/qr.test.ts", "apps/web/public/mock/qr.svg"]) {
        const result = scan(withScan({ [file]: `${value}\n` }));
        expectFinding(result, "raw-qr-token", file);
        expect(result.output).not.toContain(value);
      }
    }
  });

  it("the documented placeholder shape (r39x1.ent.<43-char...>) is not a token", () => {
    expectNoFinding(scan(withScan({ [SRC]: "// r39x1.ent.<43-char-base64url-random>\n" })));
  });

  it("mock-seed-leak: a seed value outside tests/** is a finding; inside tests/** it is a synthetic input", () => {
    expectFinding(
      scan(withScan({ "apps/web/public/mock/x.svg": `<!-- ${SAMPLE.matrixSeed} -->\n` })),
      "mock-seed-leak",
      "apps/web/public/mock/x.svg",
    );
    expectFinding(scan(withScan({ [SRC]: line(SAMPLE.matrixSeed) })), "mock-seed-leak", SRC);
    expectNoFinding(scan(withScan({ "tests/unit/qr.test.ts": line(SAMPLE.matrixSeed) })));
  });
});

describe("TC-DEV-SEC-004-005 real PII patterns (TST-DAT-002, AGENTS section 3)", () => {
  it("real-email: any address outside the reserved synthetic domains", () => {
    const result = scan(withScan({ "tests/fixtures/people.ts": line(SAMPLE.email) }));
    expectFinding(result, "real-email", "tests/fixtures/people.ts");
    expect(result.output).not.toContain(SAMPLE.email);
  });

  it("phone-number: a Japanese mobile number", () => {
    const result = scan(withScan({ [SRC]: line(SAMPLE.phone) }));
    expectFinding(result, "phone-number", SRC);
    expect(result.output).not.toContain(SAMPLE.phone);
  });

  it("card-number: four groups of four digits that pass Luhn; a non-Luhn group is not a finding", () => {
    expectFinding(scan(withScan({ [SRC]: line(SAMPLE.card) })), "card-number", SRC);
    expectNoFinding(scan(withScan({ [SRC]: line(SAMPLE.cardNotLuhn) })));
  });

  it("an inline marker `secret-scan:allow <rule-id>` allows that rule on that line only", () => {
    const allowed = scan(
      withScan({
        [SRC]: `${line(SAMPLE.email).trimEnd()} // secret-scan:allow real-email synthetic sentinel\n`,
      }),
    );
    expectNoFinding(allowed);
    const wrongRule = scan(
      withScan({ [SRC]: `${line(SAMPLE.email).trimEnd()} // secret-scan:allow phone-number\n` }),
    );
    expectFinding(wrongRule, "real-email", SRC);
    const nextLine = scan(
      withScan({ [SRC]: `// secret-scan:allow real-email\n${line(SAMPLE.email)}` }),
    );
    expectFinding(nextLine, "real-email", SRC);
  });
});

describe("TC-DEV-SEC-004-006 scan scope", () => {
  it("does not scan node_modules, .git, docs, reviews, ref, generated or test-results", () => {
    const dirs = [
      "node_modules/pkg",
      ".git",
      "docs/specs",
      "reviews/x",
      "ref/Dev",
      "generated",
      "tests/test-results",
    ];
    const files: Record<string, string> = {};
    for (const dir of dirs) files[`${dir}/leak.ts`] = line(SAMPLE.stripeLive);
    expectNoFinding(scan(withScan(files)));
  });

  it("scans apps, packages, scripts, tests, traceability, public assets and root files", () => {
    for (const file of [
      "apps/web/public/mock/leak.svg",
      "packages/domain/src/leak.ts",
      "scripts/leak.mts",
      "tests/fixtures/leak.json",
      "traceability/leak.json",
      "leak.config.json",
    ]) {
      expectFinding(scan(withScan({ [file]: line(SAMPLE.stripeLive) })), "stripe-key", file);
    }
  });

  it("reports each finding in one run, sorted by path then line, once per rule per line", () => {
    const result = scan(
      withScan({
        "b.ts": line(SAMPLE.stripeLive),
        "a.ts": `${line(SAMPLE.stripeLive)}${line(SAMPLE.stripeTest)}`,
      }),
    );
    const found = findingsOf(result);
    expect(found).toEqual([
      "FINDING stripe-key a.ts:1",
      "FINDING stripe-key a.ts:2",
      "FINDING stripe-key b.ts:1",
    ]);
    expect(result.stdout).toMatch(/^FAIL secret-scan findings=3$/m);
  });
});

describe("TC-DEV-SEC-004-007 build output: apps/web/.next client bundles (SEC-WEB-005 / DEV-SEC-002, ACC-DEV-007)", () => {
  const STATIC = "apps/web/.next/static/chunks/app.js";
  const HTML = "apps/web/.next/server/app/index.html";

  it("scans .next/static and .next/server/app for credential, token and seed values", () => {
    expectFinding(scan(withScan({ [STATIC]: line(SAMPLE.stripeLive) })), "stripe-key", STATIC);
    expectFinding(scan(withScan({ [STATIC]: line(SAMPLE.rawQr) })), "raw-qr-token", STATIC);
    expectFinding(scan(withScan({ [STATIC]: line(SAMPLE.matrixSeed) })), "mock-seed-leak", STATIC);
    expectFinding(scan(withScan({ [HTML]: `<p>${SAMPLE.jwt}</p>\n` })), "jwt", HTML);
  });

  it("mock-seed-field: the field name in prerendered HTML / RSC is a finding, in a static chunk it is only a property name", () => {
    expectFinding(
      scan(withScan({ [HTML]: `{"${SAMPLE.matrixSeedField}":"x"}\n` })),
      "mock-seed-field",
      HTML,
    );
    expectNoFinding(scan(withScan({ [STATIC]: `a.${SAMPLE.matrixSeedField};\n` })));
  });

  it("ignores .next/cache, and applies no PII rule to vendor chunks", () => {
    expectNoFinding(
      scan(withScan({ "apps/web/.next/cache/webpack/x.js": line(SAMPLE.stripeLive) })),
    );
    expectNoFinding(scan(withScan({ [STATIC]: `${line(SAMPLE.email)}${line(SAMPLE.phone)}` })));
  });

  it("--require-build fails with an ERROR line when the build output is missing; without it the scan is SKIPped", () => {
    const missing = scan(cleanWithBuildSkipped(), ["--require-build"]);
    expect(missing.status).toBe(1);
    expect(missing.output).toMatch(/^ERROR build-output-missing/m);
    const present = scan(withScan({ [STATIC]: "export {};\n" }), ["--require-build"]);
    expectNoFinding(present);
    expect(present.stdout).not.toMatch(/^SKIP build-output/m);
  });

  it("--build-dir selects another build directory (relative to the root)", () => {
    const result = scan(withScan({ "out/static/a.js": line(SAMPLE.stripeLive) }), [
      "--build-dir",
      "out",
    ]);
    expectFinding(result, "stripe-key", "out/static/a.js");
  });
});

describe("TC-DEV-SEC-004-008 CLI behaviour", () => {
  it("exits 2 with a USAGE line on an unknown option, a missing value or a missing root", () => {
    for (const args of [
      ["--bogus"],
      ["--root"],
      ["--build-dir"],
      ["--root", join(REPO_ROOT, "no-such-dir-xyz")],
    ]) {
      const result = runScript("secret-scan.mts", args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.output).toMatch(/USAGE|ERROR/);
      expect(findingsOf(result)).toEqual([]);
    }
  });

  it("is repeatable: the same tree gives the same output", () => {
    const files = withScan({ [SRC]: line(SAMPLE.stripeLive) });
    const first = scan(files);
    expect(first.status).toBe(1);
    expect(first.stdout).toBe(scan(files).stdout);
  });
});

function cleanWithBuildSkipped(): Record<string, string> {
  return withScan({});
}
