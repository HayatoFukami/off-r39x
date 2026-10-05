// DEV-WEB-011: cross-platform UI mock build / start. The mock flag is set only in the child environment,
// and a production deployment environment is refused (the flag must never reach a production build).
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]
import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";

const USAGE = "USAGE node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]";
const DEFAULT_PORT = 3100;

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

function commandFor(options: Options): string {
  return options.mode === "build"
    ? "pnpm --filter @off-r39x/web build"
    : `pnpm --filter @off-r39x/web exec next start -p ${options.port} -H 127.0.0.1`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (process.env.VERCEL_ENV === "production") {
    fail("ERROR mock-web-production UI mock must not be enabled in a production deployment", 1);
  }
  const command = commandFor(options);
  if (options.dryRun) {
    process.stdout.write(
      `DRY-RUN mock-web ${options.mode}\nENV NEXT_PUBLIC_UI_MOCK=1\nCOMMAND ${command}\n`,
    );
    return;
  }
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NEXT_PUBLIC_UI_MOCK: "1" },
  });
  process.exitCode = result.status ?? 1;
}

runCli(main);
