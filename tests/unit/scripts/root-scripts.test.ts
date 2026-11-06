import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isUiMockAppEnv } from "../../../apps/web/src/config/ui-mock.ts";
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

// APP_ENV is the only environment signal (INF-ENV-001). A UI mock build needs an explicit development / staging / test;
// only `start` (which builds nothing) lets an unset APP_ENV through. Empty-string values are covered by the pure
// function tests (TC-DEV-WEB-011-003) because child-process handling of "" differs between operating systems.
const MOCK_WEB_APP_ENV_INVALID_LINE =
  /^ERROR mock-web-app-env-invalid APP_ENV must be development, staging or test\r?$/m;

describe("TC-DEV-WEB-011-203 scripts/mock-web.mts --dry-run", () => {
  it("build: prints the mock flag, the resolved APP_ENV and the web build command, runs nothing, exits 0", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: "development" },
    });
    expect(result.status).toBe(0);
    expect(result.lines).toEqual([
      "DRY-RUN mock-web build",
      "ENV VITE_UI_MOCK=1",
      "ENV APP_ENV=development",
      "COMMAND pnpm --filter @off-r39x/web build",
    ]);
  });

  it("start: serves apps/web/dist on 127.0.0.1 through scripts/serve-web-dist.mts, default port 3100, --port overrides", () => {
    const def = runScript("mock-web.mts", ["start", "--dry-run"], {
      env: { APP_ENV: "development" },
    });
    expect(def.status).toBe(0);
    expect(linesStarting(def, "COMMAND ")).toEqual([
      "COMMAND node scripts/serve-web-dist.mts --port 3100 --host 127.0.0.1",
    ]);
    expect(linesStarting(def, "ENV ")).toEqual(["ENV VITE_UI_MOCK=1", "ENV APP_ENV=development"]);
    const custom = runScript("mock-web.mts", ["start", "--port", "4123", "--dry-run"], {
      env: { APP_ENV: "development" },
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

  it("does not use VERCEL_ENV as the production signal, and it cannot stand in for APP_ENV", () => {
    const allowed = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: "development", VERCEL_ENV: "production" },
    });
    expect(allowed.status).toBe(0);
    expect(linesStarting(allowed, "COMMAND ")).toEqual([
      "COMMAND pnpm --filter @off-r39x/web build",
    ]);
    const missing = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: undefined, VERCEL_ENV: "development" },
    });
    expect(missing.status).toBe(1);
    expect(linesStarting(missing, "COMMAND ")).toEqual([]);
  });

  it("allows a non-production APP_ENV (staging)", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: "staging" },
    });
    expect(result.status).toBe(0);
  });

  it("prints no other environment value", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: "development", SYNTHETIC_SENTINEL_VALUE: "do-not-print-this-9f3a" },
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
      const result = runScript("mock-web.mts", [...args, "--dry-run"], {
        env: { APP_ENV: "development" },
      });
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.output).toMatch(/USAGE/);
    }
  });
});

