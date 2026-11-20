// INF-DEP-001 / SPEC-180 §44: name the 40-hex git commit a backend artifact was built from.
// Decided under DEV-AI-003 (build tooling only; the §44 release manifest is not generated here).
//
// Sources, in order:
// - A git checkout whose top level is the build root: HEAD, plus whether the tree has changes.
// - R39X_BUILD_GIT_SHA, for a build context without .git (the OCI build: .dockerignore drops .git).
//   When both exist they must agree.
// Neither, a malformed value or a disagreement fails the build: an artifact that cannot name its
// commit is never emitted.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * - `clean`: built from a git checkout of `git_sha` with no tracked, staged or untracked change.
 * - `dirty`: built from a git checkout with changes on top of `git_sha`; not a build of that commit.
 * - `unverified`: `git_sha` came from the build argument; the tree could not be inspected.
 */
export type GitTreeState = "clean" | "dirty" | "unverified";

export interface BuildGitIdentity {
  readonly git_sha: string;
  readonly git_tree_state: GitTreeState;
}

export interface BuildGitEnv {
  readonly R39X_BUILD_GIT_SHA?: string | undefined;
}

export interface ResolveOptions {
  /** Test seam: the git executable to run (default `git` from PATH). */
  readonly gitExecutable?: string;
}

const SHA = /^[0-9a-f]{40}$/;
const VARIABLE = "R39X_BUILD_GIT_SHA";

export function resolveBuildGitIdentity(
  root: string,
  env: BuildGitEnv = { R39X_BUILD_GIT_SHA: process.env.R39X_BUILD_GIT_SHA },
  options: ResolveOptions = {},
): BuildGitIdentity {
  const provided = readProvidedSha(env);
  const checkout = readCheckout(root, options.gitExecutable ?? "git");
  if (checkout === undefined) {
    if (provided === undefined) {
      throw new Error(
        `build git identity: ${root} is not the top level of a git checkout and ${VARIABLE} is unset; ` +
          `build from a git checkout or pass ${VARIABLE}=<40-hex commit>`,
      );
    }
    return { git_sha: provided, git_tree_state: "unverified" };
  }
  if (provided !== undefined && provided !== checkout.head) {
    throw new Error(
      `build git identity: ${VARIABLE} ${provided} does not match the checked-out HEAD ${checkout.head}`,
    );
  }
  return { git_sha: checkout.head, git_tree_state: checkout.dirty ? "dirty" : "clean" };
}

function readProvidedSha(env: BuildGitEnv): string | undefined {
  const value = env.R39X_BUILD_GIT_SHA;
  // An unset build argument reaches the build as an empty string; it names no commit.
  if (value === undefined || value === "") return undefined;
  if (!SHA.test(value)) {
    throw new Error(`build git identity: ${VARIABLE} must be a 40-character lowercase hex commit`);
  }
  return value;
}

interface Checkout {
  readonly head: string;
  readonly dirty: boolean;
}

function readCheckout(root: string, executable: string): Checkout | undefined {
  const top = runGit(executable, root, ["rev-parse", "--show-toplevel"]);
  // No git executable, no repository, or a repository that only encloses the build root.
  if (top === undefined || !samePath(top.trim(), root)) return undefined;
  const head = runGit(executable, root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const sha = head?.trim();
  if (sha === undefined || !SHA.test(sha)) {
    throw new Error(`build git identity: the git checkout at ${root} has no HEAD commit`);
  }
  const status = runGit(executable, root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status === undefined) {
    throw new Error(`build git identity: git status failed in ${root}`);
  }
  return { head: sha, dirty: status.trim() !== "" };
}

function runGit(executable: string, cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync(executable, [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return result.stdout;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const real = realpathSync.native(resolve(p));
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}
