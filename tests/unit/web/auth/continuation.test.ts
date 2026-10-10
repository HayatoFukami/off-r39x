import { describe, expect, it } from "vitest";
import {
  accountPath,
  CONTINUATION_KEYS,
  CONTINUATION_PARAM,
  type ContinuationIntent,
  type ContinuationKey,
  continuationCancelPath,
  continuationForPath,
  continuationPath,
  isSafeRelativePath,
  PROTECTED_PATH_PREFIXES,
  parseContinuation,
  serializeContinuation,
} from "../../../../apps/web/src/auth/continuation.ts";

// U9 (tests/contracts/s6-auth.md section 2). SPEC-060 AR-CONT-001..004, SPEC-140 SEC-WEB-013,
// SPEC-050 10.2 / 10.3. Synthetic refs only.

const UUID = "5a000000-0000-4000-8000-000000011000";
const UUID_B = "e0000000-0000-4000-8000-000000000001";
const MYPAGE: ContinuationIntent = { key: "mypage", ref: null };

const TABLE: ReadonlyArray<readonly [ContinuationKey, boolean, string]> = [
  ["cart", false, "/cart"],
  ["karaoke-slot", true, `/karaoke/slots/${UUID}`],
  ["purchase-order", true, `/purchase/orders/${UUID}`],
  ["mypage", false, "/mypage"],
  ["mypage-profile", false, "/mypage/profile"],
  ["mypage-orders", false, "/mypage/orders"],
  ["mypage-order", true, `/mypage/orders/${UUID}`],
  ["mypage-entry-tickets", false, "/mypage/entry-tickets"],
  ["mypage-entry-ticket", true, `/mypage/entry-tickets/${UUID}`],
  ["mypage-karaoke", false, "/mypage/karaoke"],
  ["mypage-reservation", true, `/mypage/karaoke/${UUID}`],
  ["mypage-goods", false, "/mypage/goods"],
  ["mypage-goods-item", true, `/mypage/goods/${UUID}`],
];

const intentOf = (key: ContinuationKey, withRef: boolean): ContinuationIntent => ({
  key,
  ref: withRef ? UUID : null,
});

describe("TC-AR-CONT-001-101 the allow-list round-trips (AR-CONT-001, U9)", () => {
  it("uses the query parameter name continue and lists exactly the 13 contracted keys", () => {
    expect(CONTINUATION_PARAM).toBe("continue");
    expect([...CONTINUATION_KEYS]).toEqual(TABLE.map(([key]) => key));
    expect([...PROTECTED_PATH_PREFIXES]).toEqual(["/mypage", "/purchase"]);
  });

  it.each(TABLE)("%s serializes, parses back and maps to its path", (key, withRef, path) => {
    const intent = intentOf(key, withRef);
    const raw = serializeContinuation(intent);
    expect(raw).toBe(withRef ? `${key}:${UUID}` : key);
    expect(parseContinuation(raw)).toEqual(intent);
    expect(continuationPath(intent)).toBe(path);
    expect(isSafeRelativePath(continuationPath(intent))).toBe(true);
  });

  it("returns null (no intent) only when the parameter is absent", () => {
    expect(parseContinuation(null)).toBeNull();
    expect(parseContinuation(undefined)).toBeNull();
  });

  it("does not throw for any input", () => {
    for (const raw of ["", " ", ":", "::", "\u0000", "%", "cart:", ":cart", "a".repeat(5000)]) {
      expect(() => parseContinuation(raw)).not.toThrow();
    }
  });
});

