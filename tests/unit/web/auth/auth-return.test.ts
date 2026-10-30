import { describe, expect, it } from "vitest";
import {
  accountPath,
  type ContinuationIntent,
  isSafeRelativePath,
  parseContinuation,
  serializeContinuation,
} from "../../../../apps/web/src/auth/continuation.ts";
import * as authReturn from "../../../../apps/web/src/features/auth/auth-return.ts";

// B5 C2 (tests/contracts/s6-auth.md section 5B). The paths an external-completion method (Google) returns to, built
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
