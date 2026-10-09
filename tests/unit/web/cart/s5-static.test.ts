import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S5 Cart / Entry / Goods detail pages (tests/contracts/s5-cart.md sections 0, 2, 5).
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
  for (const candidate of [`app/${path}`, `app/(public)/${path}`]) {
    if (existsSync(abs(candidate))) return candidate;
  }
  return null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const MODULES = [
  "src/features/cart/cart-model.ts",
  "src/features/cart/cart-count.ts",
  "src/features/cart/quantity.ts",
  "src/features/cart/cart-store.ts",
  "src/features/cart/use-cart.ts",
  "src/features/cart/use-cart-count.ts",
  "src/features/cart/can-proceed.ts",
  "src/features/cart/cart-view-model.ts",
  "src/features/cart/add-to-cart-form.tsx",
  "src/features/cart/cart-page.tsx",
  "src/features/entry/entry-model.ts",
  "src/features/entry/entry-page.tsx",
  "src/features/goods/goods-detail-model.ts",
  "src/features/goods/goods-detail-page.tsx",
] as const;

const PAGES = [
  { path: "entry/page.tsx", title: "copy\\.entry\\.pageTitle", dynamic: false },
  { path: "cart/page.tsx", title: "copy\\.cart\\.pageTitle", dynamic: false },
  { path: "goods/[goodsRef]/page.tsx", title: "copy\\.goods\\.detail\\.pageTitle", dynamic: true },
] as const;

const CONTAINERS = [
  ["src/features/cart/cart-page.tsx", "buildCartPageModel", "resolveCartLines"],
  ["src/features/entry/entry-page.tsx", "buildEntryModel", "listEntryOfferings"],
  ["src/features/goods/goods-detail-page.tsx", "buildGoodsDetailModel", "getGoods"],
] as const;

const s5Sources = [
  ...MODULES.map((m) => abs(m)),
  ...PAGES.flatMap((p) => {
    const file = routeFile(p.path);
    return file === null ? [] : [abs(file)];
  }),
].filter((f) => existsSync(f));

describe("TC-DEV-WEB-001-401 the S5 modules and routes exist at the contracted paths (SPEC-190 DEV-WEB-001, DEV-REP-006)", () => {
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
});

