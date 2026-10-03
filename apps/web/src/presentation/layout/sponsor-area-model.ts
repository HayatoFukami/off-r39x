import type { Read, SponsorLogo } from "../../api-client/types";

// View model for the Footer Sponsor Logo area (SPEC-050 8.5). Zero items, a fetch failure and a
// pending fetch all hide the area: no "none" or failure wording exists in the model.

export type SponsorAreaInput = Read<readonly SponsorLogo[]> | { kind: "loading" };

export type SponsorItemModel = {
  readonly sponsorRef: string;
  readonly name: string;
  /** null: show the name as text. */
  readonly imageSrc: string | null;
  /** null: not a link. */
  readonly externalHref: string | null;
};

export type SponsorAreaModel =
  | { readonly kind: "hidden" }
  | { readonly kind: "visible"; readonly items: readonly SponsorItemModel[] };

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPlainHttps(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && url.protocol === "https:" && url.username === "" && url.password === "";
}

function toExternalHref(linkUrl: string | null): string | null {
  return linkUrl !== null && isPlainHttps(linkUrl) ? linkUrl : null;
}

function toImageSrc(imageUrl: string | null): string | null {
  if (imageUrl === null || imageUrl === "") return null;
  if (imageUrl.startsWith("/")) {
    return imageUrl.startsWith("//") || imageUrl.startsWith("/\\") ? null : imageUrl;
  }
  return isPlainHttps(imageUrl) ? imageUrl : null;
}

export function buildSponsorAreaModel(input: SponsorAreaInput): SponsorAreaModel {
  if (input.kind !== "ok" || input.data.length === 0) return { kind: "hidden" };
  return {
    kind: "visible",
    items: input.data.map((logo) => ({
      sponsorRef: logo.sponsorRef,
      name: logo.name,
      imageSrc: toImageSrc(logo.imageUrl),
      externalHref: toExternalHref(logo.linkUrl),
    })),
  };
}
