import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S4 public pages (tests/contracts/s4-public.md sections 0, 3).
// Source reads only; behaviour is covered by the Playwright UI mock suite.

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

/** Route files may live in app/<path> or in the (public) route group. */
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
  "src/config/public-routes.ts",
  "src/features/public/route-params.ts",
  "src/features/public/announcement-model.ts",
  "src/features/public/home-model.ts",
  "src/features/public/home-page.tsx",
  "src/features/public/announcement-list-page.tsx",
  "src/features/public/announcement-detail-page.tsx",
  "src/features/karaoke/karaoke-guide-model.ts",
  "src/features/karaoke/karaoke-day-model.ts",
  "src/features/karaoke/karaoke-guide-page.tsx",
  "src/features/karaoke/karaoke-day-page.tsx",
  "src/features/goods/goods-list-model.ts",
  "src/features/goods/goods-list-page.tsx",
  "src/presentation/components/list-state.ts",
  "src/presentation/components/safe-url.ts",
  "src/presentation/state-mapping/karaoke-sale-status.ts",
  "src/presentation/components/page-state.tsx",
  "src/presentation/components/plain-text.tsx",
  "src/presentation/components/external-link.tsx",
  "src/presentation/components/status-badge.tsx",
  "src/presentation/components/money.tsx",
  "src/presentation/components/date-time.tsx",
  "src/presentation/components/section-heading.tsx",
] as const;

const CONTAINERS = [
  ["src/features/public/home-page.tsx", "buildHomeModel"],
  ["src/features/public/announcement-list-page.tsx", "buildAnnouncementListModel"],
  ["src/features/public/announcement-detail-page.tsx", "buildAnnouncementDetailModel"],
  ["src/features/karaoke/karaoke-guide-page.tsx", "buildKaraokeGuideModel"],
  ["src/features/karaoke/karaoke-day-page.tsx", "buildKaraokeDayModel"],
  ["src/features/goods/goods-list-page.tsx", "buildGoodsListModel"],
] as const;

const PAGES = [
  { path: "page.tsx", title: null, dynamic: false },
  { path: "announcements/page.tsx", title: "announcements", dynamic: false },
  { path: "announcements/[announcementRef]/page.tsx", title: "announcementDetail", dynamic: true },
  { path: "karaoke/page.tsx", title: "karaoke", dynamic: false },
  { path: "karaoke/schedule/[date]/page.tsx", title: "karaokeDay", dynamic: true },
  { path: "goods/page.tsx", title: "goods", dynamic: false },
] as const;

const s4Sources = [
  ...MODULES.map((m) => abs(m)),
  ...PAGES.flatMap((p) => {
    const file = routeFile(p.path);
    return file === null ? [] : [abs(file)];
  }),
].filter((f) => existsSync(f));

