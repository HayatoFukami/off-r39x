// DEV-WEB-011: cross-platform UI mock build / start. The mock flag is set only in the child environment, and the
// launcher fails closed on APP_ENV (INF-ENV-001; the variable is this repository's choice under DEV-AI-003):
//   - production is refused (ERROR mock-web-production);
//   - `build` needs APP_ENV to be exactly development, staging or test: unset or any other value is refused
//     (ERROR mock-web-app-env-invalid). No default is given, so a build never gets an environment name by accident;
//   - `start` builds nothing, so an unset APP_ENV passes (no default is passed on); a set value must be allowed.
// The value is never printed. A valid APP_ENV is passed to the child unchanged.
// `build` runs the web build (Vite, then dist/_headers); `start` serves apps/web/dist with scripts/serve-web-dist.mts.
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]
import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "USAGE node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]";
const DEFAULT_PORT = 3100;
const HOST = "127.0.0.1";
const BUILD_COMMAND = "pnpm --filter @off-r39x/web build";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Kept here on purpose (no import from apps/web); a unit test checks they match apps/web/src/config/ui-mock.ts.
const ALLOWED_APP_ENVS: readonly string[] = ["development", "staging", "test"];

interface Options {
  readonly mode: "build" | "start";
  readonly port: number;
  readonly dryRun: boolean;
}

class CliExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super("exit");
    this.code = code;
  }
}

function runCli(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    process.exitCode = error.code;
  }
}

function fail(message: string, code: number): never {
  writeSync(2, `${message}\n`);
  throw new CliExit(code);
}

function parseArgs(argv: readonly string[]): Options {
  let mode: string | undefined;
  let port = DEFAULT_PORT;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--port") {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || !/^\d+$/.test(value)) fail(USAGE, 2);
      port = Number(value);
      if (port < 1 || port > 65535) fail(USAGE, 2);
    } else if (arg.startsWith("-") || mode !== undefined) {
      fail(USAGE, 2);
    } else {
      mode = arg;
    }
  }
  if (mode !== "build" && mode !== "start") fail(USAGE, 2);
  return { mode, port, dryRun };
}

function serveArgs(options: Options): string[] {
  return ["scripts/serve-web-dist.mts", "--port", String(options.port), "--host", HOST];
}

function commandFor(options: Options): string {
  return options.mode === "build" ? BUILD_COMMAND : `node ${serveArgs(options).join(" ")}`;
}

/** Returns the APP_ENV to pass to the child, or undefined to pass nothing (`start` with APP_ENV unset). */
function resolveAppEnv(options: Options): string | undefined {
  const appEnv = process.env.APP_ENV;
  if (appEnv === "production") {
    fail("ERROR mock-web-production UI mock must not be enabled in a production environment", 1);
  }
  if (appEnv === undefined && options.mode === "start") return undefined;
  if (appEnv === undefined || !ALLOWED_APP_ENVS.includes(appEnv)) {
    fail("ERROR mock-web-app-env-invalid APP_ENV must be development, staging or test", 1);
  }
  return appEnv;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const appEnv = resolveAppEnv(options);
  const command = commandFor(options);
  if (options.dryRun) {
    const appEnvLine = appEnv === undefined ? "" : `ENV APP_ENV=${appEnv}\n`;
    process.stdout.write(
      `DRY-RUN mock-web ${options.mode}\nENV VITE_UI_MOCK=1\n${appEnvLine}COMMAND ${command}\n`,
    );
    return;
  }
  const env = { ...process.env, VITE_UI_MOCK: "1" };
  const result =
    options.mode === "build"
      ? spawnSync(command, { stdio: "inherit", shell: true, env })
      : spawnSync(process.execPath, serveArgs(options), { stdio: "inherit", cwd: REPO_ROOT, env });
  process.exitCode = result.status ?? 1;
}

runCli(main);
