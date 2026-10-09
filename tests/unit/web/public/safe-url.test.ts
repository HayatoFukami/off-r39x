import { describe, expect, it } from "vitest";
import { safeExternalHref } from "../../../../apps/web/src/presentation/components/safe-url.ts";

// Contract: tests/contracts/s4-public.md section 2.4 (SEC-WEB-016: https only, no userinfo).

describe("TC-SEC-WEB-016-601 safeExternalHref accepts only https links without credentials", () => {
  it("returns the original string for a plain https URL", () => {
    for (const url of [
      "https://example.com/",
      "https://example.com/path?q=1#frag",
      "https://sub.example.com:8443/a",
    ]) {
      expect(safeExternalHref(url), url).toBe(url);
    }
  });

  it("rejects every non-https scheme", () => {
    for (const url of [
      "http://example.com/",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.com/",
      "mailto:a@example.com",
    ]) {
      expect(safeExternalHref(url), url).toBeNull();
    }
  });

  it("rejects relative, protocol-relative, empty and unparsable values", () => {
    for (const url of ["/relative", "//example.com/", "", "   ", "not a url", "https://"]) {
      expect(safeExternalHref(url), JSON.stringify(url)).toBeNull();
    }
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });

  it("rejects userinfo (username or password)", () => {
    for (const url of [
      "https://user@example.com/",
      "https://user:pass@example.com/",
      "https://:pass@example.com/",
    ]) {
      expect(safeExternalHref(url), url).toBeNull();
    }
  });
});
