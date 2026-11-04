import { describe, expect, it } from "vitest";
import type { Read, SponsorLogo } from "../../../../apps/web/src/api-client/types.ts";
import { buildSponsorAreaModel } from "../../../../apps/web/src/presentation/layout/sponsor-area-model.ts";

// Contract: tests/contracts/s3-layout.md section 2.6 / 7 (SPEC-050 8.5 Sponsor Logo area, BR-EVT-005, 31 item 29).

const logo = (n: number, name: string, over: Partial<SponsorLogo> = {}): SponsorLogo =>
  ({
    sponsorRef: `5b000000-0000-4000-8000-00000000000${n}`,
    name,
    imageUrl: `/mock/sponsors/s${n}.svg`,
    linkUrl: null,
    ...over,
  }) as SponsorLogo;

const ok = (data: SponsorLogo[]): Read<readonly SponsorLogo[]> => ({ kind: "ok", data });

// The same-origin image path exists only for the UI mock's own assets (/mock/sponsors/*.svg). The container
// turns it on from the build-time mock flag; the default (a real API) accepts https URLs only (SEC-WEB-026).
const MOCK = { allowSameOriginImagePath: true } as const;

describe("TC-PG-PUB-001-211 sponsor area is hidden for 0 items, failure and loading (SPEC-050 8.5)", () => {
  it("is hidden for an empty ok result, with no message or other field", () => {
    expect(buildSponsorAreaModel(ok([]))).toEqual({ kind: "hidden" });
  });

  it.each([
    ["unavailable", { kind: "unavailable" }],
    ["not_found", { kind: "not_found" }],
    ["auth_required", { kind: "auth_required" }],
    ["email_unverified", { kind: "email_unverified" }],
    ["loading", { kind: "loading" }],
  ] as const)("is hidden (and says nothing) for %s", (_label, input) => {
    expect(buildSponsorAreaModel(input)).toEqual({ kind: "hidden" });
  });
});

describe("TC-PG-PUB-001-212 sponsor area keeps the port's display order (BR-EVT-005)", () => {
  it("is visible with every item in the given order and does not re-sort or mutate", () => {
    const data = [logo(3, "Sponsor Charlie"), logo(1, "Sponsor Alpha"), logo(2, "Sponsor Bravo")];
    const snapshot = JSON.parse(JSON.stringify(data));
    const model = buildSponsorAreaModel(ok(data));
    expect(model.kind).toBe("visible");
    if (model.kind !== "visible") return;
    expect(model.items.map((item) => item.name)).toEqual([
      "Sponsor Charlie",
      "Sponsor Alpha",
      "Sponsor Bravo",
    ]);
    expect(model.items.map((item) => item.sponsorRef)).toEqual(data.map((d) => d.sponsorRef));
    expect(data).toEqual(snapshot);
  });

  it("carries a relative image path (mock option) and an https link through unchanged", () => {
    const model = buildSponsorAreaModel(
      ok([logo(1, "Sponsor Alpha", { linkUrl: "https://sponsor-alpha.example.com/" })]),
      MOCK,
    );
    expect(model).toEqual({
      kind: "visible",
      items: [
        {
          sponsorRef: "5b000000-0000-4000-8000-000000000001",
          name: "Sponsor Alpha",
          imageSrc: "/mock/sponsors/s1.svg",
          externalHref: "https://sponsor-alpha.example.com/",
        },
      ],
    });
  });
});

