// INF-DEP-001 / SPEC-180 §44: build the backend OCI image from exactly the commit its git_sha names.
// Usage: node scripts/build-backend-image.mts --commit <tested revision> [--tag <image tag>]
//
// The revision is resolved once to a 40-hex commit. `git archive <sha>` is streamed to
// `docker build -` as the only build context, and the same sha is passed as R39X_BUILD_GIT_SHA,
// so the recorded git_sha cannot name a different tree than the one built. The working tree is
// never the context: stale or uncommitted files cannot enter the image.
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = "USAGE node scripts/build-backend-image.mts --commit <revision> [--tag <image tag>]";
const SHA = /^[0-9a-f]{40}$/;

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

export interface ImageBuildPlan {
  readonly archive: Command;
  readonly build: Command;
}

/** Resolve a release revision (sha, tag, branch) to the 40-hex commit it names. */
export function resolveReleaseCommit(root: string, revision: string): string {
  if (revision === "" || revision.startsWith("-")) {
    throw new Error(
      `build backend image: --commit needs a revision, got ${JSON.stringify(revision)}`,
    );
  }
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const sha = result.status === 0 ? result.stdout.trim() : "";
  if (!SHA.test(sha)) {
    throw new Error(`build backend image: ${JSON.stringify(revision)} is not a commit in ${root}`);
  }
  return sha;
}

export function imageBuildCommands(sha: string, tag: string): ImageBuildPlan {
  if (!SHA.test(sha)) throw new Error("build backend image: the commit must be a 40-hex sha");
  return {
    archive: { command: "git", args: ["archive", "--format=tar", sha] },
    build: {
      command: "docker",
      args: [
        "build",
        "--file",
        "infra/backend.Dockerfile",
        "--build-arg",
        `R39X_BUILD_GIT_SHA=${sha}`,
        "--tag",
        tag,
        "-",
      ],
    },
  };
}

function parseArgs(argv: readonly string[]): { commit: string; tag: string | undefined } {
  let commit: string | undefined;
  let tag: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--commit" || flag === "--tag") && value !== undefined) {
      if (flag === "--commit") commit = value;
      else tag = value;
      i += 1;
      continue;
    }
    throw new Error(USAGE);
  }
  if (commit === undefined) throw new Error(USAGE);
  return { commit, tag };
}

function waitFor(child: ReturnType<typeof spawn>, label: string): Promise<void> {
  return new Promise((done, fail) => {
    child.once("error", (error) => fail(new Error(`${label}: ${error.message}`)));
    child.once("close", (code) =>
      code === 0 ? done() : fail(new Error(`${label} exited ${code ?? "by signal"}`)),
    );
  });
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { commit, tag } = parseArgs(process.argv.slice(2));
  const sha = resolveReleaseCommit(root, commit);
  const plan = imageBuildCommands(sha, tag ?? `r39x-backend:${sha}`);
  const archive = spawn(plan.archive.command, [...plan.archive.args], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const build = spawn(plan.build.command, [...plan.build.args], {
    cwd: root,
    stdio: [archive.stdout ?? "ignore", "inherit", "inherit"],
  });
  await Promise.all([waitFor(archive, "git archive"), waitFor(build, "docker build")]);
  process.stdout.write(`OK backend image ${tag ?? `r39x-backend:${sha}`} from ${sha}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