describe("TC-AR-CONT-001-102 an invalid value is treated as mypage (AR-CONT-001 / 003, SEC-WEB-013, U9)", () => {
  const INVALID: ReadonlyArray<readonly [string, string]> = [
    ["empty string", ""],
    ["whitespace only", " "],
    ["unknown key", "admin"],
    ["upper-case key", "Cart"],
    ["key with surrounding space", " cart"],
    ["key with trailing space", "cart "],
    ["ref on a key that takes none", `cart:${UUID}`],
    ["mypage with a ref", `mypage:${UUID}`],
    ["a key that needs a ref, without it", "karaoke-slot"],
    ["a key that needs a ref, with an empty one", "karaoke-slot:"],
    ["a non-canonical ref (upper case)", `karaoke-slot:${UUID.toUpperCase()}`],
    ["a non-canonical ref (not a uuid)", "karaoke-slot:12345"],
    ["a non-canonical ref (braces)", `karaoke-slot:{${UUID}}`],
    ["two colons", `karaoke-slot:${UUID}:${UUID_B}`],
    ["an absolute URL", "https://evil.example.com/"],
    ["a scheme-relative URL", "//evil.example.com"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,x"],
    ["a path", "/cart"],
    ["an admin path", "/admin"],
    ["a staff path", "/staff/checkin"],
    ["an encoded admin path", "%2Fadmin"],
    ["a percent-encoded colon", `karaoke-slot%3A${UUID}`],
    ["a backslash path", "\\evil"],
    ["a control character", "cart\n"],
    ["a NUL character", "cart\u0000"],
    ["user info", "user:pass@evil.example.com"],
    ["a price smuggled in", "cart:amount=100"],
    ["a role smuggled in", "mypage;role=admin"],
  ];

  it.each(INVALID)("%s -> mypage", (_label, raw) => {
    expect(parseContinuation(raw)).toEqual(MYPAGE);
  });

  it("an invalid intent resolves to /mypage after login (never an attacker-chosen path)", () => {
    for (const [, raw] of INVALID) {
      const intent = parseContinuation(raw);
      expect(intent).not.toBeNull();
      if (intent !== null) expect(continuationPath(intent)).toBe("/mypage");
    }
  });
});

describe("TC-AR-CONT-001-103 continuationPath validates its own result (SEC-WEB-013 final re-check, U9)", () => {
  it("falls back to /mypage when the intent breaks the type contract", () => {
    const broken: ContinuationIntent[] = [
      { key: "karaoke-slot", ref: null },
      { key: "karaoke-slot", ref: "../../admin" },
      { key: "karaoke-slot", ref: "//evil.example.com" },
      { key: "mypage-order", ref: "x/../../admin" },
      { key: "mypage-order", ref: `${UUID}\n` },
      { key: "purchase-order", ref: "%2e%2e/%2e%2e/admin" },
    ];
    for (const intent of broken) {
      expect(continuationPath(intent), JSON.stringify(intent)).toBe("/mypage");
    }
  });
});

describe("TC-AR-CONT-004-101 where a cancelled authentication returns to (AR-CONT-004, SPEC-050 10.1, U9)", () => {
  it("cart returns to /cart, a karaoke slot to the slot page, everything else to Home", () => {
    expect(continuationCancelPath({ key: "cart", ref: null })).toBe("/cart");
    expect(continuationCancelPath({ key: "karaoke-slot", ref: UUID })).toBe(
      `/karaoke/slots/${UUID}`,
    );
    expect(continuationCancelPath(null)).toBe("/");
    for (const [key, withRef] of TABLE) {
      if (key === "cart" || key === "karaoke-slot") continue;
      expect(continuationCancelPath(intentOf(key, withRef)), key).toBe("/");
    }
  });

  it("never offers a protected path or an external URL as the cancel destination", () => {
    for (const [key, withRef] of TABLE) {
      const to = continuationCancelPath(intentOf(key, withRef));
      expect(isSafeRelativePath(to), key).toBe(true);
      expect(
        PROTECTED_PATH_PREFIXES.some((p) => to === p || to.startsWith(`${p}/`)),
        key,
      ).toBe(false);
    }
  });
});

describe("TC-SEC-WEB-013-101 isSafeRelativePath rejects every unsafe form (SEC-WEB-013, U9)", () => {
  const UNSAFE: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 5],
    ["an object", {}],
    ["empty", ""],
    ["no leading slash", "cart"],
    ["an absolute https URL", "https://evil.example.com/"],
    ["an absolute http URL", "http://evil.example.com"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,x"],
    ["a mixed-case scheme", "JaVaScRiPt:alert(1)"],
    ["a network-path reference", "//evil.example.com"],
    ["a network-path reference with path", "//evil.example.com/cart"],
    ["a slash then backslash", "/\\evil.example.com"],
    ["a backslash inside the path", "/cart\\x"],
    ["a leading backslash", "\\evil.example.com"],
    ["a double backslash scheme-relative", "\\\\evil.example.com"],
    ["user info after a scheme", "https://user:pass@evil.example.com/"],
    ["user info network-path", "//user@evil.example.com/"],
    ["a newline", "/cart\n"],
    ["an embedded tab", "/ca\trt"],
    ["a NUL", "/cart\u0000"],
    ["DEL", "/cart\u007f"],
    ["a CR LF header injection", "/cart\r\nSet-Cookie: x=1"],
    ["encoded network-path (%2F%2F)", "/%2F%2Fevil.example.com"],
    ["encoded network-path (lower case)", "/%2f%2fevil.example.com"],
    ["encoded backslash", "/%5Cevil.example.com"],
    ["encoded backslash (lower case)", "/%5cevil.example.com"],
    ["encoded newline", "/cart%0a"],
    ["encoded NUL", "/cart%00"],
    ["double-encoded network-path", "/%252F%252Fevil.example.com"],
    ["triple-encoded backslash", "/%25255Cevil.example.com"],
    ["malformed percent-encoding", "/cart%E0%A4%A"],
    ["a lone percent", "/%"],
    ["/admin", "/admin"],
    ["/admin/ with a path", "/admin/users"],
    ["/ADMIN (case-insensitive)", "/ADMIN"],
    ["/Admin/x", "/Admin/x"],
    ["encoded /admin", "/%61dmin"],
    ["encoded /admin with a path", "/%61dmin/users"],
    ["/staff", "/staff"],
    ["/staff/ with a path", "/staff/checkin"],
    ["/Staff mixed case", "/Staff/y"],
    ["a dot segment to admin", "/cart/../admin"],
    ["an encoded dot segment to admin", "/cart/%2e%2e/admin"],
    ["a leading dot segment", "/../admin"],
    ["a single dot segment", "/./cart"],
  ];

  it.each(UNSAFE)("%s -> false", (_label, value) => {
    expect(isSafeRelativePath(value)).toBe(false);
  });
});

