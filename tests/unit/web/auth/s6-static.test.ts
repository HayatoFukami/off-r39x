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

/** Route modules live in src/routes/<path> (React Router; SPEC-190 DEV-WEB-001). */
function routeFile(path: string): string | null {
  const candidate = `src/routes/${path}`;
  return existsSync(abs(candidate)) ? candidate : null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const PURE = [
  "src/auth/continuation.ts",
  "src/auth/gate-decision.ts",
  "src/features/auth/form-validation.ts",
  "src/features/auth/continuation-view.ts",
  "src/features/auth/auth-methods.ts", // B5 C1
  "src/features/auth/auth-return.ts", // B5 C2: the return and failure paths of an external-completion method
] as const;

const CONTAINERS = [
  "src/features/auth/login-page.tsx",
  "src/features/auth/register-page.tsx",
  "src/features/auth/email-verification-page.tsx",
  "src/features/auth/password-reset-request-page.tsx",
  "src/features/auth/password-reset-complete-page.tsx",
  "src/features/auth/email-otp-form.tsx", // B5 C1: the Email OTP steps; calls the port through useAuth()
  "src/features/auth/google-sign-in.tsx", // B5 C2: the Google start button; calls the port through useAuth()
] as const;

const MODULES = [
  ...PURE,
  "src/auth/auth-gate.tsx",
  "src/auth/use-auth.ts",
  ...CONTAINERS,
  "src/features/auth/method-selector.tsx", // B5 C1: the method radio group (a client part, no port)
  "src/presentation/components/form-field.tsx",
  "src/presentation/components/error-summary.tsx",
] as const;

const PAGES = [
  { path: "auth/register.tsx", title: "copy\\.auth\\.register\\.pageTitle" },
  { path: "auth/email-verification.tsx", title: "copy\\.auth\\.verify\\.pageTitle" },
  { path: "auth/login.tsx", title: "copy\\.auth\\.login\\.pageTitle" },
  { path: "auth/password-reset.tsx", title: "copy\\.auth\\.reset\\.pageTitle" },
  {
    path: "auth/password-reset-complete.tsx",
    title: "copy\\.auth\\.resetComplete\\.pageTitle",
  },
] as const;

const s6Sources = [
  ...MODULES.map((m) => abs(m)),
  ...PAGES.flatMap((p) => {
    const file = routeFile(p.path);
    return file === null ? [] : [abs(file)];
  }),
  abs("src/routes/self/self-layout.tsx"),
  abs("src/routes/self/mypage-overview.tsx"),
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
  it("has the AuthGate layout and the Mypage Overview under src/routes/self", () => {
    expect(existsSync(abs("src/routes/self/self-layout.tsx"))).toBe(true);
    expect(existsSync(abs("src/routes/self/mypage-overview.tsx"))).toBe(true);
  });
});

