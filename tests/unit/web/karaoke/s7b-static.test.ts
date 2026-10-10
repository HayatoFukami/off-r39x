import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S7b Karaoke slot slice (tests/contracts/s7b-karaoke.md sections 0, 1, 4).
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
  "src/features/karaoke/karaoke-slot-model.ts",
  "src/features/karaoke/karaoke-purchase-flow.ts",
] as const;
const VIEWS = [
  "src/features/karaoke/use-karaoke-purchase.ts",
  "src/features/karaoke/karaoke-slot-page.tsx",
] as const;
const ROUTE = "app/karaoke/slots/[slotRef]/page.tsx";

const s7bSources = [...PURE, ...VIEWS, ROUTE].map((p) => abs(p)).filter((f) => existsSync(f));

describe("TC-DEV-WEB-001-701 the S7b modules and the route exist at the contracted paths (DEV-WEB-001, DEV-REP-006)", () => {
  for (const path of [...PURE, ...VIEWS, ROUTE]) {
    it(`has ${path}`, () => {
      expect(existsSync(abs(path)), path).toBe(true);
    });
  }

  it("route-params exports parseSlotRef next to the S4 parsers", () => {
    const code = stripComments(read("src/features/public/route-params.ts"));
    expect(code).toMatch(/export\s+function\s+parseSlotRef/);
    expect(code).toMatch(/parseAnnouncementRef/);
  });

  it("keeps the ports, the mock backend and the S7a purchase features unchanged in shape (no new method for S7b)", () => {
    const port = stripComments(read("src/api-client/port.ts"));
    expect(port).toMatch(/startKaraokePurchase/);
    expect(port).toMatch(/getKaraokeSlot/);
    expect(port).toMatch(/startCheckout/);
  });
});

