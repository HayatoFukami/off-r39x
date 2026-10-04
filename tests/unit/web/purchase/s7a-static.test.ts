import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S7a purchase slice (tests/contracts/s7a-purchase.md sections 0, 1, 4, 5, 6).
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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const PURE = [
  "src/config/purchase-routes.ts",
  "src/features/purchase/cart-purchase-flow.ts",
  "src/features/purchase/purchase-status-model.ts",
  "src/features/purchase/purchase-again.ts",
] as const;

const FEATURE_VIEWS = [
  "src/features/purchase/use-cart-purchase.ts",
  "src/features/purchase/cart-purchase-feedback.tsx",
  "src/features/purchase/order-outcome.tsx",
  "src/features/purchase/purchase-status-page.tsx",
] as const;

const OTHER = [
  "src/presentation/components/access-denied-view.tsx",
  "src/mock/dev-ui/mock-checkout-screen.tsx",
] as const;

const ROUTES = [
  "app/(self)/purchase/orders/[orderRef]/page.tsx",
  "app/dev/mock-checkout/[orderRef]/page.tsx",
] as const;

const s7aSources = [
  ...PURE,
  ...FEATURE_VIEWS,
  ...OTHER,
  ...ROUTES,
  "src/features/cart/cart-page.tsx",
]
  .map((p) => abs(p))
  .filter((f) => existsSync(f));

describe("TC-DEV-WEB-001-601 the S7a modules and routes exist at the contracted paths (DEV-WEB-001, DEV-REP-006)", () => {
  for (const path of [...PURE, ...FEATURE_VIEWS, ...OTHER, ...ROUTES]) {
    it(`has ${path}`, () => {
      expect(existsSync(abs(path)), path).toBe(true);
    });
  }
  it("keeps the mock backend and the ports unchanged in shape (no new port method for S7a)", () => {
    const port = stripComments(read("src/api-client/port.ts"));
    expect(port).toMatch(/startCartPurchase/);
    expect(port).toMatch(/startCheckout/);
    expect(port).toMatch(/getOrder/);
  });
});

