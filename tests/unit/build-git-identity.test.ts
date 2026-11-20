// INF-DEP-001 / SPEC-180 §44: the backend build records the 40-hex git commit it was built from.
// Real git runs against throwaway repositories; no repository state of this checkout is read.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuildGitIdentity } from "../../scripts/build-git-identity.mts";
import { createFixtureRoot, REPO_ROOT, removeFixtureRoot } from "../harness/fixture-repo.ts";

const SHA_A = "0123456789abcdef0123456789abcdef01234567";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureRoot(root);
});

function plainDir(files: Record<string, string> = { "README.md": "synthetic\n" }): string {
  const root = createFixtureRoot(files);
  roots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Synthetic Test",
      "-c",
      "user.email=synthetic@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A committed checkout with an ignored dist/ directory, like this repository. */
function committedRepo(): { root: string; head: string } {
  const root = plainDir({ "README.md": "synthetic\n", ".gitignore": "dist/\n" });
  git(root, "init", "--quiet");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "synthetic");
  return { root, head: git(root, "rev-parse", "HEAD") };
}

describe("TC-INF-DEP-001-002 git checkout source", () => {
  it("records HEAD as git_sha with a clean tree state", () => {
    const { root, head } = committedRepo();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(resolveBuildGitIdentity(root, {})).toEqual({
      git_sha: head,
      git_tree_state: "clean",
    });
  });

  it("accepts R39X_BUILD_GIT_SHA only when it names the checked-out HEAD", () => {
    const { root, head } = committedRepo();
    expect(resolveBuildGitIdentity(root, { R39X_BUILD_GIT_SHA: head })).toEqual({
      git_sha: head,
      git_tree_state: "clean",
    });
  });

  it("ignores gitignored build output when judging the tree state", () => {
    const { root, head } = committedRepo();
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "backend-build.json"), "{}\n");
    expect(resolveBuildGitIdentity(root, {})).toEqual({
      git_sha: head,
      git_tree_state: "clean",
    });
  });
});

describe("TC-INF-DEP-001-003 uncommitted changes are recorded as dirty", () => {
  it("marks a modified tracked file as dirty and keeps HEAD as git_sha", () => {
    const { root, head } = committedRepo();
    writeFileSync(join(root, "README.md"), "changed\n");
    expect(resolveBuildGitIdentity(root, {})).toEqual({
      git_sha: head,
      git_tree_state: "dirty",
    });
  });

  it("marks an untracked, non-ignored file as dirty", () => {
    const { root, head } = committedRepo();
    writeFileSync(join(root, "extra.ts"), "export const x = 1;\n");
    expect(resolveBuildGitIdentity(root, {})).toEqual({
      git_sha: head,
      git_tree_state: "dirty",
    });
  });

  it("marks a staged but uncommitted change as dirty", () => {
    const { root, head } = committedRepo();
    writeFileSync(join(root, "README.md"), "staged\n");
    git(root, "add", "README.md");
    expect(resolveBuildGitIdentity(root, {})).toEqual({
      git_sha: head,
      git_tree_state: "dirty",
    });
  });
});

describe("TC-INF-DEP-001-004 build argument source without a git checkout", () => {
  it("records R39X_BUILD_GIT_SHA with an unverified tree state when no .git exists", () => {
    const root = plainDir();
    expect(resolveBuildGitIdentity(root, { R39X_BUILD_GIT_SHA: SHA_A })).toEqual({
      git_sha: SHA_A,
      git_tree_state: "unverified",
    });
  });

  it("treats a missing git executable like a directory without .git", () => {
    const root = plainDir();
    expect(
      resolveBuildGitIdentity(
        root,
        { R39X_BUILD_GIT_SHA: SHA_A },
        { gitExecutable: join(root, "no-such-git") },
      ),
    ).toEqual({ git_sha: SHA_A, git_tree_state: "unverified" });
    expect(() =>
      resolveBuildGitIdentity(root, {}, { gitExecutable: join(root, "no-such-git") }),
    ).toThrow(/R39X_BUILD_GIT_SHA/);
  });

  it("does not borrow the HEAD of an enclosing repository", () => {
    const { root: parent } = committedRepo();
    const nested = join(parent, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "file.txt"), "nested\n");
    expect(resolveBuildGitIdentity(nested, { R39X_BUILD_GIT_SHA: SHA_A })).toEqual({
      git_sha: SHA_A,
      git_tree_state: "unverified",
    });
    expect(() => resolveBuildGitIdentity(nested, {})).toThrow(/R39X_BUILD_GIT_SHA/);
  });
});

