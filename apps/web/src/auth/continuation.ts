// Continuation Intent (SPEC-060 AR-CONT-001..004, SPEC-140 SEC-WEB-013, SPEC-050 10, 15.6).
// Pure: an intent is only an allow-listed key plus a public reference. It cannot carry values
// that are authoritative on the server; the destination page reads its current state again.

export const CONTINUATION_PARAM = "continue";

export type ContinuationKey =
  | "cart"
  | "karaoke-slot"
  | "purchase-order"
  | "mypage"
  | "mypage-profile"
  | "mypage-orders"
  | "mypage-order"
  | "mypage-entry-tickets"
  | "mypage-entry-ticket"
  | "mypage-karaoke"
  | "mypage-reservation"
  | "mypage-goods"
  | "mypage-goods-item";

export type ContinuationIntent = { readonly key: ContinuationKey; readonly ref: string | null };

export const CONTINUATION_KEYS: readonly ContinuationKey[] = [
  "cart",
  "karaoke-slot",
  "purchase-order",
  "mypage",
  "mypage-profile",
  "mypage-orders",
  "mypage-order",
  "mypage-entry-tickets",
  "mypage-entry-ticket",
  "mypage-karaoke",
  "mypage-reservation",
  "mypage-goods",
  "mypage-goods-item",
];

export const PROTECTED_PATH_PREFIXES: readonly string[] = ["/mypage", "/purchase"];

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Route = { readonly base: string; readonly takesRef: boolean };

// QR pages have no key on purpose: a QR is never a return destination (SEC-QR-012 / 013).
const ROUTES: Readonly<Record<ContinuationKey, Route>> = {
  cart: { base: "/cart", takesRef: false },
  "karaoke-slot": { base: "/karaoke/slots", takesRef: true },
  "purchase-order": { base: "/purchase/orders", takesRef: true },
  mypage: { base: "/mypage", takesRef: false },
  "mypage-profile": { base: "/mypage/profile", takesRef: false },
  "mypage-orders": { base: "/mypage/orders", takesRef: false },
  "mypage-order": { base: "/mypage/orders", takesRef: true },
  "mypage-entry-tickets": { base: "/mypage/entry-tickets", takesRef: false },
  "mypage-entry-ticket": { base: "/mypage/entry-tickets", takesRef: true },
  "mypage-karaoke": { base: "/mypage/karaoke", takesRef: false },
  "mypage-reservation": { base: "/mypage/karaoke", takesRef: true },
  "mypage-goods": { base: "/mypage/goods", takesRef: false },
  "mypage-goods-item": { base: "/mypage/goods", takesRef: true },
};

const MYPAGE_INTENT: ContinuationIntent = { key: "mypage", ref: null };

const isKey = (value: string): value is ContinuationKey =>
  (CONTINUATION_KEYS as readonly string[]).includes(value);

/** An absent parameter is no intent; any value that is not an exact allow-listed form is `mypage`. */
export function parseContinuation(raw: string | null | undefined): ContinuationIntent | null {
  if (raw === null || raw === undefined) return null;
  const parts = raw.split(":");
  if (parts.length > 2) return MYPAGE_INTENT;
  const [key = "", ref] = parts;
  if (!isKey(key)) return MYPAGE_INTENT;
  const route = ROUTES[key];
  if (!route.takesRef) {
    return ref === undefined ? { key, ref: null } : MYPAGE_INTENT;
  }
  return ref !== undefined && CANONICAL_UUID.test(ref) ? { key, ref } : MYPAGE_INTENT;
}

export function serializeContinuation(intent: ContinuationIntent): string {
  return intent.ref === null ? intent.key : `${intent.key}:${intent.ref}`;
}

const hasControlCharacter = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const MAX_DECODE_PASSES = 3;

function hasForbiddenForm(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return true;
  if (value.includes("\\") || hasControlCharacter(value)) return true;
  const pathPart = value.split(/[?#]/)[0] ?? "";
  const segments = pathPart.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === "..")) return true;
  const first = (segments[0] ?? "").toLowerCase();
  return first === "admin" || first === "staff";
}

/** SEC-WEB-013: a same-origin relative path that is also safe after repeated percent decoding. */
export function isSafeRelativePath(path: unknown): boolean {
  if (typeof path !== "string" || path === "") return false;
  let current = path;
  if (hasForbiddenForm(current)) return false;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return true;
    if (hasForbiddenForm(decoded)) return false;
    current = decoded;
  }
  // Still changing after the allowed passes: not a stable, plain path.
  try {
    return decodeURIComponent(current) === current;
  } catch {
    return false;
  }
}

/** The destination path, re-checked before it is used (SEC-WEB-013). Anything doubtful is /mypage. */
export function continuationPath(intent: ContinuationIntent): string {
  const route = isKey(intent.key) ? ROUTES[intent.key] : undefined;
  if (route === undefined) return "/mypage";
  let path: string;
  if (route.takesRef) {
    if (intent.ref === null || !CANONICAL_UUID.test(intent.ref)) return "/mypage";
    path = `${route.base}/${intent.ref}`;
  } else {
    if (intent.ref !== null) return "/mypage";
    path = route.base;
  }
  return isSafeRelativePath(path) ? path : "/mypage";
}

/** Where a cancelled authentication goes back to: Cart, the Karaoke slot, otherwise Home. */
export function continuationCancelPath(intent: ContinuationIntent | null): string {
  if (intent === null) return "/";
  if (intent.key === "cart" || intent.key === "karaoke-slot") return continuationPath(intent);
  return "/";
}

const isProtectedPath = (path: string): boolean =>
  PROTECTED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/** Reverse lookup for AuthGate. Public paths give null; a protected path with no key gives `mypage`. */
export function continuationForPath(pathname: string): ContinuationIntent | null {
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (!isProtectedPath(path)) return null;
  for (const key of CONTINUATION_KEYS) {
    const route = ROUTES[key];
    if (!isProtectedPath(route.base)) continue;
    if (!route.takesRef) {
      if (path === route.base) return { key, ref: null };
      continue;
    }
    if (path.startsWith(`${route.base}/`)) {
      const ref = path.slice(route.base.length + 1);
      if (CANONICAL_UUID.test(ref)) return { key, ref };
    }
  }
  return MYPAGE_INTENT;
}

export type AccountPage = "login" | "register" | "email-verification" | "password-reset";

export function accountPath(page: AccountPage, intent: ContinuationIntent | null): string {
  const base = `/account/${page}`;
  if (intent === null) return base;
  return `${base}?${CONTINUATION_PARAM}=${encodeURIComponent(serializeContinuation(intent))}`;
}
