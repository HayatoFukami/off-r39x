import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static checks for the S8 Mypage slice (tests/contracts/s8-mypage.md sections 0, 1, 4, 5).
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
  "src/config/mypage-routes.ts",
  "src/features/mypage/order-list-model.ts",
  "src/features/mypage/order-detail-model.ts",
  "src/features/mypage/entry-ticket-model.ts",
  "src/features/mypage/reservation-model.ts",
  "src/features/mypage/goods-item-model.ts",
  "src/features/mypage/qr-model.ts",
  "src/features/mypage/profile-model.ts",
  "src/features/mypage/overview-model.ts",
] as const;

const CONTAINERS = [
  "src/features/mypage/mypage-overview-page.tsx",
  "src/features/mypage/profile-page.tsx",
  "src/features/mypage/order-list-page.tsx",
  "src/features/mypage/order-detail-page.tsx",
  "src/features/mypage/entry-ticket-list-page.tsx",
  "src/features/mypage/entry-ticket-detail-page.tsx",
  "src/features/mypage/entry-qr-page.tsx",
  "src/features/mypage/reservation-list-page.tsx",
  "src/features/mypage/reservation-detail-page.tsx",
  "src/features/mypage/karaoke-qr-page.tsx",
  "src/features/mypage/goods-item-list-page.tsx",
  "src/features/mypage/goods-item-detail-page.tsx",
] as const;

const VIEWS = [
  "src/features/mypage/mypage-nav.tsx",
  "src/presentation/components/qr-placeholder.tsx",
] as const;

const ROUTES = {
  overview: "app/(self)/mypage/page.tsx",
  profile: "app/(self)/mypage/profile/page.tsx",
  orders: "app/(self)/mypage/orders/page.tsx",
  order: "app/(self)/mypage/orders/[orderRef]/page.tsx",
  tickets: "app/(self)/mypage/entry-tickets/page.tsx",
  ticket: "app/(self)/mypage/entry-tickets/[ticketRef]/page.tsx",
  ticketQr: "app/(self)/mypage/entry-tickets/[ticketRef]/qr/page.tsx",
  reservations: "app/(self)/mypage/karaoke/page.tsx",
  reservation: "app/(self)/mypage/karaoke/[reservationRef]/page.tsx",
  reservationQr: "app/(self)/mypage/karaoke/[reservationRef]/qr/page.tsx",
  goodsItems: "app/(self)/mypage/goods/page.tsx",
  goodsItem: "app/(self)/mypage/goods/[goodsItemRef]/page.tsx",
} as const;
const LAYOUT = "app/(self)/mypage/layout.tsx";

const s8Sources = [...PURE, ...CONTAINERS, ...VIEWS, ...Object.values(ROUTES), LAYOUT]
  .map((p) => abs(p))
  .filter((f) => existsSync(f));

describe("TC-DEV-WEB-001-802 the S8 modules and routes exist at the contracted paths (DEV-WEB-001, DEV-REP-006)", () => {
  for (const path of [...PURE, ...CONTAINERS, ...VIEWS, ...Object.values(ROUTES), LAYOUT]) {
    it(`has ${path}`, () => {
      expect(existsSync(abs(path)), path).toBe(true);
    });
  }

  it("keeps the mock backend and the ports unchanged in shape (no new port method for S8)", () => {
    const port = stripComments(read("src/api-client/port.ts"));
    for (const method of [
      "getProfile",
      "updateProfile",
      "listOrders",
      "getOrder",
      "listEntryTickets",
      "getEntryTicket",
      "getEntryQr",
      "listReservations",
      "getReservation",
      "getKaraokeQr",
      "listGoodsItems",
      "getGoodsItem",
    ]) {
      expect(port, method).toMatch(new RegExp(`\\b${method}\\b`));
    }
  });
});

