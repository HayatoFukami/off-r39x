// INF-DEP-001 / SPEC-180 §44: the OCI image is built from the same commit its git_sha names.
// The release commit is resolved once; that one sha selects both the build context (git archive)
// and the R39X_BUILD_GIT_SHA build argument. Real git runs against throwaway repositories.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  imageBuildCommands,
  resolveReleaseCommit,
  runImageBuild,
} from "../../scripts/build-backend-image.mts";
import { createFixtureRoot, REPO_ROOT, removeFixtureRoot } from "../harness/fixture-repo.ts";

const SHA_A = "0123456789abcdef0123456789abcdef01234567";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureRoot(root);
});

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
      "tag.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function repoWithTwoCommits(): { root: string; first: string; second: string } {
  const root = createFixtureRoot({ "README.md": "one\n" });
  roots.push(root);
  git(root, "init", "--quiet");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "one");
  const first = git(root, "rev-parse", "HEAD");
  git(root, "tag", "-a", "-m", "synthetic release", "release-1");
  writeFileSync(join(root, "README.md"), "two\n");
  git(root, "commit", "--quiet", "-am", "two");
  return { root, first, second: git(root, "rev-parse", "HEAD") };
}

describe("TC-INF-DEP-001-007 one resolved commit selects the context and the build argument", () => {
  it("resolves a revision once to a 40-hex commit, peeling annotated tags", () => {
    const { root, first, second } = repoWithTwoCommits();
    expect(resolveReleaseCommit(root, "HEAD")).toBe(second);
    expect(resolveReleaseCommit(root, second)).toBe(second);
    expect(resolveReleaseCommit(root, "release-1")).toBe(first);
    expect(resolveReleaseCommit(root, "HEAD~1")).toBe(first);
  });

  it("rejects an unknown revision, an empty one and an option-shaped one", () => {
    const { root } = repoWithTwoCommits();
    expect(() => resolveReleaseCommit(root, "no-such-ref")).toThrow(/not a commit/);
    expect(() => resolveReleaseCommit(root, "")).toThrow(/--commit/);
    expect(() => resolveReleaseCommit(root, "--all")).toThrow(/--commit/);
  });

  it("archives and labels the same sha, and builds only from the archive on stdin", () => {
    const plan = imageBuildCommands(SHA_A, "r39x-backend:synthetic");
    expect(plan.archive).toEqual({
      command: "git",
      args: ["archive", "--format=tar", SHA_A],
    });
    expect(plan.build.command).toBe("docker");
    expect(plan.build.args).toEqual([
      "build",
      "--file",
      "infra/backend.Dockerfile",
      "--build-arg",
      `R39X_BUILD_GIT_SHA=${SHA_A}`,
      "--tag",
      "r39x-backend:synthetic",
      "-",
    ]);
    // The working tree (".") is never the context, so stale or dirty files cannot enter the image.
    expect(plan.build.args).not.toContain(".");
  });

  it("refuses to plan a build for anything but a 40-hex commit", () => {
    for (const value of ["HEAD", SHA_A.slice(0, 7), SHA_A.toUpperCase(), `${SHA_A} `]) {
      expect(() => imageBuildCommands(value, "r39x-backend:synthetic")).toThrow(/40-hex/);
    }
  });

  it("documents the script as the image build procedure", () => {
    const container = readFileSync(join(REPO_ROOT, "infra/backend.Dockerfile"), "utf8");
    const docs = readFileSync(join(REPO_ROOT, "docs/backend-foundation.md"), "utf8");
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["build:backend:image"]).toBe("node scripts/build-backend-image.mts");
    expect(container).toContain("pnpm build:backend:image --commit");
    expect(docs).toContain("pnpm build:backend:image --commit");
  });
});

describe("TC-INF-DEP-001-008 a failing side of the archive pipe ends the whole image build", () => {
  // Synthetic stand-ins for git archive / docker build; settling proves both children have ended.
  const node = (script: string) => ({ command: process.execPath, args: ["-e", script] });
  const endlessWriter = node(
    "const b=Buffer.alloc(65536,97);(function w(){while(process.stdout.write(b));process.stdout.once('drain',w)})()",
  );
  const waitForever = node("setInterval(()=>{},1000)");

  it("rejects and stops the archive when the build command cannot be started", async () => {
    // PR #80 review: with docker missing, the archive kept writing into a pipe nobody read.
    const plan = { archive: endlessWriter, build: { command: "r39x-no-such-docker", args: [] } };
    await expect(runImageBuild(plan, REPO_ROOT)).rejects.toThrow(
      /r39x-no-such-docker|docker build/,
    );
  }, 30_000);

  it("rejects and stops the archive when the build exits without reading the context", async () => {
    const plan = { archive: endlessWriter, build: node("process.exit(3)") };
    await expect(runImageBuild(plan, REPO_ROOT)).rejects.toThrow(/exited 3/);
  }, 30_000);

  it("rejects and stops the build when the archive fails", async () => {
    const plan = { archive: node("process.exit(4)"), build: waitForever };
    await expect(runImageBuild(plan, REPO_ROOT)).rejects.toThrow(/git archive exited 4/);
  }, 30_000);

  it("rejects when the archive command cannot be started", async () => {
    const plan = { archive: { command: "r39x-no-such-git", args: [] }, build: waitForever };
    await expect(runImageBuild(plan, REPO_ROOT)).rejects.toThrow(/git archive/);
  }, 30_000);

  it("resolves when the build consumes the whole archive and both exit 0", async () => {
    const plan = {
      archive: node("process.stdout.write('synthetic-context')"),
      build: node(
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(s==='synthetic-context'?0:9))",
      ),
    };
    await expect(runImageBuild(plan, REPO_ROOT)).resolves.toBeUndefined();
  }, 30_000);
});

it("TC-INF-DEP-001-009 the release image reinstalls dependencies from the archived lockfile", () => {
  // PR #80 review: a checkout build bundles whatever node_modules holds, which git status ignores,
  // so only the image path ties dependencies to git_sha. Pin that path and the docs that say so.
  const ignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8").split(/\r?\n/);
  expect(ignore).toEqual(expect.arrayContaining([".git", "**/node_modules", "dist"]));
  const container = readFileSync(join(REPO_ROOT, "infra/backend.Dockerfile"), "utf8");
  // The build stage ends where the runtime stage (the last FROM) begins.
  const buildStage = container.slice(0, container.lastIndexOf("\nFROM "));
  expect(buildStage).toContain(" AS build");
  const lines = buildStage.split(/\r?\n/).filter((line) => !line.startsWith("#"));
  const at = (line: string) => lines.indexOf(line);
  // One COPY of the (archived) context, then a frozen install, then the backend build.
  expect(lines.filter((line) => line.startsWith("COPY"))).toEqual(["COPY . ."]);
  expect(at("COPY . .")).toBeGreaterThan(-1);
  expect(at("COPY . .")).toBeLessThan(at("RUN pnpm install --frozen-lockfile"));
  expect(at("RUN pnpm install --frozen-lockfile")).toBeLessThan(at("RUN pnpm build:backend"));
  expect(buildStage).not.toMatch(/--offline|--prefer-offline|--no-frozen-lockfile/);
  const docs = readFileSync(join(REPO_ROOT, "docs/backend-foundation.md"), "utf8");
  expect(docs).toContain("祖先判定に使えるのは、`build:backend:image` で build した image");
  expect(docs).toContain("`clean` は git の source tree");
});
