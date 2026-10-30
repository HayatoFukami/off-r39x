import { describe, expect, it } from "vitest";
import {
  accountPath,
  type ContinuationIntent,
  isSafeRelativePath,
  parseContinuation,
  serializeContinuation,
} from "../../../../apps/web/src/auth/continuation.ts";
import * as authReturn from "../../../../apps/web/src/features/auth/auth-return.ts";

// B5 C2 / C3 (tests/contracts/s6-auth.md section 5B). The paths an external-completion method (Google, Magic Link) returns to, built
// on the Page the visitor started from (SPEC-050 15.0: the same Page, PG-AUTH-001 / 003) and checked as same-origin
// relative paths (AR-CONT-001, SEC-WEB-013). Query values are fixed words of the SPA: no Secret, no Account.

const loadAuthReturn = async () => authReturn;

const UUID = "5a000000-0000-4000-8000-000000011000";
const INTENTS: readonly (ContinuationIntent | null)[] = [
  null,
  { key: "cart", ref: null },
  { key: "mypage", ref: null },
  { key: "karaoke-slot", ref: UUID },
];
const PAGES = ["login", "register"] as const;

describe("TC-PG-AUTH-003-213 the return and failure paths of Google are same-origin PG-AUTH paths that keep the Continuation, and unknown query values are ignored (SPEC-050 15.0, AR-CONT-001, SEC-WEB-013)", () => {
  it("names the query parameters returned and notice", async () => {
    const mod = await loadAuthReturn();
    expect(mod.RETURNED_PARAM).toBe("returned");
  });

  it.each(PAGES.flatMap((page) => INTENTS.map((intent) => [page, intent] as const)))(
    "the return path for %s with intent %j is accountPath plus returned=google, and is safe",
    async (page, intent) => {
      const { externalReturnPath } = await loadAuthReturn();
      const path = externalReturnPath("google", page, intent);
      const base = accountPath(page, intent);
      expect(path).toBe(`${base}${intent === null ? "?" : "&"}returned=google`);
      expect(isSafeRelativePath(path)).toBe(true);
      const url = new URL(path, "http://127.0.0.1");
      expect(url.pathname).toBe(`/account/${page}`);
      expect(url.hash).toBe("");
      expect(url.searchParams.get("returned")).toBe("google");
      // The Continuation is kept exactly (the same serialized value) and still parses to the same intent.
      if (intent === null) {
        expect(url.searchParams.has("continue")).toBe(false);
      } else {
        expect(url.searchParams.get("continue")).toBe(serializeContinuation(intent));
        expect(parseContinuation(url.searchParams.get("continue"))).toEqual(intent);
      }
      expect([...url.searchParams.keys()].sort()).toEqual(
        intent === null ? ["returned"] : ["continue", "returned"],
      );
    },
  );

  it.each(PAGES.flatMap((page) => INTENTS.map((intent) => [page, intent] as const)))(
    "the failure path for %s with intent %j is accountPath plus notice=google-failed, and is safe",
    async (page, intent) => {
      const { externalFailurePath } = await loadAuthReturn();
      const path = externalFailurePath("google", page, intent);
      expect(path).toBe(
        `${accountPath(page, intent)}${intent === null ? "?" : "&"}notice=google-failed`,
      );
      expect(isSafeRelativePath(path)).toBe(true);
      const url = new URL(path, "http://127.0.0.1");
      expect(url.pathname).toBe(`/account/${page}`);
      expect(url.searchParams.get("notice")).toBe("google-failed");
      expect(url.searchParams.has("returned")).toBe(false);
      if (intent !== null) {
        expect(parseContinuation(url.searchParams.get("continue"))).toEqual(intent);
      }
    },
  );

  it("never puts an email, a token, a code or an identifier into a path", async () => {
    const { externalReturnPath, externalFailurePath } = await loadAuthReturn();
    for (const page of PAGES) {
      for (const intent of INTENTS) {
        for (const path of [
          externalReturnPath("google", page, intent),
          externalFailurePath("google", page, intent),
        ]) {
          expect(path).not.toMatch(/@|token|secret|code=|password|session|email/i);
        }
      }
    }
  });

  it("reads returned: only the exact value google is recognised; everything else is ignored", async () => {
    const { parseReturned } = await loadAuthReturn();
    expect(parseReturned("google")).toBe("google");
    for (const value of [
      null,
      undefined,
      "",
      " ",
      "Google",
      "GOOGLE",
      "google ",
      " google",
      "google,google",
      "google&x=1",
      "google-failed",
      "github",
      "discord",
      "1",
      "true",
      "../google",
    ]) {
      expect(parseReturned(value), String(value)).toBeNull();
    }
  });

  it("reads notice: only the exact value google-failed is a Google failure; the password-updated notice and everything else are not", async () => {
    const { parseFailureNotice } = await loadAuthReturn();
    expect(parseFailureNotice("google-failed")).toBe("google");
    for (const value of [
      null,
      undefined,
      "",
      "google",
      "Google-failed",
      "google-failed ",
      "google-failed,x",
      "password-updated",
      "failed",
      "github-failed",
    ]) {
      expect(parseFailureNotice(value), String(value)).toBeNull();
    }
  });
});

