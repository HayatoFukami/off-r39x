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

// Characters the URL parser would silently repair or that would let a value carry more than a plain
// absolute URL: control characters, whitespace, backslash (read as "/"), query and fragment (SEC-WEB-026).
const UNSAFE_URL_CHARACTERS = /[\s\\?#\p{Cc}]/u;

/**
 * SEC-WEB-026: an absolute HTTPS URL only. No userinfo, no non-standard port (443 is normalised away by the
 * parser), no query or fragment, no IP literal, no `localhost` / `*.localhost` / `*.local` host, no control
 * character. The host is the parser's normalised ASCII form (lower-case, punycode, IPv4 in dotted decimal,
 * so `0x7f.1` and `2130706433` are caught as IP literals). The image origin allowlist is enforced by the
 * CSP `img-src` (SPONSOR_IMAGE_ALLOWED_ORIGINS), not here.
 */
function isPlainHttps(value: string): boolean {
  if (UNSAFE_URL_CHARACTERS.test(value)) return false;
  const url = parseUrl(value);
  if (url === null || url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.port !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  const host = url.hostname;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(host)) return false; // no IPv6 literal, no escapes
  if (/^\d+(?:\.\d+){3}$/.test(host)) return false; // IPv4 literal
  return !(host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"));
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
