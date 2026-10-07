import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ApiPort,
  PublicApi,
  PurchaseApi,
  SelfApi,
} from "../../../../apps/web/src/api-client/port.ts";
import type {
  Announcement,
  AnnouncementSummary,
  CartLine,
  CartLineResolution,
  CartPurchaseStart,
  CheckoutStart,
  EntryOffering,
  EntryTicketDetail,
  EntryTicketSummary,
  EventInfo,
  FaqItem,
  GoodsDetail,
  GoodsItemDetail,
  GoodsItemSummary,
  GoodsSummary,
  KaraokeDay,
  KaraokePurchaseStart,
  KaraokeSales,
  KaraokeSlotDetail,
  OrderDetail,
  OrderSummary,
  Profile,
  ProfileUpdate,
  QrPresentation,
  Read,
  Ref,
  ReservationDetail,
  ReservationSummary,
  SaleAvailability,
  SponsorLogo,
} from "../../../../apps/web/src/api-client/types.ts";
import type { AuthPort, Session } from "../../../../apps/web/src/auth/port.ts";
import { createBackend } from "../../../harness/mock-backend.ts";

const webDir = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const read = (file: string): string => readFileSync(file, "utf8");
const rel = (file: string): string => relative(webDir, file).replaceAll("\\", "/");