// B5 C3: Magic Link returns to the page that sent the link the same way (SPEC-050 15.0: the same Page, PG-AUTH-001 /
// 003). The marker words are fixed: returned=magic-link after a link opened, notice=link-failed after a link that was
// expired, invalid or never arrived. No email, no token, no identifier (SEC-AUTH-018, SEC-WEB-013).
describe("TC-PG-AUTH-003-213 the return and failure paths of Magic Link are same-origin PG-AUTH paths that keep the Continuation, and the two methods' values never cross (SPEC-050 15.0, AR-CONT-001, SEC-WEB-013)", () => {
  it.each(PAGES.flatMap((page) => INTENTS.map((intent) => [page, intent] as const)))(
    "the Magic Link return path for %s with intent %j is accountPath plus returned=magic-link, and is safe",
    async (page, intent) => {
      const { externalReturnPath } = await loadAuthReturn();
      const path = externalReturnPath("magic-link", page, intent);
      expect(path).toBe(
        `${accountPath(page, intent)}${intent === null ? "?" : "&"}returned=magic-link`,
      );
      expect(isSafeRelativePath(path)).toBe(true);
      const url = new URL(path, "http://127.0.0.1");
      expect(url.pathname).toBe(`/account/${page}`);
      expect(url.hash).toBe("");
      expect(url.searchParams.get("returned")).toBe("magic-link");
      if (intent === null) {
        expect(url.searchParams.has("continue")).toBe(false);
      } else {
        expect(url.searchParams.get("continue")).toBe(serializeContinuation(intent));
        expect(parseContinuation(url.searchParams.get("continue"))).toEqual(intent);
      }
      expect([...url.searchParams.keys()].sort()).toEqual(
        intent === null ? ["returned"] : ["continue", "returned"],
      );
    },
  );

  it.each(PAGES.flatMap((page) => INTENTS.map((intent) => [page, intent] as const)))(
    "the Magic Link failure path for %s with intent %j is accountPath plus notice=link-failed, and is safe",
    async (page, intent) => {
      const { externalFailurePath } = await loadAuthReturn();
      const path = externalFailurePath("magic-link", page, intent);
      expect(path).toBe(
        `${accountPath(page, intent)}${intent === null ? "?" : "&"}notice=link-failed`,
      );
      expect(isSafeRelativePath(path)).toBe(true);
      const url = new URL(path, "http://127.0.0.1");
      expect(url.pathname).toBe(`/account/${page}`);
      expect(url.searchParams.get("notice")).toBe("link-failed");
      expect(url.searchParams.has("returned")).toBe(false);
      if (intent !== null) {
        expect(parseContinuation(url.searchParams.get("continue"))).toEqual(intent);
      }
    },
  );

  it("never puts an email, a token, a code or an identifier into a Magic Link path", async () => {
    const { externalReturnPath, externalFailurePath } = await loadAuthReturn();
    for (const page of PAGES) {
      for (const intent of INTENTS) {
        for (const path of [
          externalReturnPath("magic-link", page, intent),
          externalFailurePath("magic-link", page, intent),
        ]) {
          expect(path).not.toMatch(/@|token|secret|code=|password|session|email/i);
        }
      }
    }
  });

  it("the Google paths are unchanged by the new method", async () => {
    const { externalReturnPath, externalFailurePath } = await loadAuthReturn();
    expect(externalReturnPath("google", "login", { key: "cart", ref: null })).toBe(
      "/account/login?continue=cart&returned=google",
    );
    expect(externalFailurePath("google", "register", null)).toBe(
      "/account/register?notice=google-failed",
    );
  });

  it("reads returned: google and magic-link are each recognised only by the exact value; everything else is ignored", async () => {
    const { parseReturned } = await loadAuthReturn();
    expect(parseReturned("magic-link")).toBe("magic-link");
    expect(parseReturned("google")).toBe("google");
    for (const value of [
      null,
      undefined,
      "",
      " ",
      "Magic-Link",
      "MAGIC-LINK",
      "magic-link ",
      " magic-link",
      "magic_link",
      "magiclink",
      "magic",
      "link",
      "magic-link,magic-link",
      "magic-link,google",
      "google,magic-link",
      "magic-link&x=1",
      "link-failed",
      "magic-link-failed",
      "../magic-link",
    ]) {
      expect(parseReturned(value), String(value)).toBeNull();
    }
  });

  it("reads notice: google-failed is a Google failure and link-failed a Magic Link failure; the password-updated notice, a returned value and everything else are not", async () => {
    const { parseFailureNotice } = await loadAuthReturn();
    expect(parseFailureNotice("link-failed")).toBe("magic-link");
    expect(parseFailureNotice("google-failed")).toBe("google");
    for (const value of [
      null,
      undefined,
      "",
      "magic-link",
      "Link-Failed",
      "LINK-FAILED",
      "link-failed ",
      " link-failed",
      "link_failed",
      "link-failed,x",
      "magic-link-failed",
      "magic-link,link-failed",
      "link-failed,google-failed",
      "password-updated",
      "failed",
    ]) {
      expect(parseFailureNotice(value), String(value)).toBeNull();
    }
  });
});
