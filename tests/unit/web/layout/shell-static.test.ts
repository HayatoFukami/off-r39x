import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the layout shell (tests/contracts/s3-layout.md sections 0, 4.1, 6, 7.4, 8, 9).
// These read source files only; behaviour is covered by the Playwright UI mock suite.

const webDir = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));
const abs = (path: string): string => join(webDir, path);
const read = (path: string): string =>
  existsSync(abs(path)) ? readFileSync(abs(path), "utf8") : "";
const rel = (file: string): string => relative(webDir, file).replaceAll("\\", "/");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = [...walk(abs("app")), ...walk(abs("src"))].filter((f) => /\.(ts|tsx|css)$/.test(f));

describe("TC-DEV-WEB-001-201 the S3 shell files exist at the contracted paths (SPEC-190 DEV-WEB-001, section 0)", () => {
  const required = [
    "src/config/site.ts",
    "src/config/assets.ts",
    "src/config/browser-storage.ts",
    "src/features/cart/cart-count.ts",
    "src/features/cart/use-cart-count.ts",
    "src/api-client/index.ts",
    "src/api-client/provider.tsx",
    "src/auth/index.ts",
    "src/auth/session-provider.tsx",
    "src/auth/use-session.ts",
    "src/presentation/layout/sponsor-area-model.ts",
    "src/presentation/layout/global-header.tsx",
    "src/presentation/layout/primary-nav.tsx",
    "src/presentation/layout/mobile-nav-drawer.tsx",
    "src/presentation/layout/account-menu.tsx",
    "src/presentation/layout/cart-link.tsx",
    "src/presentation/layout/global-footer.tsx",
    "src/presentation/layout/sponsor-logos.tsx",
    "src/presentation/components/ui/button.tsx",
    "src/presentation/components/ui/badge.tsx",
    "src/presentation/components/ui/dialog.tsx",
    "src/mock/dev-ui/scenario-panel.tsx",
    "src/mock/dev-ui/mock-mode-badge.tsx",
    "app/not-found.tsx",
    "app/error.tsx",
    "app/dev/layout.tsx",
    "app/dev/scenarios/page.tsx",
    "app/dev/error-probe/page.tsx",
  ];
  for (const path of required) {
    it(`has ${path}`, () => {
      expect(existsSync(abs(path)), path).toBe(true);
    });
  }

  it("declares the UI primitive dependencies (base-ui, clsx, tailwind-merge)", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    for (const name of ["@base-ui/react", "clsx", "tailwind-merge"]) {
      expect(Object.keys(pkg.dependencies ?? {}), name).toContain(name);
    }
  });
});