describe("TC-INF-DEP-001-005 fail closed when the commit cannot be identified", () => {
  it("rejects a build with neither a git checkout nor R39X_BUILD_GIT_SHA", () => {
    const root = plainDir();
    expect(() => resolveBuildGitIdentity(root, {})).toThrow(/R39X_BUILD_GIT_SHA/);
    expect(() => resolveBuildGitIdentity(root, { R39X_BUILD_GIT_SHA: "" })).toThrow(
      /R39X_BUILD_GIT_SHA/,
    );
  });

  it.each([
    ["uppercase", SHA_A.toUpperCase()],
    ["short", SHA_A.slice(0, 39)],
    ["long", `${SHA_A}0`],
    ["padded", ` ${SHA_A}`],
    ["trailing newline", `${SHA_A}\n`],
    ["abbreviated", SHA_A.slice(0, 7)],
    ["ref name", "HEAD"],
  ])("rejects a %s R39X_BUILD_GIT_SHA", (_label, value) => {
    const root = plainDir();
    expect(() => resolveBuildGitIdentity(root, { R39X_BUILD_GIT_SHA: value })).toThrow(
      /R39X_BUILD_GIT_SHA/,
    );
  });

  it("rejects R39X_BUILD_GIT_SHA that disagrees with the checked-out HEAD", () => {
    const { root, head } = committedRepo();
    expect(head).not.toBe(SHA_A);
    expect(() => resolveBuildGitIdentity(root, { R39X_BUILD_GIT_SHA: SHA_A })).toThrow(
      /does not match/,
    );
  });

  it("rejects a git repository that has no commit yet", () => {
    const root = plainDir();
    git(root, "init", "--quiet");
    expect(() => resolveBuildGitIdentity(root, {})).toThrow(/commit/);
  });
});

it("TC-INF-DEP-001-006 wires the git identity into backend-build.json and the OCI recipe", () => {
  const build = readFileSync(join(REPO_ROOT, "scripts/build-backend.mts"), "utf8");
  const identity = readFileSync(join(REPO_ROOT, "scripts/build-git-identity.mts"), "utf8");
  const container = readFileSync(join(REPO_ROOT, "infra/backend.Dockerfile"), "utf8");
  const workflow = readFileSync(
    join(REPO_ROOT, ".github/workflows/backend-foundation.yml"),
    "utf8",
  );
  // The identity is resolved before esbuild runs, so a build that cannot name its commit emits nothing.
  expect(build.indexOf("resolveBuildGitIdentity(root)")).toBeGreaterThan(-1);
  expect(build.indexOf("resolveBuildGitIdentity(root)")).toBeLessThan(
    build.indexOf("await build("),
  );
  expect(build).toContain("...gitIdentity");
  // The only environment value the build reads is the commit identity, never runtime config.
  expect(build).not.toContain("process.env");
  expect(identity.match(/process\.env(?:\.\w+|\[[^\]]*\])?/g)).toEqual([
    "process.env.R39X_BUILD_GIT_SHA",
  ]);
  // .dockerignore drops .git, so the image build receives the commit as a build argument.
  expect(container).toMatch(/^ARG R39X_BUILD_GIT_SHA$/m);
  expect(container.indexOf("ARG R39X_BUILD_GIT_SHA")).toBeLessThan(
    container.indexOf("pnpm build:backend"),
  );
  expect(workflow).toContain("dist/backend-build.json");
});
