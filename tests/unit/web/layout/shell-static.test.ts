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

const sources = walk(abs("src")).filter((f) => /\.(ts|tsx|css)$/.test(f));

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
    "src/presentation/layout/header-menu.tsx",
    "src/presentation/layout/floating-ticket-button.tsx",
    "src/presentation/layout/floating-ticket-visibility.ts",
    "src/presentation/layout/account-menu.tsx",
    "src/presentation/layout/cart-link.tsx",
    "src/presentation/layout/global-footer.tsx",
    "src/presentation/layout/sponsor-logos.tsx",
    "src/presentation/components/ui/button.tsx",
    "src/presentation/components/ui/badge.tsx",
    "src/presentation/components/ui/dialog.tsx",
    "src/mock/dev-ui/scenario-panel.tsx",
    "src/mock/dev-ui/mock-mode-badge.tsx",
    "src/presentation/components/not-found-view.tsx",
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/styles/globals.css",
    "src/config/build-env.ts",
    "src/routing/link.tsx",
    "src/routing/navigation.ts",
    "src/routes/route-table.tsx",
    "src/routes/document-title.ts",
    "src/routes/root-layout.tsx",
    "src/routes/route-error.tsx",
    "src/routes/root-error.tsx",
    "src/routes/dev/dev-layout.tsx",
    "src/routes/dev/scenarios.tsx",
    "src/routes/dev/error-probe.tsx",
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
  const layout = read("src/routes/root-layout.tsx");

  it("keeps the ja document (index.html) and renders the single main landmark with the skip link target", () => {
    const html = read("index.html");
    expect(html).toMatch(/<html[^>]+lang="ja"/);
    expect(html).not.toMatch(/<title[\s>]/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(layout).toMatch(/id="main-content"/);
    expect(layout).toMatch(/#main-content/);
  });

  it("wraps the app in the providers and the header, footer and mock badge", () => {
    expect(layout).toMatch(/ApiProvider/);
    expect(layout).toMatch(/SessionProvider/);
    expect(layout).toMatch(/MockModeBadge/);
  });

  it("renders the Outlet inside the single main, keeps the shell order and marks hydration", () => {
    expect(layout).toMatch(/\bOutlet\b/);
    expect(layout).toMatch(/\bHydrationMarker\b/);
    const at = (needle: string): number => layout.indexOf(`<${needle}`);
    expect(at("SiteHeader")).toBeGreaterThan(-1);
    expect(at("SiteHeader")).toBeLessThan(at("main"));
    expect(at("main")).toBeLessThan(at("SiteFooter"));
    expect(at("SiteFooter")).toBeLessThan(at("SiteFloatingTicket"));
    expect(at("SiteFloatingTicket")).toBeLessThan(at("MockModeBadge"));
  });

  it("restores scroll without keying on the URL (no query in sessionStorage, SEC-AUTH-018) and sets one title", () => {
    expect(layout).toMatch(/<ScrollRestoration\b/);
    expect(layout).not.toMatch(/getKey/);
    expect(layout).toMatch(/formatDocumentTitle/);
    expect((layout.match(/<title[\s>]/g) ?? []).length).toBe(1);
  });

  it("imports mock code only for the MockModeBadge", () => {
    const mockImports = [...layout.matchAll(/from\s+["']([^"']*\/mock\/[^"']*)["']/g)].map(
      (m) => m[1] ?? "",
    );
    expect(mockImports.length).toBe(1);
    expect(mockImports[0]).toMatch(/mock\/dev-ui\/mock-mode-badge(\.tsx?)?$/);
  });

  it("renders <main> only in the root layout and in the root error fallback (route modules, features and presentation must not)", () => {
    const allowed = new Set(["src/routes/root-layout.tsx", "src/routes/root-error.tsx"]);
    const files = [
      ...walk(abs("src/routes")),
      ...walk(abs("src/features")),
      ...walk(abs("src/presentation")),
    ].filter((f) => /\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files.filter((f) => !allowed.has(rel(f)))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/<main[\s>]/);
    }
    expect(read("src/routes/root-layout.tsx")).toMatch(/<main[\s>]/);
    expect(read("src/routes/root-error.tsx")).toMatch(/<main[\s>]/);
  });

  it("imports nothing from next or next/* in any source file (SPEC-190 DEV-WEB-001: Vite + React Router)", () => {
    for (const file of sources.filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /(?:from|import)\s*\(?\s*["']next(?:\/[^"']*)?["']/,
      );
    }
  });
});

describe("TC-PG-XFN-002-202 not-found and error pages (SPEC-050 19.1, SEC-WEB-012)", () => {
  it("uses the shared copy for Not Found and renders it for every unknown path", () => {
    expect(read("src/presentation/components/not-found-view.tsx")).toMatch(/copy\.notFound/);
    const table = read("src/routes/route-table.tsx");
    expect(table).toMatch(/path:\s*["']\*["']/);
    expect(table).toMatch(/\bNotFoundView\b/);
  });

  it("renders the error pages from copy only and never from the error object", () => {
    for (const path of ["src/routes/route-error.tsx", "src/routes/root-error.tsx"]) {
      const source = read(path);
      expect(source.length, path).toBeGreaterThan(0);
      expect(source, path).toMatch(/copy\.errorPage/);
      expect(source, path).not.toMatch(/\berror\s*\.\s*(message|stack|digest|name|cause)\b/);
      expect(source, path).not.toMatch(/\buseRouteError\b/);
      expect(source, path).not.toMatch(/\bconsole\s*\./);
      expect(source, path).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("retries by a replace navigation to the same location, not by a full reload", () => {
    const source = read("src/routes/route-error.tsx");
    expect(source).toMatch(/replace:\s*true/);
    expect(source).not.toMatch(/location\.reload|window\.location/);
  });
});

describe("TC-DEV-WEB-012-102 dev area is guarded and kept out of general navigation (DEV-WEB-012)", () => {
  it("guards /dev/* with isDevAreaEnabled + NotFoundView and marks it noindex", () => {
    const source = read("src/routes/dev/dev-layout.tsx");
    expect(source).toMatch(/isDevAreaEnabled/);
    expect(source).toMatch(/\bNotFoundView\b/);
    expect(source).not.toMatch(/notFound\s*\(/);
    expect(source).toMatch(/name="robots"/);
    expect(source).toMatch(/noindex/);
  });

  it("makes the error probe throw during render with a synthetic marker", () => {
    const source = read("src/routes/dev/error-probe.tsx");
    expect(source).toMatch(/throw new Error\(/);
    expect(source).toMatch(/SENSITIVE-MARKER-9f3a/);
  });

  it("shows the mock badge only in mock mode", () => {
    expect(read("src/mock/dev-ui/mock-mode-badge.tsx")).toMatch(/isUiMockEnabled/);
  });

  it("does not link /admin, /staff or /dev from the shell (SPEC-050 27)", () => {
    // floating-ticket-visibility.ts names "/dev" only to decide where the Floating Ticket Button is hidden
    // (contract s10 section 4.1); it must not render any link.
    const visibility = "src/presentation/layout/floating-ticket-visibility.ts";
    const visibilitySource = read(visibility);
    expect(visibilitySource).not.toMatch(/href|next\/link|<Link/);
    const shell = sources.filter(
      (f) =>
        rel(f) !== visibility &&
        (rel(f).startsWith("src/presentation/layout/") ||
          rel(f).startsWith("src/features/shell/") ||
          rel(f).startsWith("src/config/site")),
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
  const css = read("src/styles/globals.css");
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
    const html = read("index.html");
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["'](https?:)?\/\//);
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