describe("TC-DEV-WEB-010-102 ApiPort and AuthPort have the documented shape (design section 3, DEV-WEB-013)", () => {
  it("exposes exactly the documented methods at runtime", () => {
    const { api, auth } = createBackend();
    expect(Object.keys(api).sort()).toEqual(["public", "purchase", "self"]);
    expect(Object.keys(api.public).sort()).toEqual(
      [
        "getAnnouncement",
        "getEvent",
        "getGoods",
        "getKaraokeDay",
        "getKaraokeSales",
        "getKaraokeSlot",
        "listAnnouncements",
        "listEntryOfferings",
        "listFaqs",
        "listGoods",
        "listSponsorLogos",
        "resolveCartLines",
      ].sort(),
    );
    expect(Object.keys(api.purchase).sort()).toEqual(
      ["startCartPurchase", "startCheckout", "startKaraokePurchase"].sort(),
    );
    expect(Object.keys(api.self).sort()).toEqual(
      [
        "getEntryQr",
        "getEntryTicket",
        "getGoodsItem",
        "getKaraokeQr",
        "getOrder",
        "getProfile",
        "getReservation",
        "listEntryTickets",
        "listGoodsItems",
        "listOrders",
        "listReservations",
        "updateProfile",
      ].sort(),
    );
    expect(Object.keys(auth).sort()).toEqual(
      [
        "completePasswordReset",
        "getSession",
        "onSessionChange",
        "requestPasswordReset",
        "signIn",
        "signOut",
        "signUp",
        "verifyEmail",
      ].sort(),
    );
  });

  it("returns promises from every method (the port is async so a real client can replace it)", async () => {
    const { api } = createBackend();
    const result = api.public.getEvent();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("types the public port methods", () => {
    expectTypeOf<PublicApi["getEvent"]>().returns.resolves.toEqualTypeOf<Read<EventInfo>>();
    expectTypeOf<PublicApi["listFaqs"]>().returns.resolves.toEqualTypeOf<
      Read<readonly FaqItem[]>
    >();
    expectTypeOf<PublicApi["listAnnouncements"]>().returns.resolves.toEqualTypeOf<
      Read<readonly AnnouncementSummary[]>
    >();
    expectTypeOf<PublicApi["getAnnouncement"]>().parameter(0).toEqualTypeOf<Ref<"announcement">>();
    expectTypeOf<PublicApi["getAnnouncement"]>().returns.resolves.toEqualTypeOf<
      Read<Announcement>
    >();
    expectTypeOf<PublicApi["listSponsorLogos"]>().returns.resolves.toEqualTypeOf<
      Read<readonly SponsorLogo[]>
    >();
    expectTypeOf<PublicApi["listEntryOfferings"]>().returns.resolves.toEqualTypeOf<
      Read<readonly EntryOffering[]>
    >();
    expectTypeOf<PublicApi["getKaraokeSales"]>().returns.resolves.toEqualTypeOf<
      Read<KaraokeSales>
    >();
    expectTypeOf<PublicApi["getKaraokeDay"]>().returns.resolves.toEqualTypeOf<Read<KaraokeDay>>();
    expectTypeOf<PublicApi["getKaraokeSlot"]>().parameter(0).toEqualTypeOf<Ref<"slot">>();
    expectTypeOf<PublicApi["getKaraokeSlot"]>().returns.resolves.toEqualTypeOf<
      Read<KaraokeSlotDetail>
    >();
    expectTypeOf<PublicApi["listGoods"]>().returns.resolves.toEqualTypeOf<
      Read<readonly GoodsSummary[]>
    >();
    expectTypeOf<PublicApi["getGoods"]>().returns.resolves.toEqualTypeOf<Read<GoodsDetail>>();
    expectTypeOf<PublicApi["resolveCartLines"]>().parameter(0).toEqualTypeOf<readonly CartLine[]>();
    expectTypeOf<PublicApi["resolveCartLines"]>().returns.resolves.toEqualTypeOf<
      Read<readonly CartLineResolution[]>
    >();
  });

  it("types the purchase and self port methods", () => {
    expectTypeOf<
      PurchaseApi["startCartPurchase"]
    >().returns.resolves.toEqualTypeOf<CartPurchaseStart>();
    expectTypeOf<
      PurchaseApi["startKaraokePurchase"]
    >().returns.resolves.toEqualTypeOf<KaraokePurchaseStart>();
    expectTypeOf<PurchaseApi["startCheckout"]>().returns.resolves.toEqualTypeOf<CheckoutStart>();
    expectTypeOf<PurchaseApi["startCheckout"]>().parameter(0).toEqualTypeOf<Ref<"order">>();
    expectTypeOf<SelfApi["getProfile"]>().returns.resolves.toEqualTypeOf<Read<Profile>>();
    expectTypeOf<SelfApi["updateProfile"]>().returns.resolves.toEqualTypeOf<ProfileUpdate>();
    expectTypeOf<SelfApi["listOrders"]>().returns.resolves.toEqualTypeOf<
      Read<readonly OrderSummary[]>
    >();
    expectTypeOf<SelfApi["getOrder"]>().returns.resolves.toEqualTypeOf<Read<OrderDetail>>();
    expectTypeOf<SelfApi["listEntryTickets"]>().returns.resolves.toEqualTypeOf<
      Read<readonly EntryTicketSummary[]>
    >();
    expectTypeOf<SelfApi["getEntryTicket"]>().returns.resolves.toEqualTypeOf<
      Read<EntryTicketDetail>
    >();
    expectTypeOf<SelfApi["getEntryQr"]>().parameter(0).toEqualTypeOf<Ref<"ticket">>();
    expectTypeOf<SelfApi["getEntryQr"]>().returns.resolves.toEqualTypeOf<Read<QrPresentation>>();
    expectTypeOf<SelfApi["listReservations"]>().returns.resolves.toEqualTypeOf<
      Read<readonly ReservationSummary[]>
    >();
    expectTypeOf<SelfApi["getReservation"]>().returns.resolves.toEqualTypeOf<
      Read<ReservationDetail>
    >();
    expectTypeOf<SelfApi["getKaraokeQr"]>().parameter(0).toEqualTypeOf<Ref<"reservation">>();
    expectTypeOf<SelfApi["listGoodsItems"]>().returns.resolves.toEqualTypeOf<
      Read<readonly GoodsItemSummary[]>
    >();
    expectTypeOf<SelfApi["getGoodsItem"]>().parameter(0).toEqualTypeOf<Ref<"goodsItem">>();
    expectTypeOf<SelfApi["getGoodsItem"]>().returns.resolves.toEqualTypeOf<Read<GoodsItemDetail>>();
    expectTypeOf<ApiPort>().toEqualTypeOf<{
      readonly public: PublicApi;
      readonly purchase: PurchaseApi;
      readonly self: SelfApi;
    }>();
  });

  it("types the auth port", () => {
    expectTypeOf<Session>().toEqualTypeOf<
      { kind: "guest" } | { kind: "authenticated"; email: string; emailVerified: boolean }
    >();
    expectTypeOf<AuthPort["getSession"]>().returns.resolves.toEqualTypeOf<
      { kind: "ok"; session: Session } | { kind: "unavailable" }
    >();
    expectTypeOf<AuthPort["onSessionChange"]>().returns.toEqualTypeOf<() => void>();
    expectTypeOf<AuthPort["signOut"]>().returns.resolves.toEqualTypeOf<{ kind: "signed_out" }>();
  });

  it("makes the Cart unable to represent Karaoke, prices or other fields (FR-CRT-002/003)", () => {
    expectTypeOf<CartLine["kind"]>().toEqualTypeOf<"ENTRY_TICKET" | "GOODS">();
    expectTypeOf<keyof Extract<CartLine, { kind: "GOODS" }>>().toEqualTypeOf<
      "kind" | "goodsRef" | "quantity"
    >();
    expectTypeOf<keyof Extract<CartLine, { kind: "ENTRY_TICKET" }>>().toEqualTypeOf<
      "kind" | "offeringRef" | "quantity"
    >();
    expectTypeOf<Ref<"goods">>().not.toEqualTypeOf<Ref<"order">>();
  });

  it("keeps the S1 SaleAvailability union intact", () => {
    expectTypeOf<SaleAvailability["kind"]>().toEqualTypeOf<
      | "ON_SALE"
      | "BEFORE_SALES"
      | "SALES_ENDED"
      | "SUSPENDED"
      | "SOLD_OUT"
      | "INSUFFICIENT_QUANTITY"
      | "PURCHASE_LIMIT_EXCEEDED"
    >();
  });

  it("makes the QR presentation carry a mock seed only (SEC-QR-012/013)", () => {
    expectTypeOf<Extract<QrPresentation, { kind: "presentable" }>>().toEqualTypeOf<{
      kind: "presentable";
      purpose: "ENTRY" | "KARAOKE";
      mockMatrixSeed: string;
    }>();
  });
});

describe("TC-DEV-WEB-010-103 port doc comments name the Operation ID or the UCR (design section 3, DEV-GEN-003)", () => {
  const portSource = (): string[] => read(join(webDir, "src/api-client/port.ts")).split("\n");

  const methods = [
    "getEvent",
    "listFaqs",
    "listAnnouncements",
    "getAnnouncement",
    "listSponsorLogos",
    "listEntryOfferings",
    "getKaraokeSales",
    "getKaraokeDay",
    "getKaraokeSlot",
    "listGoods",
    "getGoods",
    "resolveCartLines",
    "startCartPurchase",
    "startKaraokePurchase",
    "startCheckout",
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
  ];

  const window = (lines: string[], name: string): string => {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${name}\\(`).test(line));
    expect(index, `${name} must be declared in port.ts`).toBeGreaterThanOrEqual(0);
    return lines.slice(Math.max(0, index - 4), index + 1).join("\n");
  };

  it("annotates every method with an API-* Operation ID or UCR-110-001", () => {
    const lines = portSource();
    for (const name of methods) {
      expect(window(lines, name), name).toMatch(/API-[A-Z]+(-[A-Z]+)*-\d{3}|UCR-110-001/);
    }
  });

  it("marks the ports without an Operation ID as UCR-110-001 / Operation ID なし", () => {
    const lines = portSource();
    for (const name of ["startCartPurchase", "listSponsorLogos"]) {
      expect(window(lines, name), name).toContain("UCR-110-001");
    }
    expect(portSource().join("\n")).toMatch(/Operation ID\s*(なし|none|missing)/i);
  });

  it("does not invent new Operation IDs", () => {
    const ids = new Set(
      read(join(webDir, "src/api-client/port.ts")).match(/API-[A-Z]+(?:-[A-Z]+)*-\d{3}/g) ?? [],
    );
    const allowed = new Set([
      "API-PUB-001",
      "API-PUB-002",
      "API-PUB-003",
      "API-PUB-004",
      "API-PUB-005",
      "API-PUB-006",
      "API-PUB-007",
      "API-PUB-008",
      "API-PUB-009",
      "API-PUB-010",
      "API-PUB-011",
      "API-AUTH-002",
      "API-AUTH-004",
      "API-PUR-KRK-001",
      "API-CHK-001",
      "API-ORD-001",
      "API-ORD-003",
      "API-TKT-001",
      "API-TKT-002",
      "API-TKT-003",
      "API-KRK-SELF-001",
      "API-KRK-SELF-002",
      "API-KRK-SELF-003",
      "API-GDS-SELF-001",
      "API-GDS-SELF-002",
    ]);
    for (const id of ids) expect(allowed.has(id), id).toBe(true);
  });
});

describe("TC-DEV-TS-004-101 zod is the runtime validator and every persisted schema is strict (DEV-TS-004)", () => {
  it("declares zod as a dependency of apps/web", () => {
    const manifest = JSON.parse(read(join(webDir, "package.json"))) as {
      dependencies?: Record<string, string>;
    };
    expect(typeof manifest.dependencies?.zod).toBe("string");
  });

  it.each(["db.ts", "scenario.ts", "session-store.ts"])(
    "validates %s with a strict zod schema",
    (name) => {
      const source = read(join(webDir, "src/mock/backend", name));
      expect(source).toMatch(/from ["']zod["']/);
      expect(source).toMatch(/\.strict\(\)|strictObject\(/);
    },
  );
});

describe("TC-DEV-REL-001-103 mock backend sources use only injected time, randomness and timers (DEV-REL-001, DEV-WEB-013)", () => {
  const backendFiles = sourceFiles(join(webDir, "src/mock/backend"));
  const baseName = (file: string): string => file.split(/[\\/]/).pop() ?? file;
  const except = (name: string) => backendFiles.filter((f) => baseName(f) !== name);

  it("has the documented module files", () => {
    const names = backendFiles.map((f) => rel(f).replace("src/mock/backend/", ""));
    for (const expected of [
      "clock.ts",
      "ids.ts",
      "latency.ts",
      "scenario.ts",
      "purpose.ts",
      "karaoke-buckets.ts",
      "db.ts",
      "seed.ts",
      "session-store.ts",
      "mock-api.ts",
      "mock-auth.ts",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("does not read the system clock or randomness outside the default implementations", () => {
    expect(backendFiles.length).toBeGreaterThan(0);
    for (const file of backendFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/Math\.random\s*\(/);
      expect(source, rel(file)).not.toMatch(/Date\.now\s*\(/);
      expect(source, rel(file)).not.toMatch(/new Date\(\s*\)/);
    }
    for (const file of except("ids.ts")) {
      expect(read(file), rel(file)).not.toMatch(/crypto\.randomUUID|randomUUID\s*\(/);
    }
    for (const file of except("latency.ts")) {
      expect(read(file), rel(file)).not.toMatch(/\bsetTimeout\s*\(/);
    }
  });

  it("does not touch the browser, console or network directly", () => {
    for (const file of backendFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/\b(window|document|localStorage|sessionStorage)\b/);
      expect(source, rel(file)).not.toMatch(/\bconsole\./);
      expect(source, rel(file)).not.toMatch(/\bfetch\s*\(/);
      expect(source, rel(file)).not.toMatch(/:\s*any\b|\bas any\b|as unknown as/);
    }
  });
});

describe("TC-PG-KRK-003-106 no Hold TTL anywhere in mock or UI code (SPEC-050 13.3, design section 4)", () => {
  const roots = ["src/mock", "src/features", "src/api-client", "src/auth", "app"].map((r) =>
    join(webDir, r),
  );
  const files = roots.flatMap((root) => sourceFiles(root));

  it("scans the mock sources (not vacuous)", () => {
    expect(files.some((f) => rel(f).startsWith("src/mock/backend/"))).toBe(true);
  });

  it("has no TTL identifiers, hold expiry timestamps or hold-minute constants", () => {
    for (const file of files) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/TTL|\bttl\b|[a-z]Ttl(?![a-z])/);
      expect(source, rel(file)).not.toMatch(
        /hold[A-Za-z]*(Minutes|Seconds|Expires|ExpiresAt|Until|Duration)/i,
      );
      expect(source, rel(file)).not.toMatch(/\bexpiresAt\b/);
    }
  });

  it("has no 45 / 30 / 5 minute literals tied to a hold", () => {
    for (const file of files) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/\b(?:45|30)\s*(?:分|(?:minutes?|mins?)\b)/i);
      expect(source, rel(file)).not.toMatch(/\b(?:45|30|5)\s*\*\s*60\b/);
      expect(source, rel(file)).not.toMatch(/\b60\s*\*\s*(?:45|30|5)\b/);
      expect(source, rel(file)).not.toMatch(/\b(?:45|30|5)\s*\*\s*60\s*\*\s*1000\b/);
    }
  });
});
