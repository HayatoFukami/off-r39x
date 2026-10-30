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
  EligibilityTarget,
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
  PurchaseEligibility,
  PurchaseEligibilityRead,
  PurchaseReason,
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
import { SLOT } from "../../../harness/mock-seed.ts";
import { PURCHASE_REASONS } from "../../../harness/purchase-reasons.ts";

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
      [
        "getPurchaseEligibility",
        "startCartPurchase",
        "startCheckout",
        "startKaraokePurchase",
      ].sort(),
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
        "requestEmailOtp",
        "requestPasswordReset",
        "signIn",
        "signInWithEmailOtp",
        "signOut",
        "signUp",
        "startGoogleSignIn",
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

  it("returns promises from the Email OTP methods and answers with the documented kinds (B5 C1)", async () => {
    const otp = createBackend().auth;
    const requested = otp.requestEmailOtp({ email: "demo@example.com" });
    expect(requested).toBeInstanceOf(Promise);
    expect((await requested).kind).toBe("sent");
    const signedIn = otp.signInWithEmailOtp({ email: "demo@example.com", code: "246810" });
    expect(signedIn).toBeInstanceOf(Promise);
    expect((await signedIn).kind).toBe("signed_in");
  });

  it("returns a promise from startGoogleSignIn and answers with the documented kinds (B5 C2)", async () => {
    const google = createBackend().auth;
    const started = google.startGoogleSignIn({
      successPath: "/account/login?returned=google",
      failurePath: "/account/login?notice=google-failed",
    });
    expect(started).toBeInstanceOf(Promise);
    expect((await started).kind).toBe("redirect");
  });

  it("documents startGoogleSignIn in auth/port.ts: a Neon Auth transport without a business Operation ID, an outcome the Promise does not report, same-origin PG-AUTH paths (B5 C2, SPEC-110 23.1, AR-CONT-001, SEC-WEB-013)", () => {
    const lines = read(join(webDir, "src/auth/port.ts")).split("\n");
    const index = lines.findIndex((line) => /^\s*startGoogleSignIn\(/.test(line));
    expect(index, "startGoogleSignIn must be declared in auth/port.ts").toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (let i = index - 1; i >= 0; i -= 1) {
      const text = (lines[i] ?? "").trim();
      if (!/^(\/\*|\*|\/\/)/.test(text)) break;
      block.unshift(text);
    }
    const annotation = block.join("\n");
    expect(annotation).toMatch(/Neon Auth/);
    expect(annotation).toContain("23.1");
    expect(annotation).toMatch(/Operation ID/);
    expect(annotation).not.toMatch(/API-[A-Z]+(?:-[A-Z]+)*-\d{3}/);
    expect(annotation).not.toMatch(/UCR-/);
    // The result of the sign-in is not known from this Promise; the paths are the same origin's PG-AUTH pages.
    expect(annotation).toMatch(/outcome/i);
    expect(annotation).toMatch(/same origin/i);
    expect(annotation).toContain("AR-CONT-001");
    expect(annotation).toContain("SEC-WEB-013");
  });

  it("documents the Email OTP methods in auth/port.ts: a Neon Auth transport without a business Operation ID, an answer that never discloses the account, a code that is never kept (B5 C1, SPEC-110 23.1, SEC-API-027, SEC-AUTH-018)", () => {
    const lines = read(join(webDir, "src/auth/port.ts")).split("\n");
    const annotationOf = (name: string): string => {
      const index = lines.findIndex((line) => new RegExp(`^\\s*${name}\\(`).test(line));
      expect(index, `${name} must be declared in auth/port.ts`).toBeGreaterThanOrEqual(0);
      const block: string[] = [];
      for (let i = index - 1; i >= 0; i -= 1) {
        const text = (lines[i] ?? "").trim();
        if (!/^(\/\*|\*|\/\/)/.test(text)) break;
        block.unshift(text);
      }
      return block.join("\n");
    };
    const request = annotationOf("requestEmailOtp");
    const verify = annotationOf("signInWithEmailOtp");
    for (const annotation of [request, verify]) {
      expect(annotation).toMatch(/Neon Auth/);
      expect(annotation).toContain("23.1");
      expect(annotation).toMatch(/Operation ID/);
      // A business Operation ID would be a claim that the Hono API owns this call; it does not.
      expect(annotation).not.toMatch(/API-[A-Z]+(?:-[A-Z]+)*-\d{3}/);
      expect(annotation).not.toMatch(/UCR-/);
    }
    expect(request).toContain("SEC-API-027");
    expect(request).toMatch(/registered/i);
    expect(verify).toContain("SEC-AUTH-018");
    expect(verify).toContain("code_expired");
    expect(verify).toMatch(/attempt/i);
    expect(verify).toMatch(/resend/i);
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

  it("types getPurchaseEligibility as the owner-scoped read of API-PUR-ELG-001 (input Cart lines or one KARAOKE slot, never a Read<T>)", () => {
    type Method = PurchaseApi["getPurchaseEligibility"];
    expectTypeOf<Method>().parameter(0).toEqualTypeOf<readonly EligibilityTarget[]>();
    expectTypeOf<EligibilityTarget>().toEqualTypeOf<
      CartLine | { kind: "KARAOKE"; slotRef: Ref<"slot">; quantity: 1 }
    >();
    // FR-CRT-002: Karaoke is checked through the target union and never becomes a Cart line.
    expectTypeOf<Extract<CartLine, { kind: "KARAOKE" }>>().toBeNever();
    expectTypeOf<Method>().returns.resolves.toEqualTypeOf<PurchaseEligibilityRead>();
    expectTypeOf<PurchaseEligibilityRead["kind"]>().toEqualTypeOf<
      "ok" | "auth_required" | "email_unverified" | "unavailable"
    >();
    expectTypeOf<Extract<PurchaseEligibilityRead, { kind: "ok" }>["data"]>().toEqualTypeOf<
      readonly PurchaseEligibility[]
    >();
    expectTypeOf<PurchaseEligibility>().toEqualTypeOf<{
      lineKey: string;
      purchasable: boolean;
      reasons: readonly PurchaseReason[];
      maxPurchasableQuantity: number;
    }>();
  });

  it("returns a promise from getPurchaseEligibility and never answers a Cart line without an owner gate", async () => {
    const { api } = createBackend();
    const result = api.purchase.getPurchaseEligibility([
      {
        kind: "ENTRY_TICKET",
        offeringRef: "e0000000-0000-4000-8000-000000000001" as Ref<"offering">,
        quantity: 1,
      },
    ]);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual({ kind: "auth_required" });
  });

  it("accepts a KARAOKE target (quantity 1) on the same method and answers a guest with auth_required (no new method, API-PUR-ELG-001)", async () => {
    const { api } = createBackend();
    const result = api.purchase.getPurchaseEligibility([
      { kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 1 },
    ]);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual({ kind: "auth_required" });
  });

  it("declares the KARAOKE variant in the target union, keeps it out of CartLine and types the method input with it (source)", () => {
    const types = read(join(webDir, "src/api-client/types.ts"));
    const target = /export type EligibilityTarget =([\s\S]*?\});/.exec(types)?.[1] ?? "";
    expect(target, "EligibilityTarget must be exported from api-client/types.ts").not.toBe("");
    expect(target).toMatch(/\bCartLine\b/);
    expect(target).toMatch(/kind:\s*"KARAOKE"/);
    expect(target).toMatch(/slotRef:\s*Ref<"slot">/);
    expect(target).toMatch(/quantity:\s*1\b/);
    const cartLine = /export type CartLine =([\s\S]*?\});/.exec(types)?.[1] ?? "";
    expect(cartLine).not.toBe("");
    expect(cartLine).not.toMatch(/KARAOKE/);
    const port = read(join(webDir, "src/api-client/port.ts"));
    expect(port).toMatch(
      /getPurchaseEligibility\(\s*targets:\s*readonly EligibilityTarget\[\]\s*\)/,
    );
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

  it("shapes the Cart purchase start as API-PUR-CART-001: one Order for every line, or item failures with API-PUR-ELG-001 reasons", () => {
    expectTypeOf<Extract<CartPurchaseStart, { kind: "created" }>>().toEqualTypeOf<{
      kind: "created";
      orderRef: Ref<"order">;
    }>();
    expectTypeOf<Extract<CartPurchaseStart, { kind: "rejected" }>>().toEqualTypeOf<{
      kind: "rejected";
      itemFailures: readonly { lineKey: string; reasons: readonly PurchaseReason[] }[];
    }>();
    expectTypeOf<PurchaseReason>().toEqualTypeOf<
      | "NOT_PUBLIC_OR_NOT_FOUND"
      | "SALES_NOT_STARTED"
      | "SALES_CLOSED"
      | "SALES_STOPPED"
      | "SOLD_OUT"
      | "INSUFFICIENT_QUANTITY"
      | "PURCHASE_LIMIT_EXCEEDED"
      | "SLOT_UNAVAILABLE"
      | "PAYMENT_WINDOW_TOO_SHORT"
    >();
    expectTypeOf<CartPurchaseStart["kind"]>().toEqualTypeOf<
      "created" | "rejected" | "auth_required" | "email_unverified" | "unavailable"
    >();
  });

  it("declares that shape in types.ts: the 9 reasons in the canonical order, no partial inclusion, no retired reason", () => {
    const types = read(join(webDir, "src/api-client/types.ts"));
    const code = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const block = /export type PurchaseReason\s*=([^;]*);/.exec(code);
    expect(block, "types.ts must export PurchaseReason").not.toBeNull();
    const declared = [...(block?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(declared).toEqual([...PURCHASE_REASONS]);
    expect(code).toMatch(/itemFailures/);
    expect(code).not.toMatch(/includedLineKeys/);
    expect(code).not.toMatch(/ALLOCATION_CONFLICT/);
    expect(code).not.toMatch(/CartRejectionReasonCode/);
    expect(code).not.toMatch(/\brejections\b/);
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

  it("types the Email OTP methods (B5 C1): the request never reveals the account, the verification separates a wrong code from an expired one", () => {
    expectTypeOf<AuthPort["requestEmailOtp"]>().parameters.toEqualTypeOf<[{ email: string }]>();
    expectTypeOf<AuthPort["requestEmailOtp"]>().returns.resolves.toEqualTypeOf<
      { kind: "sent" } | { kind: "unavailable" } | { kind: "cart_busy" } | { kind: "cart_blocked" }
    >();
    expectTypeOf<AuthPort["signInWithEmailOtp"]>().parameters.toEqualTypeOf<
      [{ email: string; code: string }]
    >();
    expectTypeOf<AuthPort["signInWithEmailOtp"]>().returns.resolves.toEqualTypeOf<
      | { kind: "signed_in"; emailVerified: boolean }
      | { kind: "code_invalid" }
      | { kind: "code_expired" }
      | { kind: "unavailable" }
      | { kind: "cart_busy" }
      | { kind: "cart_blocked" }
    >();
  });

  it("types startGoogleSignIn (B5 C2): the paths in, a redirect or one of the refusals out; the outcome of the sign-in is not part of the result", () => {
    expectTypeOf<AuthPort["startGoogleSignIn"]>().parameters.toEqualTypeOf<
      [{ successPath: string; failurePath: string }]
    >();
    expectTypeOf<AuthPort["startGoogleSignIn"]>().returns.resolves.toEqualTypeOf<
      | { kind: "redirect"; url: string }
      | { kind: "unavailable" }
      | { kind: "already_signed_in" }
      | { kind: "cart_busy" }
      | { kind: "cart_blocked" }
    >();
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

describe("TC-DEV-WEB-010-103 port doc comments name the Operation ID or the UCR (design section 3, DEV-GEN-003, API-PUR-CART-001)", () => {
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
    "getPurchaseEligibility",
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

  /** The comment block directly above a declaration (the doc comment of that method only). */
  const annotationOf = (lines: string[], name: string): string => {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${name}\\(`).test(line));
    expect(index, `${name} must be declared in port.ts`).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (let i = index - 1; i >= 0; i -= 1) {
      const text = (lines[i] ?? "").trim();
      if (!/^(\/\*|\*|\/\/)/.test(text)) break;
      block.unshift(text);
    }
    return block.join("\n");
  };

  it("annotates every method with an API-* Operation ID (the UCR-110-001 stand-in is gone: it is INCORPORATED)", () => {
    const lines = portSource();
    for (const name of methods) {
      expect(annotationOf(lines, name), name).toMatch(/API-[A-Z]+(-[A-Z]+)*-\d{3}/);
    }
  });

  it("leaves no UCR-110-001 and no Operation ID なし mark anywhere in port.ts (every method has a canonical Operation ID)", () => {
    const source = portSource().join("\n");
    expect(source).not.toContain("UCR-110-001");
    expect(source).not.toMatch(/Operation ID\s*(なし|none|missing)/i);
    expect(source).not.toMatch(/Methods without an Operation ID/);
  });

  it("cites the public Operation IDs for the two public reads and the owner Operation ID for the eligibility (SPEC-110 API-PUB-005 / 010 / 011, API-PUR-ELG-001; SPEC-050 12.1)", () => {
    const lines = portSource();
    const entryOfferings = annotationOf(lines, "listEntryOfferings");
    expect(entryOfferings).toContain("API-PUB-005");
    expect(entryOfferings).toMatch(/public/i);
    expect(entryOfferings).toContain("getPurchaseEligibility");
    const resolve = annotationOf(lines, "resolveCartLines");
    for (const id of ["API-PUB-005", "API-PUB-010", "API-PUB-011"]) expect(resolve).toContain(id);
    expect(resolve).toMatch(/public/i);
    expect(resolve).toContain("getPurchaseEligibility");
    const eligibility = annotationOf(lines, "getPurchaseEligibility");
    expect(eligibility).toContain("API-PUR-ELG-001");
    expect(eligibility).toMatch(/owner-scoped/);
    expect(eligibility).toMatch(/read-only/);
    expect(eligibility).toMatch(/no-store/);
    expect(eligibility).toMatch(/not a reservation/);
    // B4c: the same Operation ID also takes one KARAOKE Slot (quantity 1); no other Operation ID is cited.
    expect(eligibility).toContain("KARAOKE");
    expect(eligibility.match(/API-[A-Z]+(?:-[A-Z]+)*-\d{3}/g)).toEqual(["API-PUR-ELG-001"]);
  });

  it("cites API-PUR-CART-001 for startCartPurchase without the UCR or Operation ID なし wording (SPEC-110 API-PUR-CART-001, UCR-110-001 INCORPORATED)", () => {
    const annotation = window(portSource(), "startCartPurchase");
    expect(annotation).toContain("API-PUR-CART-001");
    expect(annotation).not.toContain("UCR-110-001");
    expect(annotation).not.toMatch(/Operation ID\s*(なし|none|missing)/i);
    // The all-or-nothing contract and the Checkout hand-off are part of the annotation.
    expect(annotation).toMatch(/all-or-nothing/);
    expect(annotation).toContain("API-CHK-001");
  });

  it("cites API-PUB-012 for listSponsorLogos without the UCR or Operation ID なし wording (SPEC-110 API-PUB-012, BR-EVT-005)", () => {
    const annotation = window(portSource(), "listSponsorLogos");
    expect(annotation).toContain("API-PUB-012");
    expect(annotation).not.toContain("UCR-110-001");
    expect(annotation).not.toMatch(/Operation ID\s*(なし|none|missing)/i);
    // The ordering contract is part of the annotation: sort_order ASC, then public_ref ASC.
    expect(annotation).toMatch(/PUBLISHED/);
    expect(annotation).toMatch(/public_ref ASC/);
  });

  it("cites API-AUTH-002 / API-AUTH-004 for the Profile ports without the superseded UCR-100-001 (SPEC-030 9.2)", () => {
    const lines = portSource();
    expect(window(lines, "getProfile")).toContain("API-AUTH-002");
    expect(window(lines, "updateProfile")).toContain("API-AUTH-004");
    expect(window(lines, "updateProfile")).not.toContain("UCR-100-001");
    expect(lines.join("\n")).not.toContain("UCR-100-001");
  });

  it("cites API-ORD-003 for getOrder as the owner projection of SPEC-120 7.2 without the UCR or Operation ID なし wording (SPEC-050 16.2)", () => {
    const lines = portSource();
    const annotation = window(lines, "getOrder");
    expect(annotation).toContain("API-ORD-003");
    expect(annotation).toContain("notification_summary");
    expect(annotation).not.toContain("UCR-110-001");
    expect(annotation).not.toMatch(/Operation ID\s*(なし|none|missing)/i);
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
      "API-PUB-012",
      "API-AUTH-002",
      "API-AUTH-004",
      "API-PUR-CART-001",
      "API-PUR-ELG-001",
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
  const roots = ["src/mock", "src/features", "src/api-client", "src/auth", "src/routes"].map((r) =>
    join(webDir, r),
  );
  const files = roots.flatMap((root) => sourceFiles(root));

  it("scans the mock sources (not vacuous)", () => {
    expect(files.some((f) => rel(f).startsWith("src/mock/backend/"))).toBe(true);
  });

  it("scans the route modules too (src/routes replaced the Next.js app directory)", () => {
    expect(files.some((f) => rel(f).startsWith("src/routes/"))).toBe(true);
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