describe("TC-DEV-WEB-001-803 the S8 page.tsx files are thin server shells that never reveal the target (DEV-WEB-001, SPEC-050 5.2 / 19.2)", () => {
  const titles: Record<keyof typeof ROUTES, RegExp> = {
    overview: /copy\.mypage\.pageTitle/,
    profile: /copy\.mypage\.profile\.pageTitle/,
    orders: /copy\.mypage\.orders\.pageTitle/,
    order: /copy\.mypage\.orders\.detail\.pageTitle/,
    tickets: /copy\.mypage\.entryTickets\.pageTitle/,
    ticket: /copy\.mypage\.entryTickets\.detail\.pageTitle/,
    ticketQr: /copy\.qr\.ENTRY/,
    reservations: /copy\.mypage\.reservations\.pageTitle/,
    reservation: /copy\.mypage\.reservations\.detail\.pageTitle/,
    reservationQr: /copy\.qr\.KARAOKE/,
    goodsItems: /copy\.mypage\.goodsItems\.pageTitle/,
    goodsItem: /copy\.mypage\.goodsItems\.detail\.pageTitle/,
  };

  for (const [key, path] of Object.entries(ROUTES) as [keyof typeof ROUTES, string][]) {
    it(`${path} is a Server Component with metadata, no <main>, no storage, no mock`, () => {
      const code = stripComments(read(path));
      expect(code.length, path).toBeGreaterThan(0);
      expect(code).not.toMatch(/^\s*["']use client["']/);
      expect(code).toMatch(/export\s+const\s+metadata/);
      expect(code).toMatch(titles[key]);
      expect(code).not.toMatch(/<main[\s>]/);
      expect(code).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(code).not.toMatch(/\b(fetch|localStorage|sessionStorage)\b/);
    });
  }

  const guarded: [keyof typeof ROUTES, RegExp, RegExp][] = [
    ["order", /parseOrderRef/, /copy\.accessDenied\.ordersLink/],
    ["ticket", /parseTicketRef/, /copy\.accessDenied\.entryTicketsLink/],
    ["ticketQr", /parseTicketRef/, /copy\.accessDenied\.entryTicketsLink/],
    ["reservation", /parseReservationRef/, /copy\.accessDenied\.reservationsLink/],
    ["reservationQr", /parseReservationRef/, /copy\.accessDenied\.reservationsLink/],
    ["goodsItem", /parseGoodsItemRef/, /copy\.accessDenied\.goodsItemsLink/],
  ];
  for (const [key, parser, label] of guarded) {
    it(`${ROUTES[key]} awaits params and shows Access Denied (HTTP 200, never notFound) for a malformed ref`, () => {
      const code = stripComments(read(ROUTES[key]));
      expect(code).toMatch(/await\s+params|params\s*\)\s*=>|await\s+props\.params/);
      expect(code).toMatch(parser);
      expect(code).toMatch(/AccessDeniedView/);
      expect(code).toMatch(label);
      expect(code).not.toMatch(/\bnotFound\s*\(/);
    });
  }

  it("each page route renders its container and the QR routes the QR containers", () => {
    const expected: [keyof typeof ROUTES, string][] = [
      ["overview", "MypageOverviewPage"],
      ["profile", "ProfilePage"],
      ["orders", "MypageOrderListPage"],
      ["order", "MypageOrderDetailPage"],
      ["tickets", "EntryTicketListPage"],
      ["ticket", "EntryTicketDetailPage"],
      ["ticketQr", "EntryQrPage"],
      ["reservations", "ReservationListPage"],
      ["reservation", "ReservationDetailPage"],
      ["reservationQr", "KaraokeQrPage"],
      ["goodsItems", "GoodsItemListPage"],
      ["goodsItem", "GoodsItemDetailPage"],
    ];
    for (const [key, name] of expected) {
      expect(stripComments(read(ROUTES[key])), ROUTES[key]).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("the S6 placeholder is gone: /mypage renders the Overview and the marker copy key is not used anywhere", () => {
    expect(stripComments(read(ROUTES.overview))).not.toMatch(/protectedMarker/);
    for (const file of walk(abs("src")).concat(walk(abs("app")))) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/protectedMarker/);
    }
  });

  it("the (self) layout still wraps everything in AuthGate and the Mypage layout only adds the local navigation", () => {
    const self = stripComments(read("app/(self)/layout.tsx"));
    expect(self).toMatch(/AuthGate/);
    const layout = stripComments(read(LAYOUT));
    expect(layout).not.toMatch(/^\s*["']use client["']/);
    expect(layout).toMatch(/MypageNav/);
    expect(layout).toMatch(/children/);
    expect(layout).not.toMatch(/<main[\s>]/);
    expect(layout).not.toMatch(/AuthGate/);
  });
});

describe("TC-DEV-WEB-001-804 the pure modules are pure and build on the shared presentations (DEV-WEB-001, DEV-TS)", () => {
  for (const path of PURE) {
    it(`${path} imports no React, Next, storage, clock, random or mock backend`, () => {
      const code = stripComments(read(path));
      expect(code.length, path).toBeGreaterThan(0);
      expect(code, path).not.toMatch(/from\s+["'](react|next)[/"']/);
      expect(code, path).not.toMatch(/\b(localStorage|sessionStorage|document|window|fetch)\b/);
      expect(code, path).not.toMatch(/from\s+["'][^"']*\/mock\//);
      expect(code, path).not.toMatch(
        /\b(Date\.now|new Date\(\)|Math\.random|crypto\.randomUUID)\b/,
      );
      expect(code, path).not.toMatch(/\bconsole\s*\./);
    });
  }

  it("the models reuse the S1 mappings instead of re-deciding states", () => {
    expect(stripComments(read("src/features/mypage/entry-ticket-model.ts"))).toMatch(
      /presentEntryTicket/,
    );
    expect(stripComments(read("src/features/mypage/reservation-model.ts"))).toMatch(
      /presentReservationTicket/,
    );
    expect(stripComments(read("src/features/mypage/goods-item-model.ts"))).toMatch(
      /presentGoodsItem/,
    );
    expect(stripComments(read("src/features/mypage/order-list-model.ts"))).toMatch(
      /presentOrderState/,
    );
    expect(stripComments(read("src/features/mypage/order-detail-model.ts"))).toMatch(
      /buildPurchaseStatusModel/,
    );
    const qr = stripComments(read("src/features/mypage/qr-model.ts"));
    expect(qr).toMatch(/presentEntryTicket/);
    expect(qr).toMatch(/presentReservationTicket/);
    expect(stripComments(read("src/features/mypage/overview-model.ts"))).toMatch(
      /OrderListRow|buildOrderListModel/,
    );
  });

  it("the Overview model has no clock: 'upcoming' comes from server state only", () => {
    expect(stripComments(read("src/features/mypage/overview-model.ts"))).not.toMatch(
      /\bDate\b|usageEnd|\bnow\b/i,
    );
  });
});

describe("TC-DEV-WEB-001-805 the containers read through useApi() only and write nothing except the Profile and the shared Order actions (DEV-WEB-009)", () => {
  for (const path of CONTAINERS) {
    it(`${path} is a client container that uses the port provider and never the mock, storage or console`, () => {
      const code = stripComments(read(path));
      expect(code.length, path).toBeGreaterThan(0);
      expect(code).toMatch(/^\s*["']use client["']/);
      expect(code).not.toMatch(/createApiPort|createMockApi|from\s+["'][^"']*\/mock\//);
      expect(code).not.toMatch(/\b(localStorage|sessionStorage|document\.cookie|fetch)\b/);
      expect(code).not.toMatch(/\bconsole\s*\./);
      expect(code).not.toMatch(/dangerouslySetInnerHTML/);
    });
  }

  const readOnly = CONTAINERS.filter(
    (p) => !p.endsWith("profile-page.tsx") && !p.endsWith("order-detail-page.tsx"),
  );
  for (const path of readOnly) {
    it(`${path} is read-only: no purchase, no checkout, no profile update`, () => {
      const code = stripComments(read(path));
      expect(code.length, path).toBeGreaterThan(0);
      expect(code).not.toMatch(
        /\b(?:api|port)\.purchase\b|\bpurchase\.start\w*|startCartPurchase|startKaraokePurchase|startCheckout|updateProfile/,
      );
    });
  }

  it("each container reads the port methods its page needs, and not those of another purpose", () => {
    const expectCalls = (path: string, present: string[], absent: string[] = []): void => {
      const code = stripComments(read(path));
      for (const name of present)
        expect(code, `${path} ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      for (const name of absent)
        expect(code, `${path} !${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    };
    expectCalls("src/features/mypage/mypage-overview-page.tsx", [
      "getProfile",
      "listOrders",
      "listEntryTickets",
      "listReservations",
      "listGoodsItems",
      "buildMypageOverviewModel",
    ]);
    expectCalls("src/features/mypage/profile-page.tsx", [
      "getProfile",
      "updateProfile",
      "buildProfileModel",
      "interpretProfileSave",
    ]);
    expectCalls("src/features/mypage/order-list-page.tsx", ["listOrders", "buildOrderListModel"]);
    expectCalls("src/features/mypage/entry-ticket-list-page.tsx", [
      "listEntryTickets",
      "buildEntryTicketListModel",
    ]);
    expectCalls(
      "src/features/mypage/entry-ticket-detail-page.tsx",
      ["getEntryTicket", "buildEntryTicketDetailModel"],
      ["getEntryQr", "getKaraokeQr"],
    );
    expectCalls(
      "src/features/mypage/entry-qr-page.tsx",
      ["getEntryTicket", "getEntryQr", "buildEntryQrModel", "QrPlaceholder"],
      ["getKaraokeQr", "getReservation"],
    );
    expectCalls("src/features/mypage/reservation-list-page.tsx", [
      "listReservations",
      "buildReservationListModel",
    ]);
    expectCalls(
      "src/features/mypage/reservation-detail-page.tsx",
      ["getReservation", "buildReservationDetailModel"],
      ["getKaraokeQr", "getEntryQr"],
    );
    expectCalls(
      "src/features/mypage/karaoke-qr-page.tsx",
      ["getReservation", "getKaraokeQr", "buildKaraokeQrModel", "QrPlaceholder"],
      ["getEntryQr", "getEntryTicket"],
    );
    expectCalls("src/features/mypage/goods-item-list-page.tsx", [
      "listGoodsItems",
      "buildGoodsItemListModel",
    ]);
    expectCalls("src/features/mypage/goods-item-detail-page.tsx", [
      "getGoodsItem",
      "buildGoodsItemDetailModel",
    ]);
  });

  it("the Order detail container uses the shared outcome part and Access Denied with the Orders list as the way back", () => {
    const code = stripComments(read("src/features/mypage/order-detail-page.tsx"));
    expect(code).toMatch(/OrderOutcome|PurchaseStatusPage/);
    expect(code).toMatch(/buildMypageOrderDetailModel|PurchaseStatusPage/);
    expect(code).toMatch(/AccessDeniedView|PurchaseStatusPage/);
    expect(code).toMatch(/copy\.mypage\.orders\.detail\./);
  });

  it("the Goods detail container has no button at all (a COMPLETED item can never be set back to PENDING)", () => {
    const code = stripComments(read("src/features/mypage/goods-item-detail-page.tsx"));
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/<button[\s>]|<Button[\s>]|onClick/);
  });

  it("the Entry Ticket and Reservation details explain a disabled QR action with described text, not by disabling alone", () => {
    for (const path of [
      "src/features/mypage/entry-ticket-detail-page.tsx",
      "src/features/mypage/reservation-detail-page.tsx",
    ]) {
      const code = stripComments(read(path));
      expect(code, path).toMatch(/\bdisabled\b/);
      expect(code, path).toMatch(/aria-describedby/);
      expect(code, path).toMatch(/qr\.reason|\.reason\b/);
    }
  });

  it("the Overview renders each area through PageState so a failed read is a distinct, retryable state", () => {
    const code = stripComments(read("src/features/mypage/mypage-overview-page.tsx"));
    expect(code).toMatch(/PageState/);
    expect(code).toMatch(/aria-labelledby/);
    expect(code).toMatch(/copy\.mypage\.overview\./);
  });

  it("the Profile container keeps a single text input, a status live region and an error summary that can take focus", () => {
    const code = stripComments(read("src/features/mypage/profile-page.tsx"));
    expect(code.match(/<input[\s>]/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/<textarea|<select|type=["']hidden["']/);
    expect(code).toMatch(/role=["']status["']/);
    expect(code).toMatch(/role=["']alert["']/);
    expect(code).toMatch(/tabIndex/);
    expect(code).toMatch(/aria-invalid/);
    expect(code).toMatch(/aria-describedby/);
    expect(code).toMatch(/aria-busy/);
    expect(code).toMatch(/<form[\s>]/);
    expect(code).toMatch(/updateProfile\(\s*\{\s*displayName/);
  });
});

describe("TC-SEC-QR-013-601 the QR placeholder never writes the mock seed anywhere (SEC-QR-012 / 013, AGENTS.md section 3)", () => {
  const code = stripComments(read("src/presentation/components/qr-placeholder.tsx"));

  it("is an image with an accessible name taken from props, drawn from the seed and nothing else", () => {
    expect(code.length).toBeGreaterThan(0);
    expect(code).toMatch(/role=["']img["']/);
    expect(code).toMatch(/aria-label=\{label\}/);
    expect(code).toMatch(/matrixSeed/);
    expect(code).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|fetch|console)\b/);
    expect(code).not.toMatch(/from\s+["'][^"']*\/(mock|features)\//);
  });

  it("does not put the seed in an attribute, an id, a title or as text", () => {
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/\b(data-[\w-]+|title|alt|id|key)=\{[^}]*matrixSeed[^}]*\}/);
    expect(code).not.toMatch(/>\s*\{[^}]*matrixSeed[^}]*\}\s*</);
    expect(code).not.toMatch(/<(title|desc)[\s>]/);
    expect(code).not.toMatch(/mock-seed/);
  });

  it("the QR containers pass the seed only to the placeholder and print no seed", () => {
    for (const path of [
      "src/features/mypage/entry-qr-page.tsx",
      "src/features/mypage/karaoke-qr-page.tsx",
    ]) {
      const container = stripComments(read(path));
      expect(container, path).toMatch(/<figure[\s>]/);
      expect(container, path).toMatch(/<figcaption[\s>]/);
      expect(container, path).toMatch(/QrPlaceholder/);
      expect(container, path).toMatch(/copy\.mypage\.qr\./);
      expect(container, path).not.toMatch(/\{[^}]*matrixSeed[^}]*\}\s*<\/(p|span|div|li)>/);
      expect(container, path).not.toMatch(
        /router\.(push|replace)\([^)]*matrixSeed|href=\{[^}]*matrixSeed/,
      );
    }
  });
});

describe("TC-DEV-WEB-001-806 the Mypage navigation is a labelled, current-aware disclosure on Mobile (SPEC-050 17.2, 24.1, 25)", () => {
  const code = stripComments(read("src/features/mypage/mypage-nav.tsx"));

  it("is a landmark with the contracted name, six links from the route table and aria-current", () => {
    expect(code.length).toBeGreaterThan(0);
    expect(code).toMatch(/^\s*["']use client["']/);
    expect(code).toMatch(/<nav[\s>]/);
    expect(code).toMatch(/copy\.mypage\.nav\.label/);
    expect(code).toMatch(/copy\.mypage\.nav\.items/);
    expect(code).toMatch(/MYPAGE_NAV_KEYS/);
    expect(code).toMatch(/MYPAGE_PATHS/);
    expect(code).toMatch(/currentNavKey/);
    expect(code).toMatch(/aria-current/);
    expect(code).toMatch(/usePathname/);
  });

  it("has an expandable toggle with aria-expanded and aria-controls, and no list markup or headings", () => {
    expect(code).toMatch(/copy\.mypage\.nav\.toggle/);
    expect(code).toMatch(/aria-expanded/);
    expect(code).toMatch(/aria-controls/);
    expect(code).not.toMatch(/<(ul|ol|li)[\s>]/);
    expect(code).not.toMatch(/<h[1-6][\s>]/);
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|console)\b/);
  });
});

describe("TC-DEV-WEB-001-807 S8 copy, colour and dependency direction (SPEC-050 24.3, DEV-DEP-006)", () => {
  it("has S8 source files to inspect", () => {
    expect(s8Sources.length).toBeGreaterThanOrEqual(35);
  });

  it("keeps hard-coded Japanese and the yen sign out of the S8 sources (copy comes from ja.ts)", () => {
    const japanese = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
    for (const file of s8Sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.split("\n").find((line) => japanese.test(line) || /[¥￥]/.test(line));
      expect(hit ?? null, rel(file)).toBeNull();
    }
  });

  it("takes colours from the design tokens only", () => {
    const literalColour =
      /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
    for (const file of s8Sources.filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(file, "utf8");
      expect(literalColour.exec(source)?.[0] ?? null, rel(file)).toBeNull();
      expect(/#[0-9a-fA-F]{3,8}\b(?!-)/.test(source.replace(/&#\d+;/g, "")), rel(file)).toBe(false);
    }
  });

  it("never logs, renders raw HTML or builds a javascript: URL", () => {
    for (const file of s8Sources) {
      const raw = readFileSync(file, "utf8");
      expect(stripComments(raw), rel(file)).not.toMatch(/\bconsole\s*\./);
      expect(raw, rel(file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|javascript:/,
      );
    }
  });

  it("features do not import mock; presentation does not import features; nothing imports from tests", () => {
    for (const file of s8Sources.filter((f) => rel(f).startsWith("src/features/"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/mock\//);
    }
    for (const file of walk(abs("src/presentation")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/features\//);
    }
    for (const file of s8Sources) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from\s+["'][^"']*\/tests\//);
    }
  });

  it("shows no internal id: no S8 view prints an Order / Ticket / Reservation / Goods ref as text", () => {
    for (const file of s8Sources.filter(
      (f) => f.endsWith(".tsx") && rel(f).startsWith("src/features/"),
    )) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(
        />\s*\{(?:\w+\.)*(?:orderRef|ticketRef|reservationRef|goodsItemRef|slotRef)\}\s*</,
      );
    }
  });
});
