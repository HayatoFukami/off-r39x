// INF-DEP-001 / SPEC-180 §44: build the backend OCI image from exactly the commit its git_sha names.
// Usage: node scripts/build-backend-image.mts --commit <tested revision> [--tag <image tag>]
//
// The revision is resolved once to a 40-hex commit. `git archive <sha>` is streamed to
// `docker build -` as the only build context, and the same sha is passed as R39X_BUILD_GIT_SHA,
// so the recorded git_sha cannot name a different tree than the one built. The working tree is
// never the context: stale or uncommitted files cannot enter the image.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
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

/** Resolves with a failure message, or undefined after a zero exit; never before the child ends. */
function settle(child: ChildProcess, label: string): Promise<string | undefined> {
  return new Promise((done) => {
    let failure: string | undefined;
    child.once("error", (error) => {
      failure ??= `${label}: ${error.message}`;
      if (child.pid === undefined) done(failure); // never started: no process to wait for
    });
    child.once("close", (code, signal) => {
      done(failure ?? (code === 0 ? undefined : `${label} exited ${code ?? signal}`));
    });
  });
}

/**
 * Stream the archive into the build. A failure on either side stops the other child (a build
 * that cannot start or stops reading must not leave the archive blocked on a full pipe), and the
 * returned promise settles only after both children have ended, with the first failure.
 */
export async function runImageBuild(plan: ImageBuildPlan, cwd: string): Promise<void> {
  const archive = spawn(plan.archive.command, [...plan.archive.args], {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const build = spawn(plan.build.command, [...plan.build.args], {
    cwd,
    stdio: ["pipe", "inherit", "inherit"],
  });
  // EPIPE and similar stream errors are reported through the children's exit status instead.
  archive.stdout.on("error", () => {});
  build.stdin.on("error", () => {});
  archive.stdout.pipe(build.stdin);
  let first: string | undefined;
  const stopArchive = () => {
    archive.stdout.unpipe();
    archive.stdout.destroy();
    archive.kill();
  };
  const stopBuild = () => {
    build.stdin.destroy();
    build.kill();
  };
  const watch = (child: ChildProcess, label: string, stopOther: () => void) =>
    settle(child, label).then((failure) => {
      if (failure !== undefined) {
        first ??= failure;
        stopOther();
      }
    });
  await Promise.all([
    watch(archive, "git archive", stopBuild),
    watch(build, "docker build", stopArchive),
  ]);
  if (first !== undefined) throw new Error(first);
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { commit, tag } = parseArgs(process.argv.slice(2));
  const sha = resolveReleaseCommit(root, commit);
  const plan = imageBuildCommands(sha, tag ?? `r39x-backend:${sha}`);
  await runImageBuild(plan, root);
  process.stdout.write(`OK backend image ${tag ?? `r39x-backend:${sha}`} from ${sha}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
