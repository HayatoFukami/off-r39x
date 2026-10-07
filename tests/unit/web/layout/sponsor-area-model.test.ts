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

  it("carries a relative image path and an https link through unchanged", () => {
    const model = buildSponsorAreaModel(
      ok([logo(1, "Sponsor Alpha", { linkUrl: "https://sponsor-alpha.example.com/" })]),
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
  const imageSrc = (imageUrl: string | null): string | null => {
    const model = buildSponsorAreaModel(ok([logo(1, "S", { imageUrl })]));
    return model.kind === "visible" ? (model.items[0]?.imageSrc ?? null) : "HIDDEN";
  };

  it("links only https URLs without credentials", () => {
    expect(externalHref("https://sponsor.example.com/path?q=1")).toBe(
      "https://sponsor.example.com/path?q=1",
    );
    expect(externalHref(null)).toBeNull();
    expect(externalHref("http://sponsor.example.com/")).toBeNull();
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("data:text/html,x")).toBeNull();
    expect(externalHref("/relative")).toBeNull();
    expect(externalHref("//sponsor.example.com/")).toBeNull();
    expect(externalHref("not a url")).toBeNull();
    expect(externalHref("https://user:pass@sponsor.example.com/")).toBeNull();
    expect(externalHref("")).toBeNull();
  });

  it("uses a same-origin path or an https URL as the image, otherwise falls back to the name", () => {
    expect(imageSrc("/mock/sponsors/alpha.svg")).toBe("/mock/sponsors/alpha.svg");
    expect(imageSrc("https://img.example.com/a.png")).toBe("https://img.example.com/a.png");
    expect(imageSrc(null)).toBeNull();
    expect(imageSrc("http://img.example.com/a.png")).toBeNull();
    expect(imageSrc("javascript:alert(1)")).toBeNull();
    expect(imageSrc("data:image/svg+xml,<svg/>")).toBeNull();
    expect(imageSrc("//img.example.com/a.png")).toBeNull();
    expect(imageSrc("/\\evil.example.com/a.png")).toBeNull();
    expect(imageSrc("")).toBeNull();
  });
});
