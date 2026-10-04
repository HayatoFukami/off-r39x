import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { linesStarting, REPO_ROOT, runScript } from "../../harness/script-fixtures.ts";

// Root package.json script entries and scripts/mock-web.mts (DEV-WEB-011, DEV-REP-001, SPEC-180 build order).
// Contract: tests/contracts/s9-finalize.md sections 1 and 4.

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("TC-DEV-TRC-001-009 the traceability script entry", () => {
  it("package.json has validate:traceability running scripts/validate-traceability.mts", () => {
    expect(pkg.scripts["validate:traceability"]).toBe("node scripts/validate-traceability.mts");
  });
});

describe("TC-DEV-SEC-004-009 the secret scan script entry", () => {
  it("package.json has secret-scan running scripts/secret-scan.mts", () => {
    expect(pkg.scripts["secret-scan"]).toBe("node scripts/secret-scan.mts");
  });
});

describe("TC-DEV-WEB-011-202 mock build scripts are cross-platform and the plain build stays fail-closed", () => {
  it("build:mock and start:mock go through scripts/mock-web.mts, with no POSIX env prefix and no cross-env", () => {
    expect(pkg.scripts["build:mock"]).toBe("node scripts/mock-web.mts build");
    expect(pkg.scripts["start:mock"]).toBe("node scripts/mock-web.mts start");
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, name).not.toMatch(/^\s*[A-Z_]+=\S*\s/);
      expect(command, name).not.toMatch(/cross-env/);
    }
  });

  it("the plain build and dev scripts do not set NEXT_PUBLIC_UI_MOCK (mock stays opt-in)", () => {
    expect(pkg.scripts.build).toBe("pnpm --filter @off-r39x/web build");
    for (const name of ["build", "dev", "start"]) {
      expect(pkg.scripts[name] ?? "", name).not.toMatch(/NEXT_PUBLIC_UI_MOCK/);
    }
  });
});

describe("TC-DEV-WEB-011-203 scripts/mock-web.mts --dry-run", () => {
  it("build: prints the mock flag and the web build command, runs nothing, exits 0", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { VERCEL_ENV: undefined },
    });
    expect(result.status).toBe(0);
    expect(result.lines).toEqual([
      "DRY-RUN mock-web build",
      "ENV NEXT_PUBLIC_UI_MOCK=1",
      "COMMAND pnpm --filter @off-r39x/web build",
    ]);
  });

  it("start: serves the build on 127.0.0.1, default port 3100, --port overrides", () => {
    const def = runScript("mock-web.mts", ["start", "--dry-run"], {
      env: { VERCEL_ENV: undefined },
    });
    expect(def.status).toBe(0);
    expect(linesStarting(def, "COMMAND ")).toEqual([
      "COMMAND pnpm --filter @off-r39x/web exec next start -p 3100 -H 127.0.0.1",
    ]);
    expect(linesStarting(def, "ENV ")).toEqual(["ENV NEXT_PUBLIC_UI_MOCK=1"]);
    const custom = runScript("mock-web.mts", ["start", "--port", "4123", "--dry-run"], {
      env: { VERCEL_ENV: undefined },
    });
    expect(linesStarting(custom, "COMMAND ")).toEqual([
      "COMMAND pnpm --filter @off-r39x/web exec next start -p 4123 -H 127.0.0.1",
    ]);
  });

  it("refuses a production deployment environment (VERCEL_ENV=production): exit 1, ERROR line, no COMMAND", () => {
    for (const mode of ["build", "start"]) {
      const result = runScript("mock-web.mts", [mode, "--dry-run"], {
        env: { VERCEL_ENV: "production" },
      });
      expect(result.status, mode).toBe(1);
      expect(result.output).toMatch(/^ERROR mock-web-production/m);
      expect(linesStarting(result, "COMMAND ")).toEqual([]);
    }
  });

  it("prints no other environment value", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { VERCEL_ENV: undefined, SYNTHETIC_SENTINEL_VALUE: "do-not-print-this-9f3a" },
    });
    expect(result.status).toBe(0);
    expect(result.output).not.toContain("do-not-print-this-9f3a");
  });

  it("exits 2 with USAGE for a missing or unknown mode, an unknown option or a bad port", () => {
    for (const args of [
      [],
      ["serve"],
      ["build", "--bogus"],
      ["start", "--port", "abc"],
      ["start", "--port", "70000"],
    ]) {
      const result = runScript("mock-web.mts", [...args, "--dry-run"]);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.output).toMatch(/USAGE/);
    }
  });
});

describe("TC-DEV-WEB-011-201 a production-deploy build with the mock flag on fails (existing guard through next.config.ts)", () => {
  const configUrl = pathToFileURL(join(REPO_ROOT, "apps", "web", "next.config.ts")).href;
  const program = `const c = (await import(${JSON.stringify(configUrl)})).default; c("phase-production-build"); console.log("CONFIG-OK");`;

  function load(env: Record<string, string | undefined>) {
    const merged: Record<string, string | undefined> = { ...process.env, ...env };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    return spawnSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--input-type=module",
        "-e",
        program,
      ],
      { encoding: "utf8", env: merged as NodeJS.ProcessEnv, timeout: 60_000 },
    );
  }

  it("throws the UI mock error for NEXT_PUBLIC_UI_MOCK=1 with VERCEL_ENV=production", () => {
    const r = load({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "production" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/UI mock mode must not be enabled in a production build/);
    expect(r.stdout).not.toContain("CONFIG-OK");
  });

  it("loads for preview with the flag, and for production without the flag", () => {
    expect(load({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "preview" }).stdout).toContain("CONFIG-OK");
    expect(load({ NEXT_PUBLIC_UI_MOCK: undefined, VERCEL_ENV: "production" }).stdout).toContain(
      "CONFIG-OK",
    );
  });
});
