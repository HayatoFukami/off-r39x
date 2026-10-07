import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Verification-phase gap tests for the layout shell (SPEC-050 24.3 design swappability, DEV-WEB-001).
// Static source checks only; behaviour is covered by the Playwright UI mock suite.

const webDir = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));
const rel = (file: string): string => relative(webDir, file).replaceAll("\\", "/");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const viewFiles = [
  ...walk(join(webDir, "app")),
  ...walk(join(webDir, "src/presentation")),
  ...walk(join(webDir, "src/features")),
  ...walk(join(webDir, "src/mock/dev-ui")),
].filter((f) => f.endsWith(".tsx"));

describe("TC-PG-PUB-001-506 components take colours from the design tokens only (SPEC-050 24.3)", () => {
  // Tailwind palette / literal colours bypass the @theme tokens, so a re-skin would miss them.
  const literalColour =
    /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
  const arbitraryColour = /(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch|var\(--color)/;
  it("has at least one view file to inspect", () => {
    expect(viewFiles.length).toBeGreaterThan(10);
  });
  for (const file of viewFiles) {
    it(`${rel(file)} uses no literal colour utility`, () => {
      const source = readFileSync(file, "utf8");
      expect(literalColour.exec(source)?.[0] ?? null, "literal colour").toBeNull();
      expect(arbitraryColour.exec(source)?.[0] ?? null, "arbitrary colour").toBeNull();
      expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(source.replace(/&#\d+;/g, ""))).toBe(false);
    });
  }
});
