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

// The value must spell the scheme with its authority marker. `new URL("https:host")` and `new URL("https:/host")`
// parse (without a base) as the external https://host/, but a browser resolves the same text in an href or src
// against the page URL, where a same-scheme URL without "//" is a relative path on the page's own origin.
// Requiring "https://" keeps the validated value and the value the browser uses the same URL.
const HTTPS_AUTHORITY_PREFIX = /^https:\/\//i;

/**
 * SEC-WEB-026: an absolute HTTPS URL only, written with `https://`. No userinfo, no non-standard port (443 is
 * normalised away by the parser), no query or fragment, no IP literal, no `localhost` / `*.localhost` / `*.local` host, no control
 * character. The host is the parser's normalised ASCII form (lower-case, punycode, IPv4 in dotted decimal,
 * so `0x7f.1` and `2130706433` are caught as IP literals). The image origin allowlist is enforced by the
 * CSP `img-src` (SPONSOR_IMAGE_ALLOWED_ORIGINS), not here.
 */
function isPlainHttps(value: string): boolean {
  if (UNSAFE_URL_CHARACTERS.test(value)) return false;
  if (!HTTPS_AUTHORITY_PREFIX.test(value)) return false;
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

// The UI mock's own assets: public/mock/sponsors/<name>.svg (and the 404 fixture __broken__.svg). Nothing else is a
// same-origin image: a fixed directory and a plain file name leave no control character, dot segment, backslash,
// query or fragment for a browser to repair into another URL (a tab or newline inside "/<tab>/host" is removed by
// the URL parser and leaves "//host").
const MOCK_SPONSOR_IMAGE_PATH = /^\/mock\/sponsors\/[A-Za-z0-9_-]+\.svg$/;

function toImageSrc(imageUrl: string, allowSameOriginPath: boolean): string | null {
  if (imageUrl === "") return null;
  if (imageUrl.startsWith("/")) {
    return allowSameOriginPath && MOCK_SPONSOR_IMAGE_PATH.test(imageUrl) ? imageUrl : null;
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