describe("TC-DEV-WEB-011-207 scripts/mock-web.mts resolves APP_ENV fail closed (INF-ENV-001)", () => {
  it.each(["development", "staging", "test"])(
    "build --dry-run with an explicit APP_ENV=%s prints that value and the build command",
    (appEnv) => {
      const result = runScript("mock-web.mts", ["build", "--dry-run"], {
        env: { APP_ENV: appEnv },
      });
      expect(result.status).toBe(0);
      expect(linesStarting(result, "ENV ")).toEqual([
        "ENV VITE_UI_MOCK=1",
        `ENV APP_ENV=${appEnv}`,
      ]);
      expect(linesStarting(result, "COMMAND ")).toEqual([
        "COMMAND pnpm --filter @off-r39x/web build",
      ]);
    },
  );

  it("build --dry-run with APP_ENV unset fails (a build is never given a default): exit 1, the ERROR line, no ENV and no COMMAND line", () => {
    const result = runScript("mock-web.mts", ["build", "--dry-run"], {
      env: { APP_ENV: undefined },
    });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(MOCK_WEB_APP_ENV_INVALID_LINE);
    expect(linesStarting(result, "ENV ")).toEqual([]);
    expect(linesStarting(result, "COMMAND ")).toEqual([]);
  });

  it.each([" test", "Test", "dev", "prod", "prod-sentinel-7c1e", "staging ", "Production"])(
    "build and start --dry-run refuse APP_ENV=%j: exit 1, the ERROR line, no COMMAND",
    (appEnv) => {
      for (const mode of ["build", "start"]) {
        const result = runScript("mock-web.mts", [mode, "--dry-run"], {
          env: { APP_ENV: appEnv },
        });
        expect(result.status, `${mode} ${appEnv}`).toBe(1);
        expect(result.output, `${mode} ${appEnv}`).toMatch(MOCK_WEB_APP_ENV_INVALID_LINE);
        expect(linesStarting(result, "COMMAND "), `${mode} ${appEnv}`).toEqual([]);
      }
    },
  );

  it("start --dry-run with APP_ENV unset passes (nothing is built) and gives no default: only the flag line", () => {
    const result = runScript("mock-web.mts", ["start", "--dry-run"], {
      env: { APP_ENV: undefined },
    });
    expect(result.status).toBe(0);
    expect(result.lines).toEqual([
      "DRY-RUN mock-web start",
      "ENV VITE_UI_MOCK=1",
      "COMMAND node scripts/serve-web-dist.mts --port 3100 --host 127.0.0.1",
    ]);
  });

  it.each(["development", "staging", "test"])(
    "start --dry-run with an explicit APP_ENV=%s keeps that value (never overwritten)",
    (appEnv) => {
      const result = runScript("mock-web.mts", ["start", "--dry-run"], {
        env: { APP_ENV: appEnv },
      });
      expect(result.status).toBe(0);
      expect(linesStarting(result, "ENV ")).toEqual([
        "ENV VITE_UI_MOCK=1",
        `ENV APP_ENV=${appEnv}`,
      ]);
    },
  );

  it("the allow list of mock-web.mts (ALLOWED_APP_ENVS) is the same set that isUiMockAppEnv accepts in ui-mock.ts", () => {
    const source = readFileSync(join(REPO_ROOT, "scripts", "mock-web.mts"), "utf8");
    const literal = /const\s+ALLOWED_APP_ENVS\b[^=]*=\s*\[([^\]]*)\]/.exec(source);
    expect(literal, "ALLOWED_APP_ENVS array literal").not.toBeNull();
    const fromScript = [...(literal?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(fromScript.length).toBeGreaterThan(0);
    // Every name the script allows is accepted by the web guard ...
    for (const name of fromScript) expect(isUiMockAppEnv(name), name).toBe(true);
    // ... and no name the web guard accepts is missing from the script: probe the canonical names, the aliases and
    // the malformed spellings used by the other cases, plus the script's own names.
    const probes = [
      ...fromScript,
      "development",
      "staging",
      "test",
      "production",
      "Development",
      "STAGING",
      "Test",
      " development",
      "development ",
      "test\n",
      "dev",
      "develop",
      "stage",
      "stg",
      "prod",
      "prd",
      "local",
      "preview",
      "ci",
    ];
    const acceptedByWeb = [...new Set(probes.filter((value) => isUiMockAppEnv(value)))].sort();
    expect([...new Set(fromScript)].sort()).toEqual(acceptedByWeb);
  });

  it("never prints the offending value, even a synthetic sentinel, on stdout or stderr", () => {
    const sentinel = "prod-sentinel-7c1e";
    for (const mode of ["build", "start"]) {
      const result = runScript("mock-web.mts", [mode, "--dry-run"], { env: { APP_ENV: sentinel } });
      expect(result.status, mode).toBe(1);
      expect(result.stdout, mode).not.toContain(sentinel);
      expect(result.stderr, mode).not.toContain(sentinel);
    }
  });

  it("argument errors (exit 2, USAGE) are reported before the APP_ENV check", () => {
    for (const args of [["bogus"], ["build", "--bogus"], ["start", "--port", "70000"], []]) {
      const result = runScript("mock-web.mts", [...args, "--dry-run"], {
        env: { APP_ENV: "prod" },
      });
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.output).toMatch(/USAGE/);
      expect(result.output).not.toMatch(/mock-web-app-env-invalid/);
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
    'console.log("DEFINE_APP_ENV=" + String(config?.define?.["import.meta.env.APP_ENV"]));',
    'console.log("PROCESS_APP_ENV=" + (process.env.APP_ENV ?? "unset"));',
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
      callViteConfig("build", {
        VITE_UI_MOCK: "1",
        APP_ENV: "development",
        VERCEL_ENV: "production",
      }).stdout,
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

const VITE_MSG_UNSET = "(APP_ENV is unset)";
const VITE_MSG_INVALID = "(APP_ENV is not one of them)";

describe("TC-DEV-WEB-011-205 a build with the mock flag on fails closed unless APP_ENV is development, staging or test (guard in apps/web/vite.config.ts)", () => {
  it("fails when APP_ENV is unset: non-zero exit, the 'unset' message, no CONFIG-OK", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: undefined });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(VITE_MSG_UNSET);
    expect(r.stdout).not.toContain("CONFIG-OK");
  });

  it("does not let the former VERCEL_ENV stand in for a missing APP_ENV", () => {
    const r = callViteConfig("build", {
      VITE_UI_MOCK: "1",
      APP_ENV: undefined,
      VERCEL_ENV: "development",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(VITE_MSG_UNSET);
  });

  it.each(["development", "staging", "test"])(
    "loads for APP_ENV=%s and embeds exactly that name",
    (appEnv) => {
      const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: appEnv });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("CONFIG-OK");
      expect(r.stdout).toContain(`DEFINE_APP_ENV=${JSON.stringify(appEnv)}`);
    },
  );

  it.each([" staging", "staging ", "Staging", "TEST", "dev", "prod", "Production", "local"])(
    "fails for APP_ENV=%j (exact, case-sensitive, not trimmed, no alias)",
    (appEnv) => {
      const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: appEnv });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(VITE_MSG_INVALID);
      expect(r.stdout).not.toContain("CONFIG-OK");
    },
  );

  it("fails for APP_ENV=production with the production message", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: "production" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("(APP_ENV=production)");
  });

  it("never puts the offending value in stdout or stderr", () => {
    const sentinel = "prod-sentinel-7c1e";
    const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: sentinel });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(VITE_MSG_INVALID);
    expect(r.stderr).not.toContain(sentinel);
    expect(r.stdout).not.toContain(sentinel);
  });

  it("does not apply when the mock is off: a build without the flag loads with APP_ENV unset or malformed", () => {
    for (const appEnv of [undefined, "prod", "Production"]) {
      const r = callViteConfig("build", { VITE_UI_MOCK: undefined, APP_ENV: appEnv });
      expect(r.status, String(appEnv)).toBe(0);
      expect(r.stdout).toContain("CONFIG-OK");
      expect(r.stdout).toContain("FLAG=unset");
    }
    const off = callViteConfig("build", { VITE_UI_MOCK: "0", APP_ENV: "prod" });
    expect(off.stdout).toContain("CONFIG-OK");
  });

  it("the dev server fails closed for an explicit malformed APP_ENV (the flag defaults to 1 there)", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: "prod" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(VITE_MSG_INVALID);
    expect(r.stdout).not.toContain("CONFIG-OK");
    const explicit = callViteConfig("serve", { VITE_UI_MOCK: "1", APP_ENV: "Development" });
    expect(explicit.status).not.toBe(0);
    expect(explicit.stderr).toContain(VITE_MSG_INVALID);
  });
});