describe("TC-SEC-WEB-013-102 isSafeRelativePath accepts same-origin relative paths (SEC-WEB-013, U9)", () => {
  it.each([
    "/",
    "/cart",
    "/entry",
    "/mypage",
    `/mypage/orders/${UUID}`,
    `/karaoke/slots/${UUID}`,
    "/entry?x=1",
    "/account/login?continue=cart",
    "/administrators-guide",
    "/staffing",
  ])("%s -> true", (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });
});

describe("TC-AR-CONT-002-101 the reverse lookup used by AuthGate (AR-CONT-002, SPEC-050 15.6, U9)", () => {
  it.each(TABLE)(
    "%s maps back from its own path only when that path is protected",
    (key, withRef, path) => {
      const protectedPath = path.startsWith("/mypage") || path.startsWith("/purchase");
      expect(continuationForPath(path)).toEqual(protectedPath ? intentOf(key, withRef) : null);
    },
  );

  it("returns null for a path that is not protected", () => {
    for (const path of ["/", "/cart", "/entry", "/goods", "/account/login", "/mypageish", "/dev"]) {
      expect(continuationForPath(path), path).toBeNull();
    }
  });

  it("maps a protected path without its own key to mypage (QR pages are never a return destination)", () => {
    for (const path of [
      `/mypage/entry-tickets/${UUID}/qr`,
      `/mypage/karaoke/${UUID}/qr`,
      "/mypage/unknown",
      "/purchase",
      "/purchase/orders",
      `/purchase/orders/${UUID.toUpperCase()}`,
      "/mypage/orders/not-a-uuid",
    ]) {
      expect(continuationForPath(path), path).toEqual(MYPAGE);
    }
  });

  it("ignores a query string, a hash and a trailing slash on the path part", () => {
    expect(continuationForPath("/mypage/orders?x=1")).toEqual({ key: "mypage-orders", ref: null });
    expect(continuationForPath(`/mypage/orders/${UUID}#top`)).toEqual({
      key: "mypage-order",
      ref: UUID,
    });
    expect(continuationForPath("/mypage/")).toEqual(MYPAGE);
  });

  it("keeps price, quantity, owner, role, token and result out of the intent (AR-CONT-001 / 002, SPEC-050 10.3)", () => {
    for (const [key, withRef] of TABLE) {
      const intent = intentOf(key, withRef);
      expect(Object.keys(intent).sort()).toEqual(["key", "ref"]);
      expect(serializeContinuation(intent)).not.toMatch(
        /price|amount|total|quantity|owner|role|token|secret|success|paid|stock/i,
      );
    }
  });
});

describe("TC-PG-AUTH-003-111 accountPath carries the intent only as the continue parameter (SPEC-050 15.1 / 15.3 / 15.4, U9)", () => {
  it("has no query when there is no intent", () => {
    for (const page of ["login", "register", "email-verification", "password-reset"] as const) {
      expect(accountPath(page, null)).toBe(`/account/${page}`);
    }
  });

  it("adds continue= and reads back to the serialized intent", () => {
    expect(accountPath("login", { key: "cart", ref: null })).toBe("/account/login?continue=cart");
    for (const [key, withRef] of TABLE) {
      const intent = intentOf(key, withRef);
      for (const page of ["login", "register", "email-verification", "password-reset"] as const) {
        const url = new URL(accountPath(page, intent), "http://localhost");
        expect(url.pathname).toBe(`/account/${page}`);
        expect([...url.searchParams.keys()]).toEqual(["continue"]);
        expect(url.searchParams.get("continue")).toBe(serializeContinuation(intent));
        expect(parseContinuation(url.searchParams.get("continue"))).toEqual(intent);
      }
    }
  });
});
