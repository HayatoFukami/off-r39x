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

export type SponsorAreaOptions = {
  /**
   * Accept a same-origin path (`/mock/sponsors/*.svg`) as the image. Only the UI mock's own assets need it, so
   * the container turns it on from the build-time mock flag; a real API returns https URLs only (SPEC-050 8.5,
   * SEC-WEB-026) and the default is off.
   */
  readonly allowSameOriginImagePath?: boolean;
};

function toImageSrc(imageUrl: string, allowSameOriginPath: boolean): string | null {
  if (imageUrl === "") return null;
  if (imageUrl.startsWith("/")) {
    if (!allowSameOriginPath) return null;
    return imageUrl.startsWith("//") || imageUrl.startsWith("/\\") ? null : imageUrl;
  }
  return isPlainHttps(imageUrl) ? imageUrl : null;
}

export function buildSponsorAreaModel(
  input: SponsorAreaInput,
  options: SponsorAreaOptions = {},
): SponsorAreaModel {
  if (input.kind !== "ok" || input.data.length === 0) return { kind: "hidden" };
  return {
    kind: "visible",
    items: input.data.map((logo) => ({
      sponsorRef: logo.sponsorRef,
      name: logo.name,
      imageSrc: toImageSrc(logo.imageUrl, options.allowSameOriginImagePath === true),
      externalHref: toExternalHref(logo.linkUrl),
    })),
  };
}
