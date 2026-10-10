import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S6 authentication slice (tests/contracts/s6-auth.md sections 0, 2, 3, 6).
// Source reads only; behaviour is covered by the Vitest pure tests and the Playwright UI mock suite.

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

function routeFile(path: string): string | null {
  for (const candidate of [`app/${path}`, `app/(auth)/${path}`]) {
    if (existsSync(abs(candidate))) return candidate;
  }
  return null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const PURE = [
  "src/auth/continuation.ts",
  "src/auth/gate-decision.ts",
  "src/features/auth/form-validation.ts",
  "src/features/auth/continuation-view.ts",
] as const;

const CONTAINERS = [
  "src/features/auth/login-page.tsx",
  "src/features/auth/register-page.tsx",
  "src/features/auth/email-verification-page.tsx",
  "src/features/auth/password-reset-request-page.tsx",
  "src/features/auth/password-reset-complete-page.tsx",
] as const;

const MODULES = [
  ...PURE,
  "src/auth/auth-gate.tsx",
  "src/auth/use-auth.ts",
  ...CONTAINERS,
  "src/presentation/components/form-field.tsx",
  "src/presentation/components/error-summary.tsx",
] as const;

const PAGES = [
  { path: "account/register/page.tsx", title: "copy\\.auth\\.register\\.pageTitle" },
  { path: "account/email-verification/page.tsx", title: "copy\\.auth\\.verify\\.pageTitle" },
  { path: "account/login/page.tsx", title: "copy\\.auth\\.login\\.pageTitle" },
  { path: "account/password-reset/page.tsx", title: "copy\\.auth\\.reset\\.pageTitle" },
  {
    path: "account/password-reset/complete/page.tsx",
    title: "copy\\.auth\\.resetComplete\\.pageTitle",
  },
] as const;

const s6Sources = [
  ...MODULES.map((m) => abs(m)),
  ...PAGES.flatMap((p) => {
    const file = routeFile(p.path);
    return file === null ? [] : [abs(file)];
  }),
  abs("app/(self)/layout.tsx"),
  abs("app/(self)/mypage/page.tsx"),
].filter((f) => existsSync(f));

describe("TC-DEV-WEB-001-501 the S6 modules and routes exist at the contracted paths (DEV-WEB-001, DEV-REP-006)", () => {
  for (const path of MODULES) {
    it(`has ${path}`, () => {
      expect(existsSync(abs(path)), path).toBe(true);
    });
  }
  for (const page of PAGES) {
    it(`has a route file for ${page.path}`, () => {
      expect(routeFile(page.path), page.path).not.toBeNull();
    });
  }
  it("has the AuthGate layout and the Mypage placeholder under (self)", () => {
    expect(existsSync(abs("app/(self)/layout.tsx"))).toBe(true);
    expect(existsSync(abs("app/(self)/mypage/page.tsx"))).toBe(true);
  });
});

describe("TC-DEV-WEB-001-502 the S6 page.tsx files are thin server shells (DEV-WEB-001)", () => {
  for (const page of PAGES) {
    const file = routeFile(page.path);
    const source = file === null ? "" : stripComments(read(file));
    it(`${page.path} is a Server Component that renders a feature container with metadata`, () => {
      expect(file, page.path).not.toBeNull();
      expect(source).not.toMatch(/^\s*["']use client["']/);
      expect(source).not.toMatch(/<main[\s>]/);
      expect(source).toMatch(/features\/auth\//);
      expect(source).toMatch(/export\s+const\s+metadata/);
      expect(source).toMatch(new RegExp(page.title));
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
    });
  }

  it("the (self) layout is a thin shell around AuthGate and the Mypage placeholder keeps its h1 inside it", () => {
    const layout = stripComments(read("app/(self)/layout.tsx"));
    expect(layout).toMatch(/AuthGate/);
    expect(layout).toMatch(/children/);
    expect(layout).not.toMatch(/<main[\s>]/);
    const mypage = stripComments(read("app/(self)/mypage/page.tsx"));
    expect(mypage).toMatch(/export\s+const\s+metadata/);
    expect(mypage).toMatch(/copy\.mypage\.pageTitle/);
    expect(mypage).toMatch(/copy\.mypage\.heading/);
    expect(mypage).toMatch(/copy\.mypage\.protectedMarker/);
    expect(mypage).not.toMatch(/<main[\s>]/);
  });
});

describe("TC-DEV-WEB-001-503 the pure modules are pure and the containers use the port only through useAuth()", () => {
  it("keeps continuation / gate / form / view free of React, Next, storage and the mock backend", () => {
    for (const path of PURE) {
      const code = stripComments(read(path));
      expect(code, path).not.toMatch(/from\s+["'](react|next)[/"']/);
      expect(code, path).not.toMatch(/\b(localStorage|sessionStorage|document|window|fetch)\b/);
      expect(code, path).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(code, path).not.toMatch(/\bconsole\s*\./);
    }
  });

  for (const path of CONTAINERS) {
    it(`${path} is a client container that reaches AuthPort only through useAuth()`, () => {
      const code = stripComments(read(path));
      expect(code).toMatch(/^\s*["']use client["']/);
      expect(code).toMatch(/\buseAuth\s*\(/);
      expect(code).not.toMatch(/createAuthPort|createMockAuth|from\s+["'][^"']*\/mock\//);
      expect(code).not.toMatch(/\b(fetch|localStorage|sessionStorage|document\.cookie)\b/);
      expect(code).not.toMatch(/\bconsole\s*\./);
    });
  }

  it("SessionProvider hands its single AuthPort to useAuth (one listener set for onSessionChange)", () => {
    expect(stripComments(read("src/auth/use-session.ts"))).toMatch(/AuthPort/);
    expect(stripComments(read("src/auth/use-auth.ts"))).toMatch(/useSession/);
    expect(stripComments(read("src/auth/session-provider.tsx"))).toMatch(
      /useMemo\([^;]*\{\s*state\s*,\s*signOut\s*,\s*auth\s*\}/,
    );
  });
});

describe("TC-DEV-WEB-001-504 AuthGate renders protected content only when allowed (AR-SES-007, SPEC-050 15.6)", () => {
  const code = stripComments(read("src/auth/auth-gate.tsx"));
  it("decides through decideGate and the current pathname", () => {
    expect(code).toMatch(/^\s*["']use client["']/);
    expect(code).toMatch(/decideGate/);
    expect(code).toMatch(/usePathname/);
    expect(code).toMatch(/useSession/);
  });
  it("re-checks on pageshow (bfcache restore) and offers a retry when the session is unavailable", () => {
    expect(code).toMatch(/pageshow/);
    expect(code).toMatch(/persisted/);
    expect(code).toMatch(/copy\.pageState\.retry/);
    expect(code).toMatch(/copy\.auth\.gate\.redirecting/);
  });
  it("does not import the mock backend", () => {
    expect(code).not.toMatch(/from\s+["'][^"']*\/mock\//);
  });
});

describe("TC-SEC-AUTH-018-501 the S6 sources never log, store or put credentials in a URL (SEC-AUTH-016 / 018, SEC-WEB-013)", () => {
  it("has S6 source files to inspect", () => {
    expect(s6Sources.length).toBeGreaterThanOrEqual(15);
  });

  it("uses no console, no web storage, no cookie and no analytics in the S6 features", () => {
    for (const file of s6Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /\bconsole\s*\.|\blocalStorage\b|\bsessionStorage\b|document\.cookie|\bgtag\b|\banalytics\b/i,
      );
    }
  });

  it("never trims a password and never sets maxLength on a password field", () => {
    for (const file of s6Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/\b\w*[pP]assword\w*\s*\.\s*trim\s*\(/);
      expect(code, rel(file)).not.toMatch(/\bmaxLength\s*=/);
    }
  });

  it("never builds a URL or a navigation target from a password or a context", () => {
    for (const file of s6Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /(router\.(push|replace)|location\.(assign|replace|href)|replaceState|accountPath)\s*\([^)]*[pP]assword/,
      );
    }
  });

  it("never renders raw HTML or a javascript: URL", () => {
    for (const file of s6Sources) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:/,
      );
    }
  });
});

describe("TC-AR-CONT-001-501 the intent type cannot carry authoritative values (AR-CONT-001 / 002, SPEC-050 10.3)", () => {
  const code = stripComments(read("src/auth/continuation.ts"));
  it("names no price, quantity, owner, role, token or result", () => {
    expect(code).not.toMatch(
      /\b(price|amount|total|quantity|owner|role|permission|token|secret|paid|stock|userId)\b/i,
    );
  });
  it("re-checks the built path with isSafeRelativePath before returning it", () => {
    expect(code).toMatch(/isSafeRelativePath/);
  });
  it("owns the continue parameter name", () => {
    expect(code).toMatch(/["']continue["']/);
  });
});

describe("TC-DEV-WEB-001-505 S6 copy, colour and dependency direction (SPEC-050 24.3, DEV-DEP-006)", () => {
  it("keeps hard-coded Japanese out of the S6 features and pages (copy comes from ja.ts)", () => {
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s6Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("takes colours from the design tokens only", () => {
    const literalColour =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
    for (const file of s6Sources.filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(file, "utf8");
      expect(literalColour.exec(source)?.[0] ?? null, rel(file)).toBeNull();
      expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(source.replace(/&#\d+;/g, "")), rel(file)).toBe(false);
    }
  });

  it("features do not import mock, presentation does not import features", () => {
    for (const file of s6Sources.filter((f) => rel(f).startsWith("src/features/"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/mock\//);
    }
    for (const file of walk(abs("src/presentation")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/features\//);
    }
  });
});

describe("TC-PG-AUTH-003-511 forms follow SPEC-050 25 (error summary, aria-invalid, no browser validation)", () => {
  // PG-AUTH-002 has no input field (SPEC-050 15.2, contract 6.3), so it is not a form container.
  const forms = CONTAINERS.filter((p) => !p.includes("email-verification")).map(
    (p) => [p, stripComments(read(p))] as const,
  );
  it("every form is noValidate and links its error summary to the fields", () => {
    for (const [path, code] of forms) {
      expect(code, path).toMatch(/noValidate/);
      expect(code, path).toMatch(/ErrorSummary/);
      expect(code, path).toMatch(/aria-busy/);
    }
  });
  it("the shared parts expose aria-invalid, aria-describedby, role=alert and focus handling", () => {
    const field = stripComments(read("src/presentation/components/form-field.tsx"));
    expect(field).toMatch(/aria-invalid/);
    expect(field).toMatch(/aria-describedby/);
    const summary = stripComments(read("src/presentation/components/error-summary.tsx"));
    expect(summary).toMatch(/role=["']alert["']/);
    expect(summary).toMatch(/tabIndex/);
  });
  it("the pages validate through the pure form validators and never call the port with invalid input", () => {
    expect(forms.find(([p]) => p.includes("login-page"))?.[1]).toMatch(/validateLoginForm/);
    expect(forms.find(([p]) => p.includes("register-page"))?.[1]).toMatch(/validateRegisterForm/);
    expect(forms.find(([p]) => p.includes("password-reset-request"))?.[1]).toMatch(
      /validateResetRequestForm/,
    );
    expect(forms.find(([p]) => p.includes("password-reset-complete"))?.[1]).toMatch(
      /validateResetCompleteForm/,
    );
  });
  it("Login and Register parse the continue parameter and resolve the destination through the pure helpers", () => {
    for (const name of ["login-page", "register-page"]) {
      const code = forms.find(([p]) => p.includes(name))?.[1] ?? "";
      expect(code, name).toMatch(/parseContinuation/);
      expect(code, name).toMatch(/continuationPath/);
      expect(code, name).toMatch(/describeContinuation/);
    }
  });
});