describe("TC-DEV-WEB-001-702 the slot route is a thin public server shell (DEV-WEB-001, SPEC-050 5.2 / 13.3)", () => {
  const route = stripComments(read(ROUTE));

  it("validates the param, 404s a bad one, sets the title and renders the container", () => {
    expect(route).not.toMatch(/^\s*["']use client["']/);
    expect(route).toMatch(/export\s+const\s+metadata/);
    expect(route).toMatch(/copy\.pageTitle\.karaokeSlot/);
    expect(route).toMatch(/await\s+params|params\s*\)\s*=>|await\s+props\.params/);
    expect(route).toMatch(/parseSlotRef/);
    expect(route).toMatch(/\bnotFound\s*\(/);
    expect(route).toMatch(/KaraokeSlotPage/);
    expect(route).not.toMatch(/<main[\s>]/);
    expect(route).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(route).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
  });

  it("is a public route: not under (self), not behind the AuthGate", () => {
    expect(ROUTE.startsWith("app/(self)/")).toBe(false);
    expect(ROUTE.startsWith("app/karaoke/")).toBe(true);
  });
});

describe("TC-DEV-WEB-001-703 the pure modules are pure and reuse the shared decisions (DEV-WEB-001, DEV-TS)", () => {
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

  it("the slot model builds on the shared presentations instead of re-deciding states", () => {
    const code = stripComments(read(PURE[0]));
    expect(code).toMatch(/presentSlot/);
    expect(code).toMatch(/presentKaraokeSaleStatus/);
    expect(code).toMatch(/formatMoney/);
    expect(code).toMatch(/formatJstTimeRange/);
    expect(code).toMatch(/karaokeDayHref/);
    expect(code).toMatch(/assertNever|never/);
  });

  it("the purchase flow reuses the S6 Continuation helpers and the S7a checkout decision", () => {
    const code = stripComments(read(PURE[1]));
    expect(code).toMatch(/accountPath/);
    expect(code).toMatch(/karaoke-slot/);
    expect(code).toMatch(/interpretCheckoutStart/);
  });
});

describe("TC-DEV-WEB-001-704 the container and the hook wire the purchase start through the port only and stay apart from the Cart (BR-ORD-019, FR-CRT-002)", () => {
  const hook = stripComments(read(VIEWS[0]));
  const page = stripComments(read(VIEWS[1]));

  it("the hook is a client hook that uses the three pure decisions, a fresh key per attempt and the two port calls", () => {
    expect(hook).toMatch(/^\s*["']use client["']/);
    expect(hook).toMatch(/planKaraokeProceed/);
    expect(hook).toMatch(/interpretKaraokeStart/);
    expect(hook).toMatch(/interpretKaraokeCheckout/);
    expect(hook).toMatch(/startKaraokePurchase/);
    expect(hook).toMatch(/startCheckout/);
    expect(hook).toMatch(/idempotencyKey/);
    expect(hook).toMatch(/crypto\.randomUUID/);
    expect(hook).not.toMatch(/startCartPurchase/);
    expect(hook).not.toMatch(/from\s+["'][^"']*\/mock\//);
    expect(hook).not.toMatch(/\b(localStorage|sessionStorage|fetch)\b/);
  });

  it("neither file touches the Cart (Karaoke is never added to the Cart and never reads it)", () => {
    for (const code of [hook, page]) {
      expect(code).not.toMatch(/useCart|cart-store|addFromOrder|removeLines|r39x\.cart/);
      expect(code).not.toMatch(/copy\.sales\.(add|viewCart|addSucceeded)\b/);
    }
  });

  it("the container reads the slot through the port after mount and shows the contracted states", () => {
    expect(page).toMatch(/^\s*["']use client["']/);
    expect(page).toMatch(/useApi\s*\(/);
    expect(page).toMatch(/getKaraokeSlot/);
    expect(page).toMatch(/useEffect/);
    expect(page).toMatch(/buildKaraokeSlotModel/);
    expect(page).toMatch(/useKaraokePurchase/);
    expect(page).toMatch(/NotFoundView/);
    expect(page).toMatch(/PageState/);
    expect(page).toMatch(/role=["']alert["']/);
    expect(page).toMatch(/role=["']status["']/);
    expect(page).toMatch(/tabIndex/);
    expect(page).toMatch(/aria-busy/);
    expect(page).toMatch(/aria-describedby/);
    expect(page).toMatch(/copy\.karaoke\.slotDetail\./);
    expect(page).not.toMatch(/<li[\s>]/);
    expect(page).not.toMatch(/from\s+["'][^"']*\/mock\//);
  });

  it("no Hold duration is defined anywhere in the S7b sources (no TTL in the UI, design 4)", () => {
    for (const file of s7bSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/\bttl\b|setInterval|expiresAt|countdown/i);
      expect(code, rel(file)).not.toMatch(/\b\d+\s*\*\s*(60|1000)\b/);
    }
  });

  it("keeps hard-coded Japanese and the yen sign out of the S7b sources (copy comes from ja.ts)", () => {
    expect(s7bSources.length).toBe(PURE.length + VIEWS.length + 1);
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s7bSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line) || /[¥￥]/.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("takes colours from the design tokens only and never logs or renders raw HTML", () => {
    const literalColour =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
    for (const file of s7bSources) {
      const raw = readFileSync(file, "utf8");
      expect(stripComments(raw), rel(file)).not.toMatch(/\bconsole\s*\./);
      expect(raw, rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:/,
      );
      if (file.endsWith(".tsx")) {
        expect(literalColour.exec(raw)?.[0] ?? null, rel(file)).toBeNull();
        expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(raw.replace(/&#\d+;/g, "")), rel(file)).toBe(false);
      }
    }
  });

  it("does not import the mock, the Administrator / Staff area or the dev area from any S7b file", () => {
    for (const file of s7bSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(code, rel(file)).not.toMatch(/["'`]\/(admin|staff|dev)(\/|["'`])/);
    }
  });

  it("no general navigation, footer or drawer links to the slot area with a fixed slot", () => {
    for (const file of walk(abs("src/presentation/layout"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/karaoke\/slots/);
    }
  });
});
