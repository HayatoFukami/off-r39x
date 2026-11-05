import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { linesStarting, REPO_ROOT, runScript } from "../../harness/script-fixtures.ts";

// Root package.json script entries, apps/web build scripts and scripts/mock-web.mts
// (DEV-WEB-011, DEV-REP-001, SPEC-180 build order). Static SPA: Vite + React Router (DEV-WEB-001).
// Contract: tests/contracts/s9-finalize.md sections 1 and 4.

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const webPkg = JSON.parse(readFileSync(join(REPO_ROOT, "apps", "web", "package.json"), "utf8")) as {
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

  it("the plain build and dev scripts (root and apps/web) set no mock flag (mock stays opt-in)", () => {
    expect(pkg.scripts.build).toBe("pnpm --filter @off-r39x/web build");
    for (const [owner, scripts] of [
      ["root", pkg.scripts],
      ["apps/web", webPkg.scripts],
    ] as const) {
      for (const name of ["build", "dev", "start"]) {
        expect(scripts[name] ?? "", `${owner} ${name}`).not.toMatch(
          /VITE_UI_MOCK|NEXT_PUBLIC_UI_MOCK/,
        );
      }
    }
  });

  it("apps/web builds with Vite and then generates dist/_headers; dev is Vite; there is no start script", () => {
    expect(webPkg.scripts.build).toMatch(
      /^vite build\s*&&\s*node\s+\S*scripts\/generate-web-headers\.mts\b/,
    );
    expect(webPkg.scripts.dev).toBe("vite");
    expect(webPkg.scripts.start).toBeUndefined();
    for (const [name, command] of Object.entries(webPkg.scripts)) {
      expect(command, name).not.toMatch(/\bnext\b/);
    }
  });
});

describe("TC-DEV-WEB-011-203 scripts/mock-web.mts --dry-run", () => {
  it("build: prints the mock flag and the web build command, runs nothing, exits 0", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: undefined },
    });
    expect(result.status).toBe(0);
    expect(result.lines).toEqual([
      "DRY-RUN mock-web build",
      "ENV VITE_UI_MOCK=1",
      "COMMAND pnpm --filter @off-r39x/web build",
    ]);
  });

  it("start: serves apps/web/dist on 127.0.0.1 through scripts/serve-web-dist.mts, default port 3100, --port overrides", () => {
    const def = runScript("mock-web.mts", ["start", "--dry-run"], {
      env: { APP_ENV: undefined },
    });
    expect(def.status).toBe(0);
    expect(linesStarting(def, "COMMAND ")).toEqual([
      "COMMAND node scripts/serve-web-dist.mts --port 3100 --host 127.0.0.1",
    ]);
    expect(linesStarting(def, "ENV ")).toEqual(["ENV VITE_UI_MOCK=1"]);
    const custom = runScript("mock-web.mts", ["start", "--port", "4123", "--dry-run"], {
      env: { APP_ENV: undefined },
    });
    expect(linesStarting(custom, "COMMAND ")).toEqual([
      "COMMAND node scripts/serve-web-dist.mts --port 4123 --host 127.0.0.1",
    ]);
  });

  it("refuses a production environment (APP_ENV=production): exit 1, ERROR line, no COMMAND", () => {
    for (const mode of ["build", "start"]) {
      const result = runScript("mock-web.mts", [mode, "--dry-run"], {
        env: { APP_ENV: "production" },
      });
      expect(result.status, mode).toBe(1);
      expect(result.output).toMatch(/^ERROR mock-web-production/m);
      expect(linesStarting(result, "COMMAND ")).toEqual([]);
    }
  });

  it("does not use VERCEL_ENV as the production signal any more (APP_ENV is the only one)", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: undefined, VERCEL_ENV: "production" },
    });
    expect(result.status).toBe(0);
    expect(linesStarting(result, "COMMAND ")).toEqual([
      "COMMAND pnpm --filter @off-r39x/web build",
    ]);
  });

  it("allows a non-production APP_ENV (staging)", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: "staging" },
    });
    expect(result.status).toBe(0);
  });

  it("prints no other environment value", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: undefined, SYNTHETIC_SENTINEL_VALUE: "do-not-print-this-9f3a" },
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

// apps/web/vite.config.ts is loaded in a child process with plain node (type stripping); the default export is
// called the way Vite calls it: ({ command, mode }). The child prints the facts the assertions need.
const viteConfigUrl = pathToFileURL(join(REPO_ROOT, "apps", "web", "vite.config.ts")).href;

function callViteConfig(
  command: "build" | "serve",
  env: Record<string, string | undefined>,
): SpawnSyncReturns<string> {
  const program = [
    `const factory = (await import(${JSON.stringify(viteConfigUrl)})).default;`,
    `const config = await factory({ command: ${JSON.stringify(command)}, mode: ${JSON.stringify(command === "build" ? "production" : "development")} });`,
    'console.log("CONFIG-OK");',
    'console.log("FLAG=" + (process.env.VITE_UI_MOCK ?? "unset"));',
    'console.log("SOURCEMAP=" + String(config?.build?.sourcemap));',
    'console.log("OUTDIR=" + String(config?.build?.outDir));',
  ].join("\n");
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
    { encoding: "utf8", env: merged as NodeJS.ProcessEnv, timeout: 60_000, cwd: REPO_ROOT },
  );
}

describe("TC-DEV-WEB-011-201 a production-environment build with the mock flag on fails (guard in apps/web/vite.config.ts)", () => {
  it("throws the UI mock error for VITE_UI_MOCK=1 with APP_ENV=production", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: "production" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/UI mock mode must not be enabled in a production build/);
    expect(r.stdout).not.toContain("CONFIG-OK");
  });

  it("also refuses to start the dev server in a production environment with the flag on", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: "1", APP_ENV: "production" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/UI mock mode must not be enabled in a production build/);
  });

  it("loads for staging with the flag, and for production without the flag", () => {
    expect(callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: "staging" }).stdout).toContain(
      "CONFIG-OK",
    );
    expect(
      callViteConfig("build", { VITE_UI_MOCK: undefined, APP_ENV: "production" }).stdout,
    ).toContain("CONFIG-OK");
  });

  it("does not honour the former variables: VERCEL_ENV=production does not stop the flag, NEXT_PUBLIC_UI_MOCK is not the flag", () => {
    expect(
      callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: undefined, VERCEL_ENV: "production" })
        .stdout,
    ).toContain("CONFIG-OK");
    expect(
      callViteConfig("build", {
        VITE_UI_MOCK: undefined,
        NEXT_PUBLIC_UI_MOCK: "1",
        APP_ENV: "production",
      }).stdout,
    ).toContain("CONFIG-OK");
  });

  it("publishes no source map and builds into dist (SEC-WEB-011)", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: undefined, APP_ENV: "staging" });
    expect(r.stdout).toContain("SOURCEMAP=false");
    expect(r.stdout).toContain("OUTDIR=dist");
  });
});

describe("TC-DEV-WEB-011-204 the dev server enables the mock by default, a build never does (DEV-WEB-011)", () => {
  it("serve with VITE_UI_MOCK unset sets it to 1 for the process", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: undefined });
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=1");
  });

  it("serve keeps an explicit 0", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: "0", APP_ENV: undefined });
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=0");
  });

  it("build leaves an unset flag unset (fail closed)", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: undefined, APP_ENV: undefined });
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=unset");
  });
});