describe("TC-DEV-WEB-001-602 the S7a route files are thin server shells (DEV-WEB-001, SPEC-050 5.2 / 19.2)", () => {
  const purchase = stripComments(read(ROUTES[0]));
  const checkout = stripComments(read(ROUTES[1]));

  it("the Purchase Status route validates the param, shows Access Denied for a bad one, and renders the container", () => {
    expect(purchase).not.toMatch(/^\s*["']use client["']/);
    expect(purchase).toMatch(/export\s+const\s+metadata/);
    expect(purchase).toMatch(/copy\.purchase\.pageTitle/);
    expect(purchase).toMatch(/await\s+params|params\s*\)\s*=>|await\s+props\.params/);
    expect(purchase).toMatch(/parseOrderRef/);
    expect(purchase).toMatch(/AccessDeniedView/);
    expect(purchase).toMatch(/PurchaseStatusPage/);
    // A bad ref does not reveal anything through a 404: it renders the same Access Denied view (design 1).
    expect(purchase).not.toMatch(/\bnotFound\s*\(/);
    expect(purchase).not.toMatch(/<main[\s>]/);
    expect(purchase).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(purchase).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
  });

  it("the mock Checkout route is under app/dev (guarded by the dev layout), 404s a bad ref and renders the screen", () => {
    expect(ROUTES[1].startsWith("app/dev/")).toBe(true);
    expect(checkout).not.toMatch(/^\s*["']use client["']/);
    expect(checkout).toMatch(/export\s+const\s+metadata/);
    expect(checkout).toMatch(/copy\.mockCheckout\.pageTitle/);
    expect(checkout).toMatch(/parseOrderRef/);
    expect(checkout).toMatch(/\bnotFound\s*\(/);
    expect(checkout).toMatch(/MockCheckoutScreen/);
    expect(checkout).not.toMatch(/<main[\s>]/);
  });

  it("the dev layout guard that makes /dev/* 404 outside mock mode is still in place (DEV-WEB-012)", () => {
    const layout = stripComments(read("app/dev/layout.tsx"));
    expect(layout).toMatch(/isDevAreaEnabled/);
    expect(layout).toMatch(/notFound\s*\(/);
  });
});

describe("TC-DEV-WEB-001-603 the pure modules are pure (DEV-WEB-001, DEV-TS)", () => {
  for (const path of PURE) {
    it(`${path} imports no React, Next, storage, clock, random or mock backend`, () => {
      const code = stripComments(read(path));
      expect(code, path).not.toMatch(/from\s+["'](react|next)[/"']/);
      expect(code, path).not.toMatch(/\b(localStorage|sessionStorage|document|window|fetch)\b/);
      expect(code, path).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(code, path).not.toMatch(/\b(Date\.now|Math\.random|crypto\.randomUUID)\b/);
      expect(code, path).not.toMatch(/\bconsole\s*\./);
    });
  }

  it("the status model builds on the shared presentations instead of re-deciding states", () => {
    const code = stripComments(read("src/features/purchase/purchase-status-model.ts"));
    expect(code).toMatch(/presentOrderState/);
    expect(code).toMatch(/presentPurpose/);
    expect(code).toMatch(/presentNotification/);
    expect(code).toMatch(/orderActionLabel/);
    expect(code).toMatch(/safeExternalHref/);
  });

  it("the Cart purchase flow and the status model reuse the S6 Continuation helpers and S1 mappings", () => {
    expect(stripComments(read("src/features/purchase/cart-purchase-flow.ts"))).toMatch(
      /accountPath/,
    );
    expect(stripComments(read("src/features/purchase/cart-purchase-flow.ts"))).toMatch(
      /isSafeRelativePath/,
    );
    expect(stripComments(read("src/features/purchase/cart-purchase-flow.ts"))).toMatch(
      /presentRejectionReason/,
    );
    expect(stripComments(read("src/features/purchase/purchase-again.ts"))).toMatch(
      /purchaseAgainTarget/,
    );
  });
});

describe("TC-PG-CRT-001-651 the Cart page wires the purchase start through one hook, and only the Cart page does (design 6, S5 seam)", () => {
  const cartPage = stripComments(read("src/features/cart/cart-page.tsx"));

  it("keeps the handleProceed seam and delegates to useCartPurchase", () => {
    expect(cartPage).toMatch(/handleProceed/);
    expect(cartPage).toMatch(/useCartPurchase/);
    expect(cartPage).toMatch(/CartPurchaseFeedback/);
    expect(cartPage).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(cartPage).not.toMatch(/\b(startCartPurchase|startCheckout|location\.assign)\b/);
  });

  it("the hook uses the three pure decisions, a fresh idempotency key per attempt and removeLines for the included lines", () => {
    const hook = stripComments(read("src/features/purchase/use-cart-purchase.ts"));
    expect(hook).toMatch(/^\s*["']use client["']/);
    expect(hook).toMatch(/planProceed/);
    expect(hook).toMatch(/interpretCartStart/);
    expect(hook).toMatch(/interpretCheckoutStart/);
    expect(hook).toMatch(/startCartPurchase/);
    expect(hook).toMatch(/startCheckout/);
    expect(hook).toMatch(/idempotencyKey/);
    expect(hook).toMatch(/crypto\.randomUUID/);
    expect(hook).toMatch(/removeLines/);
    expect(hook).toMatch(/describeRejections/);
    expect(hook).not.toMatch(/startKaraokePurchase/);
    expect(hook).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(hook).not.toMatch(/\b(localStorage|sessionStorage)\b/);
  });

  it("the feedback view has a live region, an alert that can receive focus, and no list items", () => {
    const view = stripComments(read("src/features/purchase/cart-purchase-feedback.tsx"));
    expect(view).toMatch(/role=["']status["']/);
    expect(view).toMatch(/role=["']alert["']/);
    expect(view).toMatch(/tabIndex/);
    expect(view).toMatch(/copy\.cart\.purchase\./);
    expect(view).not.toMatch(/<li[\s>]/);
  });
});

describe("TC-PG-XFN-001-651 the Purchase Status container reads the Order once per mount and acts only through the port (PAY-BRW-002, SPEC-050 22)", () => {
  const code = stripComments(read("src/features/purchase/purchase-status-page.tsx"));

  it("is a client container that uses useApi() and the pure model, and never touches the mock or storage", () => {
    expect(code).toMatch(/^\s*["']use client["']/);
    expect(code).toMatch(/useApi\s*\(/);
    expect(code).toMatch(/buildPurchaseStatusModel/);
    expect(code).toMatch(/recheckAnnouncement/);
    expect(code).toMatch(/\bgetOrder\b/);
    expect(code).toMatch(/\bstartCheckout\b/);
    expect(code).toMatch(/interpretCheckoutStart/);
    expect(code).toMatch(/planPurchaseAgain/);
    expect(code).toMatch(/addFromOrder/);
    expect(code).not.toMatch(/createApiPort|createMockApi|from\s+["'][^"']*\/mock\//);
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|document\.cookie|fetch)\b/);
    expect(code).not.toMatch(/\bconsole\s*\./);
  });

  it("starts no cart purchase, no Karaoke purchase and no second Order from this page", () => {
    expect(code).not.toMatch(/startCartPurchase|startKaraokePurchase/);
  });

  it("uses a fresh idempotency key for each checkout retry", () => {
    expect(code).toMatch(/idempotencyKey/);
    expect(code).toMatch(/crypto\.randomUUID/);
  });

  it("uses the shared OrderOutcome part and AccessDeniedView", () => {
    expect(code).toMatch(/OrderOutcome/);
    expect(code).toMatch(/AccessDeniedView/);
  });

  it("OrderOutcome is a view: a live region, no data fetching, no mock, no hard-coded state wording", () => {
    const view = stripComments(read("src/features/purchase/order-outcome.tsx"));
    expect(view).toMatch(/role=["']status["']/);
    expect(view).toMatch(/aria-busy/);
    expect(view).toMatch(/StatusBadge/);
    expect(view).not.toMatch(/useApi|from\s+["'][^"']*\/mock\//);
    expect(view).not.toMatch(/\b(localStorage|sessionStorage|fetch)\b/);
  });
});

describe("TC-SEC-WEB-005-611 top-level navigation to a Checkout URL always passes through the safety decision (SEC-WEB-005)", () => {
  it("every S7a file that assigns the location also uses interpretCheckoutStart, and none opens a window or frame", () => {
    for (const file of s7aSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/window\.open|<iframe|target=["']_top["']/);
      if (/\blocation\.(assign|replace|href)\s*[=(]/.test(code)) {
        expect(code, rel(file)).toMatch(/interpretCheckoutStart/);
      }
    }
  });

  it("no S7a file builds a navigation target from a price, an amount or a quantity", () => {
    for (const file of s7aSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /(router\.(push|replace)|location\.(assign|replace|href)|accountPath)\s*\([^)]*\b(price|amount|total|quantity)\b/i,
      );
    }
  });
});

describe("TC-PAY-BRW-001-601 the mock Checkout screen is a stand-in that reads nothing and confirms nothing (PAY-BRW-001..003, design 6)", () => {
  const code = stripComments(read("src/mock/dev-ui/mock-checkout-screen.tsx"));

  it("calls no port, no storage and no mock backend (the Order state and webhook reads stay untouched)", () => {
    expect(code).not.toMatch(/useApi|createMockApi|getOrder|startCheckout|startCartPurchase/);
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|fetch)\b/);
    expect(code).not.toMatch(/\bconsole\s*\./);
    expect(code).not.toMatch(/from\s+["'][^"']*\/backend\//);
  });

  it("has no input field (it never handles card numbers) and uses only the contracted copy", () => {
    expect(code).not.toMatch(/<(input|textarea|select)[\s>]/i);
    expect(code).toMatch(/copy\.mockCheckout\.heading/);
    expect(code).toMatch(/copy\.mockCheckout\.note/);
    expect(code).toMatch(/copy\.mockCheckout\.pay/);
    expect(code).toMatch(/copy\.mockCheckout\.back/);
    expect(code).toMatch(/purchaseOrderHref/);
  });

  it("is not linked from the general navigation, footer or drawer (DEV-WEB-012)", () => {
    for (const file of walk(abs("src/presentation/layout"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/mock-checkout/);
    }
    for (const file of ["src/config/site.ts", "src/config/public-routes.ts"]) {
      expect(read(file), file).not.toMatch(/mock-checkout/);
    }
    for (const file of walk(abs("src/features")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const code2 = stripComments(readFileSync(file, "utf8"));
      expect(code2, rel(file)).not.toMatch(/\/dev\/mock-checkout|mockCheckoutHref/);
    }
  });
});

describe("TC-PG-XFN-003-601 AccessDeniedView offers a way back and nothing that can grant access (SPEC-050 19.2)", () => {
  const code = stripComments(read("src/presentation/components/access-denied-view.tsx"));
  it("renders the contracted wording and two links, with no retry control and no data props", () => {
    expect(code).toMatch(/copy\.accessDenied\.title/);
    expect(code).toMatch(/copy\.accessDenied\.description/);
    expect(code).toMatch(/copy\.accessDenied\.mypageLink/);
    expect(code).toMatch(/listHref/);
    expect(code).toMatch(/listLabel/);
    expect(code).toMatch(/<h1[\s>]/);
    expect(code).not.toMatch(/<button[\s>]|onClick|copy\.pageState\.retry/);
    expect(code).not.toMatch(/orderRef|useApi|from\s+["'][^"']*\/(features|mock)\//);
  });
});

describe("TC-DEV-WEB-001-604 S7a copy, colour and dependency direction (SPEC-050 24.3, DEV-DEP-006)", () => {
  it("has S7a source files to inspect", () => {
    expect(s7aSources.length).toBeGreaterThanOrEqual(11);
  });

  it("keeps hard-coded Japanese and the yen sign out of the S7a sources (copy comes from ja.ts)", () => {
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s7aSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line) || /[¥￥]/.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("takes colours from the design tokens only", () => {
    const literalColour =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
    for (const file of s7aSources.filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(file, "utf8");
      expect(literalColour.exec(source)?.[0] ?? null, rel(file)).toBeNull();
      expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(source.replace(/&#\d+;/g, "")), rel(file)).toBe(false);
    }
  });

  it("never logs, renders raw HTML or builds a javascript: URL", () => {
    for (const file of s7aSources) {
      const raw = readFileSync(file, "utf8");
      expect(stripComments(raw), rel(file)).not.toMatch(/\bconsole\s*\./);
      expect(raw, rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:/,
      );
    }
  });

  it("features do not import mock; presentation does not import features", () => {
    for (const file of s7aSources.filter((f) => rel(f).startsWith("src/features/"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/mock\//);
    }
    for (const file of walk(abs("src/presentation")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/features\//);
    }
  });

  it("does not add a S7b concern: no Karaoke purchase start in the S7a features", () => {
    for (const file of walk(abs("src/features/purchase")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(stripComments(readFileSync(file, "utf8")), rel(file)).not.toMatch(
        /startKaraokePurchase/,
      );
    }
  });
});
