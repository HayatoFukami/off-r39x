import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the Vite + React Router migration (SPEC-190 DEV-WEB-001 / 003 / 010..013, INF-VCL-004,
// SPEC-180 13.1). Source reads only; behaviour is covered by the Playwright UI mock suite (static-hosting.spec.ts).
// Contract: tests/contracts/s3-layout.md sections 0 and 13.

const webDir = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));
const abs = (path: string): string => join(webDir, path);
const read = (path: string): string =>
  existsSync(abs(path)) ? readFileSync(abs(path), "utf8") : "";
const rel = (file: string): string => relative(webDir, file).replaceAll("\\", "/");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "dist") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const codeFiles = (dir: string): string[] =>
  walk(abs(dir)).filter((f) => /\.(ts|tsx|mts)$/.test(f) && !/\.d\.ts$/.test(f));

// Every import form that names a module: static, side effect, re-export, dynamic and require.
function importsOf(source: string, moduleName: RegExp): boolean {
  const specifier = new RegExp(
    `(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)["'](?:${moduleName.source})["']`,
  );
  return specifier.test(source);
}

describe("TC-STACK-008-001 no Next.js remnants and no server runtime remain in apps/web (DEV-WEB-001, DEV-WEB-003, INF-VCL-004)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  it("depends on react-router, vite and @vitejs/plugin-react and no longer on next", () => {
    expect(Object.keys(pkg.dependencies ?? {})).toContain("react-router");
    expect(Object.keys(pkg.devDependencies ?? {})).toContain("vite");
    expect(Object.keys(pkg.devDependencies ?? {})).toContain("@vitejs/plugin-react");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("next");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("next");
  });

  it("has no app/ directory, next.config.* or next-env.d.ts", () => {
    expect(existsSync(abs("app"))).toBe(false);
    for (const name of ["next.config.ts", "next.config.mjs", "next.config.js", "next-env.d.ts"]) {
      expect(existsSync(abs(name)), name).toBe(false);
    }
  });

  it("imports nothing from next or next/* in apps/web/src or in the .ts files directly under apps/web", () => {
    const rootFiles = readdirSync(webDir)
      .filter((name) => /\.(ts|tsx|mts)$/.test(name))
      .map((name) => join(webDir, name));
    const files = [...codeFiles("src"), ...rootFiles];
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      expect(importsOf(readFileSync(file, "utf8"), /next(?:\/[^"']*)?/), rel(file)).toBe(false);
    }
  });

  it("imports react-router only from src/routing, src/routes and src/main.tsx", () => {
    const files = codeFiles("src");
    const importers = files.filter((file) =>
      importsOf(readFileSync(file, "utf8"), /react-router(?:-dom)?(?:\/[^"']*)?/),
    );
    expect(importers.length).toBeGreaterThan(5);
    for (const file of importers) {
      const path = rel(file);
      expect(
        path.startsWith("src/routing/") ||
          path.startsWith("src/routes/") ||
          path === "src/main.tsx",
        path,
      ).toBe(true);
    }
  });

  it("has a tsconfig and a components.json that no longer know Next.js", () => {
    const tsconfig = read("tsconfig.json");
    expect(tsconfig.length).toBeGreaterThan(0);
    expect(tsconfig).not.toMatch(/"name"\s*:\s*"next"|next-env|next\.config|\.next|"app\/\*\*"/);
    expect(tsconfig).toMatch(/"jsx"\s*:\s*"react-jsx"/);
    const components = JSON.parse(read("components.json")) as {
      rsc?: boolean;
      tailwind?: { css?: string };
    };
    expect(components.rsc).toBe(false);
    expect(components.tailwind?.css).toBe("src/styles/globals.css");
  });

  it("builds and runs through Vite, with no next script", () => {
    expect(pkg.scripts?.dev).toBe("vite");
    expect(pkg.scripts?.build).toMatch(/^vite build\b/);
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      expect(command, name).not.toMatch(/\bnext\b/);
    }
  });

  it("adds no server runtime: no Server Action or Server Component directive, no Pages Functions, no SPA-fallback override", () => {
    for (const file of codeFiles("src")) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /^\s*["']use server["']|getServerSideProps|getStaticProps|export\s+const\s+dynamic\s*=|export\s+const\s+revalidate/m,
      );
    }
    for (const path of [
      "functions",
      "_worker.js",
      "_routes.json",
      "public/404.html",
      "public/_redirects",
      "public/_headers",
      "public/_worker.js",
    ]) {
      expect(existsSync(abs(path)), path).toBe(false);
    }
  });
});

// The 33 URL patterns of the application (28 general + 5 under /dev), as React Router paths.
const GENERAL_PATHS = [
  "/",
  "/announcements",
  "/announcements/:announcementRef",
  "/entry",
  "/karaoke",
  "/karaoke/schedule/:date",
  "/karaoke/slots/:slotRef",
  "/goods",
  "/goods/:goodsRef",
  "/cart",
  "/account/register",
  "/account/email-verification",
  "/account/login",
  "/account/password-reset",
  "/account/password-reset/complete",
] as const;
const PURCHASE_PATHS = ["/purchase/orders/:orderRef"] as const;
const MYPAGE_PATHS = [
  "/mypage",
  "/mypage/profile",
  "/mypage/orders",
  "/mypage/orders/:orderRef",
  "/mypage/entry-tickets",
  "/mypage/entry-tickets/:ticketRef",
  "/mypage/entry-tickets/:ticketRef/qr",
  "/mypage/karaoke",
  "/mypage/karaoke/:reservationRef",
  "/mypage/karaoke/:reservationRef/qr",
  "/mypage/goods",
  "/mypage/goods/:goodsItemRef",
] as const;
const DEV_PATHS = [
  "/dev/scenarios",
  "/dev/mock-checkout/:orderRef",
  "/dev/mock-google", // B5 C2: the stand-in for the Google sign-in screen
  "/dev/mock-magic-link", // B5 C3: the stand-in for opening the Magic Link
  "/dev/error-probe",
] as const;
const ALL_PATHS = [...GENERAL_PATHS, ...PURCHASE_PATHS, ...MYPAGE_PATHS, ...DEV_PATHS] as const;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const pathLiteral = (path: string): RegExp =>
  new RegExp(`\\bpath\\s*:\\s*["']${escapeRegExp(path)}["']`, "g");

/** The source text of the array that follows `children:` of the element `<Name` (balanced brackets). */
function childrenOf(source: string, element: string): string {
  const at = source.indexOf(`<${element}`);
  if (at < 0) return "";
  const childrenAt = source.indexOf("children", at);
  const open = source.indexOf("[", childrenAt);
  if (childrenAt < 0 || open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
}

describe("TC-STACK-008-002 route-table.tsx declares every application URL once, with the specified nesting (SPEC-050 7, DEV-WEB-001)", () => {
  const table = read("src/routes/route-table.tsx");

  it("has 33 distinct absolute paths of the application", () => {
    expect(new Set(ALL_PATHS).size).toBe(33);
    expect(GENERAL_PATHS.length + PURCHASE_PATHS.length + MYPAGE_PATHS.length).toBe(28);
  });

  it("writes each path as one literal, and the catch-all route", () => {
    expect(table.length).toBeGreaterThan(0);
    for (const path of ALL_PATHS) {
      expect((table.match(pathLiteral(path)) ?? []).length, path).toBe(1);
    }
    expect((table.match(/\bpath\s*:\s*["']\*["']/g) ?? []).length).toBe(1);
  });

  it("declares no other path: every path literal is absolute or the catch-all", () => {
    const literals = [...table.matchAll(/\bpath\s*:\s*["']([^"']*)["']/g)].map((m) => m[1] ?? "");
    expect(literals.length).toBe(34);
    for (const literal of literals) {
      expect(literal === "*" || (ALL_PATHS as readonly string[]).includes(literal), literal).toBe(
        true,
      );
    }
  });

  it("matches case-sensitively: every route with a path except the catch-all has caseSensitive: true (33 times, never false)", () => {
    // The object literal around a `path: "/…"` property: from the nearest unmatched `{` before it to its closing `}`.
    const literalAround = (index: number): string => {
      let depth = 0;
      let start = index;
      for (; start >= 0; start -= 1) {
        const char = table[start];
        if (char === "}") depth += 1;
        else if (char === "{") {
          if (depth === 0) break;
          depth -= 1;
        }
      }
      let end = start + 1;
      for (depth = 1; end < table.length && depth > 0; end += 1) {
        if (table[end] === "{") depth += 1;
        else if (table[end] === "}") depth -= 1;
      }
      return table.slice(start, end);
    };
    for (const path of ALL_PATHS) {
      const at = table.search(pathLiteral(path));
      expect(at, path).toBeGreaterThan(-1);
      expect(literalAround(at), path).toMatch(/\bcaseSensitive\s*:\s*true\b/);
    }
    const catchAll = table.search(/\bpath\s*:\s*["']\*["']/);
    expect(catchAll).toBeGreaterThan(-1);
    expect(literalAround(catchAll)).not.toMatch(/\bcaseSensitive\b/);
    expect((table.match(/\bcaseSensitive\s*:\s*true\b/g) ?? []).length).toBe(33);
    expect(table).not.toMatch(/\bcaseSensitive\s*:\s*false\b/);
  });

  it("renders NotFoundView for the catch-all", () => {
    const at = table.search(/\bpath\s*:\s*["']\*["']/);
    expect(at).toBeGreaterThan(-1);
    expect(table.slice(at, at + 200)).toMatch(/NotFoundView/);
  });

  it("has two error boundaries: the root one and one pathless route around every page", () => {
    expect((table.match(/\berrorElement\s*:/g) ?? []).length).toBe(2);
    expect(table).toMatch(/errorElement\s*:\s*<RootError\b/);
    expect(table).toMatch(/errorElement\s*:\s*<RouteError\b/);
    expect(table.indexOf("<RootLayout")).toBeLessThan(table.indexOf("<RouteError"));
  });

  it("nests the purchase route in SelfLayout, the Mypage routes in MypageLayout and the dev routes in DevLayout", () => {
    const self = childrenOf(table, "SelfLayout");
    const mypage = childrenOf(table, "MypageLayout");
    const dev = childrenOf(table, "DevLayout");
    expect(self).toContain("/purchase/orders/:orderRef");
    expect(self).toContain("<MypageLayout");
    for (const path of MYPAGE_PATHS) {
      expect(mypage, path).toMatch(pathLiteral(path));
      expect(self, path).toMatch(pathLiteral(path));
    }
    for (const path of [...GENERAL_PATHS, ...DEV_PATHS]) {
      expect(self, path).not.toMatch(pathLiteral(path));
    }
    for (const path of DEV_PATHS) {
      expect(dev, path).toMatch(pathLiteral(path));
    }
    for (const path of [...GENERAL_PATHS, ...PURCHASE_PATHS, ...MYPAGE_PATHS]) {
      expect(dev, path).not.toMatch(pathLiteral(path));
    }
    expect(dev).not.toMatch(/path\s*:\s*["']\*["']/);
  });

  it("does not put the account and public pages behind the AuthGate (SelfLayout)", () => {
    const self = childrenOf(table, "SelfLayout");
    for (const path of GENERAL_PATHS) expect(self, path).not.toMatch(pathLiteral(path));
  });

  it("keeps the unknown-URL route out of SelfLayout so that a Guest sees Not Found there, not a login redirect", () => {
    expect(childrenOf(table, "SelfLayout")).not.toMatch(/path\s*:\s*["']\*["']/);
  });
});

describe("TC-STACK-008-003 the entry point mounts the router and reads the environment in one place (DEV-WEB-001, DEV-WEB-011)", () => {
  const main = read("src/main.tsx");

  it("renders RouterProvider with createBrowserRouter inside StrictMode through createRoot and loads the styles", () => {
    expect(main.length).toBeGreaterThan(0);
    expect(main).toMatch(/\bcreateRoot\b/);
    expect(main).toMatch(/\bRouterProvider\b/);
    expect(main).toMatch(/\bcreateBrowserRouter\b/);
    expect(main).toMatch(/\bStrictMode\b/);
    expect(main).toMatch(/import\s+["']\.\/styles\/globals\.css["']/);
    expect(main).not.toMatch(/\bhydrateRoot\b/);
  });

  it("imports no mock code and uses no non-null assertion", () => {
    expect(main).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(main).not.toMatch(/[\w)\]]!(?!=)/);
  });

  it("only src/config/build-env.ts reads import.meta.env; nothing in src reads process.env or a Next.js variable", () => {
    const readers = codeFiles("src").filter((f) =>
      /import\.meta\.env/.test(readFileSync(f, "utf8")),
    );
    expect(readers.map(rel)).toEqual(["src/config/build-env.ts"]);
    for (const file of codeFiles("src")) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /process\.env|NEXT_PUBLIC_|VERCEL_ENV/,
      );
    }
  });

  it("build-env.ts exposes VITE_UI_MOCK and APP_ENV through readBuildEnv", () => {
    const source = read("src/config/build-env.ts");
    expect(source).toMatch(/export\s+function\s+readBuildEnv/);
    expect(source).toMatch(/import\.meta\.env\.VITE_UI_MOCK/);
    expect(source).toMatch(/import\.meta\.env\.APP_ENV/);
  });
});

describe("TC-STACK-008-004 the Next-compatible adapter keeps its contract (DEV-WEB-001; AuthGate effects depend on a stable router)", () => {
  const navigation = read("src/routing/navigation.ts");
  const link = read("src/routing/link.tsx");

  it("exports usePathname, useRouter and useSearchParams over React Router", () => {
    expect(navigation).toMatch(/export\s+(function|const)\s+usePathname\b/);
    expect(navigation).toMatch(/export\s+(function|const)\s+useRouter\b/);
    expect(navigation).toMatch(/export\s+(function|const)\s+useSearchParams\b/);
    expect(navigation).toMatch(/from\s+["']react-router["']/);
    expect(navigation).not.toMatch(/setSearchParams/);
  });

  it("keeps useRouter() stable across renders with useMemo around useNavigate", () => {
    const at = navigation.search(/(function|const)\s+useRouter\b/);
    expect(at).toBeGreaterThan(-1);
    const body = navigation.slice(at);
    expect(body).toMatch(/\buseNavigate\b/);
    expect(body).toMatch(/\buseMemo\s*\(/);
    expect(body).toMatch(/\bpush\b/);
    expect(body).toMatch(/\breplace\b/);
  });

  it("Link takes href, strips prefetch before it can reach the DOM and renders the React Router Link", () => {
    expect(link).toMatch(/export\s+(function|const)\s+Link\b/);
    expect(link).toMatch(/from\s+["']react-router["']/);
    expect(link).toMatch(/\{[^}]*\bprefetch\b[^}]*\.\.\.\w+[^}]*\}/);
    expect(link).toMatch(/\bto=\{href\}/);
    expect(link).not.toMatch(/\bprefetch\s*=\s*\{/);
  });
});

describe("TC-STACK-008-005 Zod runs without eval, so the strict CSP sees no violation (SEC-WEB-003)", () => {
  const main = read("src/main.tsx");
  const jitless = read("src/config/zod-jitless.ts");

  /** Module specifiers of the top-level import statements, in source order (the evaluation order of ES modules). */
  const importOrder = (source: string): string[] =>
    [...source.matchAll(/^import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["'];?/gm)].map(
      (match) => match[1] ?? "",
    );

  it("src/config/zod-jitless.ts imports Zod and calls z.config({ jitless: true })", () => {
    expect(jitless.length).toBeGreaterThan(0);
    expect(jitless).toMatch(/import\s*\{\s*z\s*\}\s*from\s*["']zod["']/);
    expect(jitless).toMatch(/\bz\.config\(\s*\{\s*jitless:\s*true\s*\}\s*\)/);
  });

  it("src/main.tsx imports zod-jitless as its first JavaScript import, ahead of every other module (the stylesheet aside)", () => {
    const order = importOrder(main).filter((specifier) => !specifier.endsWith(".css"));
    expect(order.length).toBeGreaterThan(1);
    expect(order[0]).toMatch(/^(\.\/|@\/)config\/zod-jitless$/);
    expect(order.slice(1)).not.toContainEqual(expect.stringMatching(/zod-jitless$/));
    expect(order.slice(1)).not.toContain("zod");
  });

  it("zod-jitless is a side-effect import, so the bundler cannot drop or reorder it", () => {
    expect(main).toMatch(/^import\s+["'](?:\.\/|@\/)config\/zod-jitless["'];?\s*$/m);
  });

  it("Zod is imported only inside src/features and src/mock (so every schema is defined after the entry point's first import)", () => {
    const importers = codeFiles("src")
      .filter((f) => importsOf(readFileSync(f, "utf8"), /zod(?:\/[^"']*)?/))
      .map(rel)
      .filter((f) => f !== "src/config/zod-jitless.ts");
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(file, "a module that defines Zod schemas").toMatch(/^src\/(features|mock)\//);
    }
  });
});