describe("TC-DEV-WEB-011-206 the dev server defaults APP_ENV to development only when it is unset; a build never gets a default", () => {
  it("serve with APP_ENV unset loads, enables the mock, and embeds development", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: undefined });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=1");
    expect(r.stdout).toContain('DEFINE_APP_ENV="development"');
  });

  it("serve does not write the default into process.env: APP_ENV stays unset for anything loaded later in the same process", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: undefined });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('DEFINE_APP_ENV="development"');
    expect(r.stdout).toContain("PROCESS_APP_ENV=unset");
  });

  it("an explicit APP_ENV is left as it was in process.env", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: "staging" });
    expect(r.stdout).toContain("PROCESS_APP_ENV=staging");
  });

  it("a serve config read first does not give a later build config a default (same process)", () => {
    const program = [
      `const factory = (await import(${JSON.stringify(viteConfigUrl)})).default;`,
      'await factory({ command: "serve", mode: "development" });',
      "try {",
      '  process.env.VITE_UI_MOCK = "1";',
      '  await factory({ command: "build", mode: "production" });',
      '  console.log("BUILD-OK");',
      "} catch (error) {",
      '  console.log("BUILD-FAILED " + (error instanceof Error ? error.message : ""));',
      "}",
    ].join("\n");
    const merged: Record<string, string | undefined> = {
      ...process.env,
      VITE_UI_MOCK: undefined,
      APP_ENV: undefined,
    };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    const r = spawnSync(
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
    expect(r.stdout).toContain("BUILD-FAILED");
    expect(r.stdout).toContain("(APP_ENV is unset)");
    expect(r.stdout).not.toContain("BUILD-OK");
  });

  it.each(["staging", "test"])("serve keeps an explicit APP_ENV=%s (not overwritten)", (appEnv) => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: appEnv });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("FLAG=1");
    expect(r.stdout).toContain(`DEFINE_APP_ENV=${JSON.stringify(appEnv)}`);
  });

  it("serve does not turn an explicit production into the default: it fails with the production message", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: undefined, APP_ENV: "production" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("(APP_ENV=production)");
    expect(r.stdout).not.toContain("CONFIG-OK");
  });

  it("serve with the mock explicitly off and APP_ENV unset still loads (the guard applies to an enabled mock)", () => {
    const r = callViteConfig("serve", { VITE_UI_MOCK: "0", APP_ENV: undefined });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=0");
  });

  it("build with the flag unset and APP_ENV unset loads and embeds an empty name (no default for a build)", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: undefined, APP_ENV: undefined });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CONFIG-OK");
    expect(r.stdout).toContain("FLAG=unset");
    expect(r.stdout).toContain('DEFINE_APP_ENV=""');
  });

  it("build with the flag on and APP_ENV unset gets no default either: it fails", () => {
    const r = callViteConfig("build", { VITE_UI_MOCK: "1", APP_ENV: undefined });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("CONFIG-OK");
  });
});