describe("TC-PG-PUB-001-213 sponsor links and images accept only safe URLs (SPEC-050 8.5, SEC-WEB-016)", () => {
  const externalHref = (linkUrl: string | null): string | null => {
    const model = buildSponsorAreaModel(ok([logo(1, "S", { linkUrl })]));
    return model.kind === "visible" ? (model.items[0]?.externalHref ?? null) : "HIDDEN";
  };
  // API-PUB-012 image_url is required: the model input is a plain string (a null case is not representable).
  const imageSrc = (
    imageUrl: string,
    options?: { readonly allowSameOriginImagePath?: boolean },
  ): string | null => {
    const model = buildSponsorAreaModel(ok([logo(1, "S", { imageUrl })]), options);
    return model.kind === "visible" ? (model.items[0]?.imageSrc ?? null) : "HIDDEN";
  };

  // SEC-WEB-026: the link and the image share one rule. Each entry is a URL shape the spec rejects.
  const UNSAFE_URLS = [
    ["http scheme", "http://sponsor.example.com/a"],
    ["userinfo (user and password)", "https://user:pass@sponsor.example.com/a"],
    ["userinfo (user only)", "https://user@sponsor.example.com/a"],
    ["non-standard port", "https://sponsor.example.com:8443/a"],
    ["port 80", "https://sponsor.example.com:80/a"],
    ["query", "https://sponsor.example.com/a?token=x"],
    ["empty query", "https://sponsor.example.com/a?"],
    ["fragment", "https://sponsor.example.com/a#top"],
    ["empty fragment", "https://sponsor.example.com/a#"],
    ["IPv4 literal", "https://192.0.2.10/a"],
    ["IPv4 literal normalised from hex", "https://0xc0.0.2.10/a"],
    ["IPv4 literal normalised from decimal", "https://3221225994/a"],
    ["IPv4 literal with a trailing dot", "https://192.0.2.10./a"],
    ["IPv6 literal", "https://[2001:db8::1]/a"],
    ["IPv4-mapped IPv6 literal", "https://[::ffff:192.0.2.10]/a"],
    ["localhost", "https://localhost/a"],
    ["localhost (upper case)", "https://LOCALHOST/a"],
    ["localhost with a trailing dot", "https://localhost./a"],
    ["a localhost subdomain", "https://sponsor.localhost/a"],
    [".local host", "https://sponsor.local/a"],
    [".local host with a trailing dot", "https://sponsor.local./a"],
    ["tab inside", "https://sponsor.example.com/\ta"],
    ["newline inside", "https://sponsor.example.com/a\nb"],
    ["NUL", "https://sponsor.example.com/a\u0000"],
    ["DEL", "https://sponsor.example.com/a\u007F"],
    ["C1 control (NEL)", "https://sponsor.example.com/a\u0085"],
    ["leading space", " https://sponsor.example.com/a"],
    ["trailing space", "https://sponsor.example.com/a "],
    ["backslash", "https:\\\\sponsor.example.com\\a"],
    ["protocol-relative", "//sponsor.example.com/a"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:image/svg+xml,<svg/>"],
    ["unparsable", "not a url"],
    ["empty", ""],
  ] as const;

  it("links only absolute https URLs that SEC-WEB-026 allows", () => {
    expect(externalHref("https://sponsor.example.com/path")).toBe(
      "https://sponsor.example.com/path",
    );
    expect(externalHref("https://sponsor.example.com/")).toBe("https://sponsor.example.com/");
    expect(externalHref("https://sponsor.example.com")).toBe("https://sponsor.example.com");
    // Port 443 is the standard port; the other parts are ordinary public hosts.
    expect(externalHref("https://sponsor.example.com:443/a")).toBe(
      "https://sponsor.example.com:443/a",
    );
    expect(externalHref("https://Sponsor.Example.com/a")).toBe("https://Sponsor.Example.com/a");
    expect(externalHref("https://a-b.sponsor.example.co.jp/a/b.html")).toBe(
      "https://a-b.sponsor.example.co.jp/a/b.html",
    );
    expect(externalHref("https://localhost-sponsor.example.com/a")).toBe(
      "https://localhost-sponsor.example.com/a",
    );
    expect(externalHref("https://192.0.2.example.com/a")).toBe("https://192.0.2.example.com/a");
    expect(externalHref("https://xn--eckwd4c7c.example.jp/a")).toBe(
      "https://xn--eckwd4c7c.example.jp/a",
    );
  });

  it.each(UNSAFE_URLS)("does not link a URL with %s", (_label, url) => {
    expect(externalHref(url)).toBeNull();
  });

  it("does not link without a URL or with a same-origin path", () => {
    expect(externalHref(null)).toBeNull();
    expect(externalHref("/relative")).toBeNull();
    expect(externalHref("/mock/sponsors/alpha.svg")).toBeNull();
    expect(externalHref("data:text/html,x")).toBeNull();
  });

  it("also accepts a same-origin path when the mock option is on, and nothing else changes", () => {
    expect(imageSrc("/mock/sponsors/alpha.svg", MOCK)).toBe("/mock/sponsors/alpha.svg");
    expect(imageSrc("https://img.example.com/a.png", MOCK)).toBe("https://img.example.com/a.png");
    expect(imageSrc("/\\evil.example.com/a.png", MOCK)).toBeNull();
  });

  it.each(UNSAFE_URLS)(
    "does not use a URL with %s as the image, with or without the mock option, and falls back to the name",
    (_label, url) => {
      expect(imageSrc(url)).toBeNull();
      expect(imageSrc(url, MOCK)).toBeNull();
    },
  );

  it("uses only an absolute https URL that SEC-WEB-026 allows as the image by default, otherwise falls back to the name", () => {
    expect(imageSrc("https://img.example.com/a.png")).toBe("https://img.example.com/a.png");
    expect(imageSrc("https://img.example.com:443/a.png")).toBe("https://img.example.com:443/a.png");
    expect(imageSrc("/mock/sponsors/alpha.svg")).toBeNull();
    expect(imageSrc("/api/v1/self/orders")).toBeNull();
    expect(imageSrc("/\\evil.example.com/a.png")).toBeNull();
  });
});