describe("TC-DEV-WEB-001-202 root layout wiring (contract section 4.1, DEV-WEB-012)", () => {
  const layout = read("app/layout.tsx");

  it("keeps the ja document and renders the single main landmark with the skip link target", () => {
    expect(layout).toMatch(/lang="ja"/);
    expect(layout).toMatch(/id="main-content"/);
    expect(layout).toMatch(/#main-content/);
  });

  it("wraps the app in the providers and the header, footer and mock badge", () => {
    expect(layout).toMatch(/ApiProvider/);
    expect(layout).toMatch(/SessionProvider/);
    expect(layout).toMatch(/MockModeBadge/);
  });

  it("imports mock code only for the MockModeBadge", () => {
    const mockImports = [...layout.matchAll(/from\s+["']([^"']*\/mock\/[^"']*)["']/g)].map(
      (m) => m[1] ?? "",
    );
    expect(mockImports.length).toBe(1);
    expect(mockImports[0]).toMatch(/mock\/dev-ui\/mock-mode-badge(\.tsx?)?$/);
  });

  it("is the only place that renders <main>: pages and system pages must not", () => {
    const pageLikes = walk(abs("app")).filter((f) => /(page|not-found|error)\.tsx$/.test(f));
    expect(pageLikes.length).toBeGreaterThan(2);
    for (const file of pageLikes)
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/<main[\s>]/);
  });
});

describe("TC-PG-XFN-002-202 not-found and error pages (SPEC-050 19.1, SEC-WEB-012)", () => {
  it("uses the shared copy for Not Found", () => {
    expect(read("app/not-found.tsx")).toMatch(/copy\.notFound/);
  });

  it("renders the error page from copy only and never from the error object", () => {
    const source = read("app/error.tsx");
    expect(source).toMatch(/^\s*["']use client["']/);
    expect(source).toMatch(/copy\.errorPage/);
    expect(source).not.toMatch(/\berror\s*\.\s*(message|stack|digest|name|cause)\b/);
    expect(source).not.toMatch(/\bconsole\s*\./);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("TC-DEV-WEB-012-102 dev area is guarded and kept out of general navigation (DEV-WEB-012)", () => {
  it("guards /dev/* with isDevAreaEnabled + notFound and marks it noindex", () => {
    const source = read("app/dev/layout.tsx");
    expect(source).toMatch(/isDevAreaEnabled/);
    expect(source).toMatch(/notFound\s*\(/);
    expect(source).toMatch(/robots/);
    expect(source).toMatch(/index:\s*false/);
  });

  it("makes the error probe throw during render with a synthetic marker", () => {
    const source = read("app/dev/error-probe/page.tsx");
    expect(source).toMatch(/^\s*["']use client["']/);
    expect(source).toMatch(/throw new Error\(/);
    expect(source).toMatch(/SENSITIVE-MARKER-9f3a/);
  });

  it("shows the mock badge only in mock mode", () => {
    expect(read("src/mock/dev-ui/mock-mode-badge.tsx")).toMatch(/isUiMockEnabled/);
  });

  it("does not link /admin, /staff or /dev from the shell (SPEC-050 27)", () => {
    const shell = sources.filter(
      (f) =>
        rel(f).startsWith("src/presentation/layout/") ||
        rel(f).startsWith("src/features/shell/") ||
        rel(f).startsWith("src/config/site"),
    );
    expect(shell.length).toBeGreaterThan(0);
    for (const file of shell) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /["'`]\/(admin|staff|dev)(\/|["'`?#])/i,
      );
    }
  });
});

describe("TC-DEV-WEB-001-203 design tokens and no external font (SPEC-050 24.3, SEC-WEB-004)", () => {
  const css = read("app/globals.css");
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

  it("defines the brand, tone, radius, font and hero gradient tokens in @theme", () => {
    expect(theme.length).toBeGreaterThan(0);
    const tokens = [
      "--color-brand",
      "--color-brand-foreground",
      ...["success", "pending", "failure", "neutral", "review"].flatMap((tone) => [
        `--color-tone-${tone}-bg`,
        `--color-tone-${tone}-fg`,
      ]),
      "--radius-base",
      "--font-sans",
      "--hero-gradient",
    ];
    for (const token of tokens) expect(theme, token).toMatch(new RegExp(`${token}\\s*:`));
  });

  it("makes the hero gradient a CSS gradient, not an image", () => {
    expect(/--hero-gradient\s*:\s*([^;]+);/.exec(theme)?.[1]?.trim() ?? "").toMatch(
      /^linear-gradient\(/,
    );
  });

  it("loads no web font and no external stylesheet / image from any source file", () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      expect(source, rel(file)).not.toMatch(/next\/font/);
      expect(source, rel(file)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      expect(source, rel(file)).not.toMatch(/@font-face/);
      expect(source, rel(file)).not.toMatch(/@import\s+url\(/);
      expect(source, rel(file)).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    }
  });
});

describe("TC-PG-PUB-001-231 sponsor placeholder assets are text-only SVG (SPEC-050 24.3, DEV-WEB-013)", () => {
  for (const key of ["alpha", "bravo", "charlie"]) {
    it(`has a safe public/mock/sponsors/${key}.svg`, () => {
      const svg = read(`public/mock/sponsors/${key}.svg`);
      expect(svg.trimStart(), key).toMatch(/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/);
      expect(svg).toMatch(/<text[\s>]/);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/<image[\s>]/i);
      expect(svg).not.toMatch(/<foreignObject/i);
      expect(svg).not.toMatch(/(href|src)\s*=\s*["']?\s*(https?:)?\/\//i);
      expect(svg).not.toMatch(/url\(\s*["']?(https?:)?\/\//i);
      expect(svg).not.toMatch(/@import/i);
    });
  }

  it("does not ship the broken-image target (it must 404 for the image_broken scenario)", () => {
    expect(existsSync(abs("public/mock/sponsors/__broken__.svg"))).toBe(false);
  });
});