describe("TC-PG-PUB-001-612 the S4 modules and routes exist at the contracted paths (SPEC-190 DEV-WEB-001, DEV-REP-006)", () => {
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

describe("TC-PG-PUB-001-612 page.tsx files are thin server shells (DEV-WEB-001, Next 16 async params)", () => {
  for (const page of PAGES) {
    const file = routeFile(page.path);
    const source = file === null ? "" : stripComments(read(file));
    it(`${page.path} is a Server Component that renders a feature container`, () => {
      expect(file, page.path).not.toBeNull();
      expect(source).not.toMatch(/^\s*["']use client["']/);
      expect(source).not.toMatch(/<main[\s>]/);
      expect(source).toMatch(/features\//);
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
    });
    if (page.title !== null) {
      it(`${page.path} sets metadata.title from copy.pageTitle.${page.title}`, () => {
        expect(source).toMatch(/export\s+const\s+metadata/);
        expect(source).toMatch(new RegExp(`copy\\.pageTitle\\.${page.title}\\b`));
      });
    }
    if (page.dynamic) {
      it(`${page.path} awaits params and calls notFound() for an invalid parameter`, () => {
        expect(source).toMatch(/await\s+(props\.)?params|params\s*:\s*Promise</);
        expect(source).toMatch(/notFound\s*\(/);
        expect(source).toMatch(/parseAnnouncementRef|parseBusinessDateParam/);
      });
    }
  }

  it("makes the layout title a template so that pages read 'Page | SITE_NAME' (Home stays SITE_NAME)", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/template/);
    expect(layout).toMatch(/default\s*:/);
  });
});

describe("TC-PG-PUB-001-612 containers fetch through the port after mount and build their view model", () => {
  for (const [path, builder] of CONTAINERS) {
    const source = stripComments(read(path));
    it(`${path} is a client container that reads only through useApi()`, () => {
      expect(source).toMatch(/^\s*["']use client["']/);
      expect(source).toMatch(/\buseApi\s*\(/);
      expect(source).toMatch(/\buseEffect\b/);
      expect(source).toContain(builder);
      expect(source).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
      expect(source).not.toMatch(/\bconsole\s*\./);
    });
  }

  it("the Home container loads the event, a limited announcement list and the FAQs", () => {
    const source = read("src/features/public/home-page.tsx");
    expect(source).toMatch(/getEvent\s*\(/);
    expect(source).toMatch(/listAnnouncements\s*\(\s*\{\s*limit\s*:\s*HOME_NEWS_LIMIT/);
    expect(source).toMatch(/listFaqs\s*\(/);
  });

  it("the day container reads the schedule only (no purchase, Cart or write call)", () => {
    const source = read("src/features/karaoke/karaoke-day-page.tsx");
    expect(source).toMatch(/getKaraokeDay\s*\(/);
    expect(source).not.toMatch(
      /\.purchase\b|startKaraokePurchase|startCartPurchase|startCheckout|cart/i,
    );
  });

  it("the goods container offers no purchase or Cart operation", () => {
    const source = read("src/features/goods/goods-list-page.tsx");
    expect(source).toMatch(/listGoods\s*\(/);
    expect(source).not.toMatch(/\.purchase\b|startCartPurchase|startCheckout|addToCart|cart/i);
  });
});

describe("TC-PG-PUB-001-613 public content is plain text and copy / formatting is centralised (SEC-WEB-017〜020, SPEC-050 24.3)", () => {
  it("has S4 source files to inspect", () => {
    expect(s4Sources.length).toBeGreaterThan(15);
  });

  it("never uses raw HTML insertion, innerHTML or an HTML sanitizer / Markdown renderer", () => {
    for (const file of s4Sources) {
      const source = readFileSync(file, "utf8");
      expect(source, rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/,
      );
      expect(source, rel(file)).not.toMatch(
        /dompurify|sanitize-html|marked|markdown-it|remark|rehype/i,
      );
      expect(source, rel(file)).not.toMatch(/javascript:/i);
    }
  });

  it("keeps hard-coded Japanese out of the S4 features, components and pages (copy comes from ja.ts)", () => {
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s4Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("formats money only through formatMoney (no literal currency symbol or toLocaleString)", () => {
    for (const file of s4Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/[¥￥]|toLocaleString|Intl\.NumberFormat|\bparseFloat\b/);
    }
  });

  it("formats dates only through the JST helpers (no local-time Date accessors)", () => {
    for (const file of s4Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        /toLocaleDateString|toLocaleTimeString|\.getHours\(|\.getDate\(|\.getMonth\(|\.getFullYear\(|Date\.now\(|new Date\(\)/,
      );
    }
  });

  it("renders text through PlainText with a newline-preserving white-space style", () => {
    const source = read("src/presentation/components/plain-text.tsx");
    expect(source).toMatch(/whitespace-pre-line|whitespace-pre-wrap|whiteSpace/);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
    expect(read("src/features/public/announcement-detail-page.tsx")).toMatch(/PlainText/);
    const publicFeature = walk(abs("src/features/public"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(publicFeature).toMatch(/PlainText/);
  });

  it("makes ExternalLink depend on safeExternalHref so that only https becomes a link", () => {
    expect(read("src/presentation/components/external-link.tsx")).toMatch(/safeExternalHref/);
  });

  it("keeps the dependency direction: presentation does not import features, mock or the port factories", () => {
    for (const file of s4Sources.filter((f) => rel(f).startsWith("src/presentation/"))) {
      const source = readFileSync(file, "utf8");
      expect(source, rel(file)).not.toMatch(
        /from\s+["'][^"']*\/(features|mock)\/|api-client\/(index|provider)|auth\/(index|session-provider|use-session)/,
      );
    }
  });
});