describe("TC-DEV-WEB-001-402 the S5 page.tsx files are thin server shells (DEV-WEB-001, Next 16 async params)", () => {
  for (const page of PAGES) {
    const file = routeFile(page.path);
    const source = file === null ? "" : stripComments(read(file));
    it(`${page.path} is a Server Component that renders a feature container with metadata`, () => {
      expect(file, page.path).not.toBeNull();
      expect(source).not.toMatch(/^\s*["']use client["']/);
      expect(source).not.toMatch(/<main[\s>]/);
      expect(source).toMatch(/features\//);
      expect(source).toMatch(/export\s+const\s+metadata/);
      expect(source).toMatch(new RegExp(page.title));
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
    });
    if (page.dynamic) {
      it(`${page.path} awaits params and calls notFound() for an invalid ref`, () => {
        expect(source).toMatch(/await\s+(props\.)?params|params\s*:\s*Promise</);
        expect(source).toMatch(/notFound\s*\(/);
        expect(source).toMatch(/parseGoodsRef/);
      });
    }
  }
});

describe("TC-DEV-WEB-001-403 the S5 containers read through the port after mount and build a view model", () => {
  for (const [path, builder, operation] of CONTAINERS) {
    const source = stripComments(read(path));
    it(`${path} is a client container that reads only through useApi()`, () => {
      expect(source).toMatch(/^\s*["']use client["']/);
      expect(source).toMatch(/\buseApi\s*\(/);
      expect(source).toMatch(/\buseEffect\b/);
      expect(source).toContain(builder);
      expect(source).toMatch(new RegExp(`\\b${operation}\\s*\\(`));
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
      expect(source).not.toMatch(/\bconsole\s*\./);
    });
  }

  for (const path of ["src/features/entry/entry-page.tsx", "src/features/cart/cart-page.tsx"]) {
    it(`${path} reads the session state so that a session change re-fetches the sales state (FR-CRT-005, FR-CRT-012)`, () => {
      expect(stripComments(read(path))).toMatch(/\buseSession\s*\(/);
    });
  }

  it("the Header count and the Cart page share one store (same-tab updates, SPEC-050 8.5)", () => {
    expect(stripComments(read("src/features/cart/use-cart-count.ts"))).toMatch(
      /cart-store|use-cart/,
    );
    expect(stripComments(read("src/features/cart/use-cart.ts"))).toMatch(/useSyncExternalStore/);
    expect(stripComments(read("src/features/cart/use-cart.ts"))).toMatch(/getBrowserCartStore/);
  });
});

describe("TC-PG-CRT-001-461 S5 starts no purchase and writes no business state (FR-CRT-001, BR-ORD-020, SPEC-050 14A.1 / 33)", () => {
  const forbidden =
    /startCartPurchase|startCheckout|startKaraokePurchase|\.purchase\b|Idempotency|idempotencyKey|createOrder|location\.assign|router\.(push|replace)/i;
  for (const path of [
    "src/features/cart/cart-page.tsx",
    "src/features/cart/add-to-cart-form.tsx",
    "src/features/entry/entry-page.tsx",
    "src/features/goods/goods-detail-page.tsx",
    "src/features/cart/cart-store.ts",
  ]) {
    it(`${path} does not call a purchase operation, create an Order or navigate away`, () => {
      expect(stripComments(read(path)), path).not.toMatch(forbidden);
    });
  }

  it("the Cart page keeps a single seam for S7a: handleProceed", () => {
    expect(stripComments(read("src/features/cart/cart-page.tsx"))).toMatch(/handleProceed/);
  });
});

describe("TC-PG-CRT-001-462 the Cart holds references and quantities only and cannot hold Karaoke (FR-CRT-002 / 003, DEV-TS-004)", () => {
  it("defines exactly one strict zod schema for the stored Cart (cart-model.ts); cart-count.ts and the store reuse it", () => {
    const owners = walk(abs("src/features/cart"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) =>
        /strictObject\s*\(|\.strict\s*\(/.test(stripComments(readFileSync(f, "utf8"))),
      );
    expect(owners.map(rel)).toEqual(["src/features/cart/cart-model.ts"]);
    expect(stripComments(read("src/features/cart/cart-count.ts"))).toMatch(/cart-model/);
  });

  it("the stored Cart schema names no price, amount, stock, availability or owner field", () => {
    const code = stripComments(read("src/features/cart/cart-model.ts"));
    expect(code).not.toMatch(
      /\b(unitPrice|price|amount|currency|remaining|stock|availability|owner|email)\b/i,
    );
  });

  it("the store, the hooks and the Cart UI never mention Karaoke (Karaoke cannot be added, by type and by schema)", () => {
    for (const path of [
      "src/features/cart/cart-store.ts",
      "src/features/cart/use-cart.ts",
      "src/features/cart/add-to-cart-form.tsx",
      "src/features/cart/cart-view-model.ts",
      "src/features/cart/can-proceed.ts",
    ]) {
      expect(stripComments(read(path)), path).not.toMatch(/karaoke/i);
    }
    // The Cart page may show the guidance copy (copy.cart.karaoke.*) but has no Karaoke line, slot or purchase.
    expect(stripComments(read("src/features/cart/cart-page.tsx"))).not.toMatch(
      /KARAOKE|slotRef|startKaraoke|getKaraokeSlot/,
    );
  });

  it("the Cart store does not read a session or an account (FR-CRT-012: the store knows no account; Logout clearing lives in the shell)", () => {
    for (const path of [
      "src/features/cart/cart-model.ts",
      "src/features/cart/cart-store.ts",
      "src/features/cart/use-cart.ts",
    ]) {
      expect(stripComments(read(path)), path).not.toMatch(
        /useSession|SessionProvider|auth\/|signIn|signOut|session/i,
      );
    }
  });
});

describe("TC-DEV-WEB-001-404 S5 copy, money, time and colour are centralised (SPEC-050 24.3, DEV-TS-006)", () => {
  it("has S5 source files to inspect", () => {
    expect(s5Sources.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps hard-coded Japanese out of the S5 features and pages (copy comes from ja.ts)", () => {
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s5Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("formats money only through the S1 helpers (no literal currency symbol, no floating point)", () => {
    for (const file of s5Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /[¥￥]|toLocaleString|Intl\.NumberFormat|\bparseFloat\b|toFixed\(/,
      );
    }
  });

  it("formats dates only through the JST helpers", () => {
    for (const file of s5Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /toLocaleDateString|toLocaleTimeString|\.getHours\(|\.getDate\(|\.getMonth\(|\.getFullYear\(|Date\.now\(|new Date\(/,
      );
    }
  });

  it("takes colours from the design tokens only (no palette, arbitrary or hex colour)", () => {
    const literalColour =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
    const arbitraryColour =
      /(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch|var\(--color)/;
    for (const file of s5Sources.filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(file, "utf8");
      expect(literalColour.exec(source)?.[0] ?? null, rel(file)).toBeNull();
      expect(arbitraryColour.exec(source)?.[0] ?? null, rel(file)).toBeNull();
      expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(source.replace(/&#\d+;/g, "")), rel(file)).toBe(false);
    }
  });

  it("never uses raw HTML insertion and renders public text through PlainText", () => {
    for (const file of s5Sources) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:/,
      );
    }
    expect(read("src/features/entry/entry-page.tsx")).toMatch(/PlainText/);
    expect(read("src/features/goods/goods-detail-page.tsx")).toMatch(/PlainText/);
  });

  it("keeps the dependency direction: features do not import mock, presentation does not import features", () => {
    for (const file of s5Sources.filter((f) => rel(f).startsWith("src/features/"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/mock\//);
    }
    for (const file of walk(abs("src/presentation")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/features\//);
    }
  });
});

describe("TC-PG-TKT-001-461 the quantity control and live region follow SPEC-050 12.1 / 25", () => {
  const source = stripComments(read("src/features/cart/add-to-cart-form.tsx"));

  it("uses a number input validated through parseQuantityInput and exposes aria-invalid / aria-describedby", () => {
    expect(source).toMatch(/parseQuantityInput/);
    expect(source).toMatch(/type=["']number["']/);
    expect(source).toMatch(/aria-invalid/);
    expect(source).toMatch(/aria-describedby/);
  });

  it("announces the add result through a status live region", () => {
    expect(source).toMatch(/role=["']status["']/);
    expect(source).toMatch(/copy\.sales\.addSucceeded/);
  });

  it("separates a quantity overflow from a storage failure without reading exception classes", () => {
    expect(source).not.toMatch(/instanceof\s+RangeError/);
    expect(source).toMatch(/quantity_overflow/);
    expect(source).toMatch(/copy\.sales\.addQuantityOverflow/);
    expect(source).toMatch(/copy\.sales\.addFailed/);
  });

  it("shows the display total through formatDisplayTotal and the recalculation note", () => {
    expect(source).toMatch(/formatDisplayTotal/);
    expect(source).toMatch(/copy\.sales\.displayTotalNote/);
  });
});
