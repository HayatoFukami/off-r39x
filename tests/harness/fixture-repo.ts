// Test harness only: throwaway fixture repositories for scripts/check-import-boundaries.mts.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BOUNDARY_SCRIPT = join(REPO_ROOT, "scripts", "check-import-boundaries.mts");

export type FileMap = Readonly<Record<string, string>>;

export function createFixtureRoot(files: FileMap): string {
  const root = mkdtempSync(join(tmpdir(), "r39x-boundary-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

export function removeFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export interface CheckResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly violations: readonly string[];
}

export function runBoundaryCheck(args: readonly string[], cwd?: string): CheckResult {
  const result = spawnSync(process.execPath, [BOUNDARY_SCRIPT, ...args], {
    cwd: cwd ?? REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  const stdout = result.stdout ?? "";
  return {
    status: result.status,
    stdout,
    stderr: result.stderr ?? "",
    violations: stdout.split(/\r?\n/).filter((line) => line.startsWith("VIOLATION ")),
  };
}

const pkg = (name: string, deps: readonly string[] = []): string =>
  JSON.stringify({
    name,
    version: "0.0.0",
    private: true,
    dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"])),
  });

export { pkg as packageJson };

/** A consistent tree in which every allowed edge is exercised. */
export function cleanFiles(): Record<string, string> {
  return {
    "apps/web/package.json": pkg("@off-r39x/web", ["@off-r39x/domain"]),
    "packages/domain/package.json": pkg("@off-r39x/domain"),
    "packages/domain/src/states.ts": 'export const A = ["X"] as const;\n',
    "packages/domain/src/index.ts": 'export * from "./states";\n',
    "apps/web/app/layout.tsx":
      'import { Badge } from "@/mock/dev-ui/mock-mode-badge";\nexport default Badge;\n',
    "apps/web/app/page.tsx":
      'import { Card } from "@/presentation/components/card";\nexport default Card;\n',
    "apps/web/app/dev/scenarios/page.tsx":
      'import { Panel } from "@/mock/dev-ui/scenario-panel";\nexport default Panel;\n',
    "apps/web/src/api-client/port.ts": "export interface ApiPort {}\n",
    "apps/web/src/api-client/types.ts": "export type Ref = string;\n",
    "apps/web/src/api-client/index.ts":
      'import { createMockApi } from "../mock/backend/mock-api";\nexport const create = createMockApi;\n',
    "apps/web/src/auth/port.ts": "export interface AuthPort {}\n",
    "apps/web/src/auth/continuation.ts": "export const x = 1;\n",
    "apps/web/src/auth/index.ts":
      'import { createMockAuth } from "@/mock/backend/mock-auth";\nexport const create = createMockAuth;\n',
    "apps/web/src/mock/backend/mock-api.ts":
      'import { db } from "./db";\nimport { seed } from "../backend/seed";\nexport const createMockApi = () => [db, seed];\n',
    "apps/web/src/mock/backend/mock-auth.ts": "export const createMockAuth = () => 1;\n",
    "apps/web/src/mock/backend/db.ts": "export const db = 1;\n",
    "apps/web/src/mock/backend/seed.ts": "export const seed = 1;\n",
    "apps/web/src/mock/dev-ui/mock-mode-badge.tsx": "export const Badge = () => null;\n",
    "apps/web/src/mock/dev-ui/scenario-panel.tsx": "export const Panel = () => null;\n",
    "apps/web/src/presentation/components/card.tsx": [
      'import type { ApiPort } from "@/api-client/port";',
      'import type { Ref } from "@/api-client/types";',
      'import type { AuthPort } from "@/auth/port";',
      'import { x } from "@/auth/continuation";',
      'import { A } from "@off-r39x/domain";',
      'import { useState } from "react";',
      "export const Card = (p: [ApiPort, Ref, AuthPort, typeof x, typeof A, typeof useState]) => p;",
      "",
    ].join("\n"),
    "apps/web/src/features/cart/cart-store.ts": [
      'import { Card } from "../../presentation/components/card";',
      'import type { ApiPort } from "@/api-client/port";',
      "export const s = [Card, null as unknown as ApiPort];",
      "",
    ].join("\n"),
  };
}

export function withFiles(extra: FileMap): Record<string, string> {
  return { ...cleanFiles(), ...extra };
}

/** Builds a file whose import statement is on a known 1-based line. */
export function importAtLine(line: number, statement: string): string {
  const filler = Array.from({ length: line - 1 }, (_, i) => `// filler ${i + 1}`);
  return `${[...filler, statement].join("\n")}\nexport const used = 1;\n`;
}