describe("TC-DEV-WEB-001-502 the S6 route modules are thin shells (DEV-WEB-001, React Router)", () => {
  for (const page of PAGES) {
    const file = routeFile(page.path);
    const source = file === null ? "" : stripComments(read(file));
    it(`${page.path} is a thin route module that renders a feature container with a title handle`, () => {
      expect(file, page.path).not.toBeNull();
      expect(source).not.toMatch(/^\s*["']use client["']/);
      expect(source).not.toMatch(/<main[\s>]/);
      expect(source).toMatch(/features\/auth\//);
      expect(source).toMatch(/export\s+const\s+handle/);
      expect(source).toMatch(new RegExp(page.title));
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
    });
  }

  it("the self layout is a thin shell around AuthGate and an Outlet, and the Mypage Overview renders inside it", () => {
    const layout = stripComments(read("src/routes/self/self-layout.tsx"));
    expect(layout).toMatch(/\bAuthGate\b/);
    expect(layout).toMatch(/\bOutlet\b/);
    expect(layout).not.toMatch(/<main[\s>]/);
    const mypage = stripComments(read("src/routes/self/mypage-overview.tsx"));
    expect(mypage).toMatch(/export\s+const\s+handle/);
    expect(mypage).toMatch(/copy\.mypage\.pageTitle/);
    expect(mypage).toMatch(/MypageOverviewPage/);
    expect(mypage).not.toMatch(/<main[\s>]/);
  });
});

describe("TC-DEV-WEB-001-503 the pure modules are pure and the containers use the port only through useAuth()", () => {
  it("keeps continuation / gate / form / view free of React, Next, storage and the mock backend", () => {
    for (const path of PURE) {
      const code = stripComments(read(path));
      expect(code, path).not.toMatch(/from\s+["'](react|next|react-router)[/"']/);
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
  // PG-AUTH-002 has no input field (SPEC-050 15.2, contract 6.3), so it is not a form container. The Google start
  // (B5 C2) is a button with no input either.
  const forms = CONTAINERS.filter(
    (p) => !p.includes("email-verification") && !p.includes("google-sign-in"),
  ).map((p) => [p, stripComments(read(p))] as const);
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

// B5 C1 (tests/contracts/s6-auth.md sections 5A, 6.1A, 6.2A): the method radio group and the Email OTP steps.
describe("TC-PG-AUTH-003-512 the method selection and the Email OTP steps are wired as contracted: radio group, one-time-code field, the port only through useAuth(), the code never leaves state (SPEC-050 15.0 / 25, SEC-AUTH-018)", () => {
  const code = (path: string): string => stripComments(read(path));
  const otpForm = (): string => code("src/features/auth/email-otp-form.tsx");

  it("the method selector is a fieldset with a legend and radio inputs named by labels, and it does not move focus", () => {
    const selector = code("src/features/auth/method-selector.tsx");
    expect(selector).toMatch(/^\s*["']use client["']/);
    expect(selector).toMatch(/<fieldset\b/);
    expect(selector).toMatch(/<legend\b/);
    expect(selector).toMatch(/type=["']radio["']/);
    expect(selector).toMatch(/<label\b/);
    expect(selector).toMatch(/\buseId\b/);
    expect(selector).toMatch(/AUTH_METHODS/);
    expect(selector).toMatch(/authMethodLabel/);
    expect(selector).not.toMatch(/\.focus\s*\(|autoFocus/);
    expect(selector).not.toMatch(/\buseAuth\b|createAuthPort|from\s+["'][^"']*\/mock\//);
    expect(selector).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b|\bconsole\s*\./);
  });

  it("the method list is pure data: the exports the pages and the selector use", () => {
    const methods = code("src/features/auth/auth-methods.ts");
    expect(methods).toMatch(/export\s+(const|type)\s+AUTH_METHODS\b/);
    expect(methods).toMatch(/export\s+const\s+DEFAULT_AUTH_METHOD\b/);
    expect(methods).toMatch(/export\s+(function|const)\s+authMethodLabel\b/);
    expect(methods).toMatch(/export\s+type\s+AuthMethod\b/);
    expect(methods).toMatch(/["']email-otp["']/);
    expect(methods).not.toMatch(/github|discord/i);
  });

  it("Login and Register show the selector with their own legend and start on the default method", () => {
    const login = code("src/features/auth/login-page.tsx");
    const register = code("src/features/auth/register-page.tsx");
    for (const [name, page] of [
      ["login-page", login],
      ["register-page", register],
    ] as const) {
      expect(page, name).toMatch(/\bMethodSelector\b/);
      expect(page, name).toMatch(/\bEmailOtpForm\b/);
      expect(page, name).toMatch(/\bDEFAULT_AUTH_METHOD\b/);
    }
    expect(login).toMatch(/copy\.auth\.method\.legendLogin/);
    expect(register).toMatch(/copy\.auth\.method\.legendRegister/);
    expect(login).not.toMatch(/copy\.auth\.method\.legendRegister/);
    expect(register).not.toMatch(/copy\.auth\.method\.legendLogin/);
  });

  it("the Email OTP steps call both OTP port methods, validate before calling, and show the contracted wording", () => {
    const form = otpForm();
    expect(form).toMatch(/\.requestEmailOtp\s*\(/);
    expect(form).toMatch(/\.signInWithEmailOtp\s*\(/);
    expect(form).toMatch(/validateOtpCodeForm/);
    expect(form).toMatch(/validateResetRequestForm/);
    expect(form).toMatch(/copy\.auth\.otp\.send\b/);
    expect(form).toMatch(/copy\.auth\.otp\.sent\b/);
    expect(form).toMatch(/copy\.auth\.otp\.resend\b/);
    expect(form).toMatch(/copy\.auth\.otp\.changeEmail\b/);
    expect(form).toMatch(/copy\.auth\.otp\.codeInvalid\b/);
    expect(form).toMatch(/copy\.auth\.otp\.codeExpired\b/);
    expect(form).toMatch(/copy\.auth\.otp\.unavailable\b/);
    expect(form).toMatch(/copy\.auth\.otp\.submitLogin\b/);
    expect(form).toMatch(/copy\.auth\.otp\.submitRegister\b/);
    expect(form).toMatch(/role=["']status["']/);
  });

  it("the code field is autoComplete one-time-code and numeric, has no maxLength, and the email field keeps autoComplete email", () => {
    const form = otpForm();
    expect(form).toMatch(/autoComplete=["']one-time-code["']/);
    expect(form).toMatch(/inputMode=["']numeric["']/);
    expect(form).toMatch(/autoComplete=["']email["']/);
    expect(form).not.toMatch(/\bmaxLength\b/);
    expect(form).toMatch(/copy\.auth\.field\.otpCode\.label/);
  });

  it("the one-time code is held in component state only: it never reaches a URL, a navigation target, a storage or the console", () => {
    const form = otpForm();
    expect(form, "email-otp-form.tsx must exist and not be empty").not.toBe("");
    expect(form).not.toMatch(/\b(localStorage|sessionStorage|document\.cookie)\b|\bconsole\s*\./);
    expect(form).not.toMatch(
      /(router\.(push|replace)|location\.(assign|replace|href)|replaceState|accountPath|continuationPath|URLSearchParams|setSearchParams)\s*\([^)]*\bcode\b/,
    );
    expect(form).not.toMatch(/searchParams\.set\s*\(/);
  });

  it("the Email OTP steps follow the same Cart rule as password Login: the recovery is shown through the page and the buttons are natively disabled while the Cart is stopped", () => {
    const form = otpForm();
    expect(form).toMatch(/cartBlocked/);
    expect(form).toMatch(/cart_busy/);
    expect(form).toMatch(/cart_blocked/);
    expect(form).toMatch(/disabled=/);
    for (const name of ["login-page", "register-page"]) {
      const page = code(`src/features/auth/${name}.tsx`);
      expect(page, name).toMatch(/CartRecovery/);
    }
  });
});

// B5 C2 (tests/contracts/s6-auth.md sections 0, 3B, 5B, 6.1C, 6.2B, 10A): Google, the first external-completion method.
describe("TC-PG-AUTH-003-512 Google is wired as contracted: the start through useAuth(), the return read once and removed from the URL, the result received through the Cart lifecycle only by the screen shown by the return, and a dev-only stand-in (SPEC-050 15.0, FR-CRT-012, DEV-WEB-012, SEC-WEB-013)", () => {
  const code = (path: string): string => stripComments(read(path));
  const authSources = (): string =>
    walk(abs("src/features/auth"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => stripComments(readFileSync(f, "utf8")))
      .join("\n");

  it("the Google start is a client container that calls only startGoogleSignIn through useAuth(), builds both paths with auth-return, hands off with window.location.assign and shows the contracted wording", () => {
    const start = code("src/features/auth/google-sign-in.tsx");
    expect(start, "google-sign-in.tsx must exist and not be empty").not.toBe("");
    expect(start).toMatch(/\.startGoogleSignIn\s*\(/);
    expect(start).toMatch(/externalReturnPath/);
    expect(start).toMatch(/externalFailurePath/);
    expect(start).toMatch(/window\.location\.assign\s*\(/);
    expect(start).toMatch(/copy\.auth\.google\.startLogin\b/);
    expect(start).toMatch(/copy\.auth\.google\.startRegister\b/);
    expect(start).toMatch(/copy\.auth\.google\.signedIn\b/);
    expect(start).toMatch(/copy\.auth\.google\.unavailable\b/);
    expect(start).toMatch(/aria-describedby/);
    expect(start).toMatch(/disabled=/);
    expect(start).toMatch(/cart_busy/);
    expect(start).toMatch(/cart_blocked/);
    expect(start).not.toMatch(/router\.(push|replace)\s*\(/);
    expect(start).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\b/);
  });

  it("auth-return.ts is pure data and functions: it names returned / notice, builds on accountPath and keeps the Continuation", () => {
    const pure = code("src/features/auth/auth-return.ts");
    expect(pure, "auth-return.ts must exist and not be empty").not.toBe("");
    for (const name of [
      "RETURNED_PARAM",
      "externalReturnPath",
      "externalFailurePath",
      "parseReturned",
      "parseFailureNotice",
    ]) {
      expect(pure, name).toMatch(new RegExp(`export\\s+(const|function)\\s+${name}\\b`));
    }
    expect(pure).toMatch(/accountPath/);
    expect(pure).toMatch(/["']google-failed["']/);
    expect(pure).toMatch(/["']returned["']/);
  });

  it("Login and Register pass the Google start their own page, read the return once, remove it from the URL with replaceState and report a failure with the contracted alert", () => {
    for (const name of ["login-page", "register-page"]) {
      const page = code(`src/features/auth/${name}.tsx`);
      expect(page, name).toMatch(/\bGoogleSignIn\b/);
      expect(page, name).toMatch(/\bparseReturned\b/);
      expect(page, name).toMatch(/\bparseFailureNotice\b/);
      expect(page, name).toMatch(/copy\.auth\.google\.failed\b/);
    }
    const all = authSources();
    expect(all).toMatch(/history\.replaceState\s*\(/);
  });

  it("the result is received through the Cart lifecycle by the auth screens only (completeExternalAuthentication), and never by the session provider, the header or the cart features", () => {
    expect(authSources()).toMatch(/\.completeExternalAuthentication\s*\(/);
    expect(authSources()).toMatch(/\bgetBrowserCartLifecycle\b/);
    for (const path of [
      "src/auth/session-provider.tsx",
      "src/auth/auth-gate.tsx",
      "src/features/shell/site-header.tsx",
      "src/features/cart/cart-page.tsx",
      "src/features/cart/use-cart.ts",
    ]) {
      expect(code(path), path).not.toMatch(/completeExternalAuthentication/);
    }
  });

  it("the Cart lifecycle and its Auth decorator define the external-completion methods", () => {
    const lifecycle = code("src/features/cart/cart-lifecycle.ts");
    expect(lifecycle).toMatch(/\bbeginExternalAuthentication\b/);
    expect(lifecycle).toMatch(/\bcompleteExternalAuthentication\b/);
    expect(lifecycle).toMatch(/["']pending["']/);
    expect(lifecycle).toMatch(/["']superseded["']/);
    const decorator = code("src/features/shell/cart-lifecycle-auth-port.ts");
    expect(decorator).toMatch(/startGoogleSignIn/);
    expect(decorator).toMatch(/beginExternalAuthentication/);
    expect(decorator).toMatch(/already_signed_in/);
  });

  it("the stand-in route and screen exist, are dev-only (the route is a thin shell, the screen lives under mock/dev-ui) and keep copy in ja.ts", () => {
    const route = code("src/routes/dev/mock-google.tsx");
    expect(route, "routes/dev/mock-google.tsx must exist").not.toBe("");
    expect(route).toMatch(/mock\/dev-ui\/mock-google-screen/);
    expect(route).toMatch(/export\s+const\s+handle/);
    expect(route).toMatch(/copy\.mockGoogle\.pageTitle/);
    expect(route).not.toMatch(/<main[\s>]/);
    const screen = code("src/mock/dev-ui/mock-google-screen.tsx");
    expect(screen, "mock/dev-ui/mock-google-screen.tsx must exist").not.toBe("");
    expect(screen).toMatch(/allowMockGoogleSignIn/);
    expect(screen).toMatch(/window\.location\.assign\s*\(/);
    expect(screen).toMatch(/isSafeRelativePath/);
    expect(screen).toMatch(/copy\.mockGoogle\.allowDemo\b/);
    expect(screen).toMatch(/copy\.mockGoogle\.allowNew\b/);
    expect(screen).toMatch(/copy\.mockGoogle\.cancel\b/);
    expect(screen).not.toMatch(/\bconsole\s*\./);
    expect(screen).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\b/);
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    expect(screen.split("\n").find((line) => japanese.test(line)) ?? null).toBeNull();
    // Nothing outside the dev area, the mock and the ports may reach the stand-in.
    for (const file of walk(abs("src/features")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /mock-google-screen|allowMockGoogleSignIn/,
      );
    }
  });
});
