import { TIMEOUTS, withDeadline } from "@off-r39x/reliability";
import { rejectDuplicateKeys } from "./middleware/json.ts";

// Public transport subset of neon-js server/endpoints.ts, reviewed 2026-10-27.
// This is deliberately separate from business RPC / Operation IDs.
export const AUTH_ROUTES = Object.freeze({
  "get-session": "GET",
  token: "GET",
  "verify-email": "GET",
  "magic-link/verify": "GET",
  "sign-up/email": "POST",
  "sign-in/email": "POST",
  "sign-in/social": "POST",
  "sign-in/email-otp": "POST",
  "sign-in/magic-link": "POST",
  "sign-out": "POST",
  "send-verification-email": "POST",
  "request-password-reset": "POST",
  "reset-password": "POST",
  "email-otp/send-verification-otp": "POST",
  "email-otp/verify-email": "POST",
});
const cookieNames = new Set([
  "__Secure-neon-auth.session_token",
  "__Secure-neon-auth.session_challenge",
  "__Secure-neon-auth.session_challange",
]);
const callbackFields = new Set([
  "callbackURL",
  "newUserCallbackURL",
  "errorCallbackURL",
  "redirectTo",
]);
const returnPaths = new Set([
  "/account/login",
  "/account/register",
  "/account/email-verification",
  "/account/password-reset",
  "/account/password-reset/complete",
  "/mypage",
  "/cart",
]);
class TransportFailure extends Error {
  constructor(readonly status: number) {
    super("Auth transport rejected");
  }
}
function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid auth proxy configuration");
  return url;
}
async function textWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new TransportFailure(503);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new TransportFailure(413);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export type AuthProxy = ReturnType<typeof createAuthProxy>;
export function createAuthProxy(
  config: { baseUrl: string; publicAuthOrigin: string; webOrigin: string },
  transport: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  const base = httpsUrl(config.baseUrl),
    publicOrigin = httpsUrl(config.publicAuthOrigin),
    web = httpsUrl(config.webOrigin);
  if (
    publicOrigin.origin !== config.publicAuthOrigin ||
    web.origin !== config.webOrigin ||
    base.pathname.endsWith("/")
  )
    throw new Error("Invalid auth proxy configuration");
  const safeReturn = (value: string): boolean => {
    try {
      const u = new URL(value, web);
      return (
        !u.username &&
        !u.password &&
        !u.hash &&
        u.origin === web.origin &&
        (returnPaths.has(u.pathname) || /^\/karaoke\/slots\/[0-9a-f-]{36}$/i.test(u.pathname))
      );
    } catch {
      return false;
    }
  };
  return {
    async handle(request: Request): Promise<Response> {
      const headers = new Headers({
        "Cache-Control": "no-store",
        Vary: "Origin",
        "X-Content-Type-Options": "nosniff",
      });
      const error = (status: number) =>
        Response.json(
          { error: "Authentication transport unavailable or request rejected." },
          { status, headers },
        );
      const url = new URL(request.url),
        path = url.pathname.replace(/^\/auth\//, "");
      if (
        url.origin !== publicOrigin.origin ||
        !url.pathname.startsWith("/auth/") ||
        !Object.hasOwn(AUTH_ROUTES, path)
      )
        return error(404);
      const method = AUTH_ROUTES[path as keyof typeof AUTH_ROUTES];
      const origin = request.headers.get("Origin");
      if (origin && origin !== web.origin) return error(403);
      if (origin === web.origin) {
        headers.set("Access-Control-Allow-Origin", web.origin);
        headers.set("Access-Control-Allow-Credentials", "true");
      }
      if (request.method === "OPTIONS") {
        if (
          origin !== web.origin ||
          request.headers.get("Access-Control-Request-Method") !== method ||
          (request.headers.get("Access-Control-Request-Headers") ?? "")
            .split(",")
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean)
            .some((h) => !["content-type", "x-neon-client-info", "x-csrf-token"].includes(h))
        )
          return error(403);
        headers.set("Access-Control-Allow-Methods", method);
        headers.set(
          "Access-Control-Allow-Headers",
          "Content-Type, X-Neon-Client-Info, X-CSRF-Token",
        );
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== method) {
        headers.set("Allow", `${method}, OPTIONS`);
        return error(405);
      }
      const navigation = ["verify-email", "magic-link/verify"].includes(path) && method === "GET";
      if (!navigation && origin !== web.origin) return error(403);
      const site = request.headers.get("Sec-Fetch-Site");
      if (!navigation && site && !["same-origin", "same-site"].includes(site)) return error(403);
      try {
        return await withDeadline(
          async (signal) => {
            for (const field of callbackFields) {
              const values = url.searchParams.getAll(field);
              if (values.length > 1 || values.some((v) => !safeReturn(v)))
                throw new TransportFailure(400);
            }
            const upstream = new URL(`${base.href}/${path}`);
            upstream.search = url.search;
            const forwarded = new Headers();
            for (const h of ["content-type", "accept", "x-neon-client-info", "x-csrf-token"]) {
              const value = request.headers.get(h);
              if (value) forwarded.set(h, value);
            }
            forwarded.set("Origin", web.origin);
            forwarded.set("x-neon-auth-middleware", "true");
            forwarded.set(
              "Cookie",
              (request.headers.get("Cookie") ?? "")
                .split(";")
                .map((c) => c.trim())
                .filter((c) => cookieNames.has(c.split("=", 1)[0] ?? ""))
                .join("; "),
            );
            let body: string | undefined;
            if (method === "POST") {
              if (
                !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
                  request.headers.get("Content-Type") ?? "",
                )
              )
                throw new TransportFailure(415);
              body = await textWithinLimit(request.body, signal);
              let parsed: Record<string, unknown>;
              try {
                rejectDuplicateKeys(body);
                parsed = JSON.parse(body);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                  throw new Error();
              } catch {
                throw new TransportFailure(400);
              }
              for (const field of callbackFields)
                if (
                  field in parsed &&
                  (typeof parsed[field] !== "string" || !safeReturn(parsed[field]))
                )
                  throw new TransportFailure(400);
              if (path === "sign-in/social" && parsed.provider !== "google")
                throw new TransportFailure(400);
            }
            const response = await transport(upstream.href, {
              method,
              headers: forwarded,
              ...(body !== undefined ? { body } : {}),
              redirect: "manual",
              signal,
            });
            const bytes = await textWithinLimit(response.body, signal);
            for (const name of [
              "content-type",
              "set-auth-jwt",
              "set-auth-token",
              "x-neon-ret-request-id",
              "retry-after",
            ]) {
              const value = response.headers.get(name);
              if (value) headers.set(name, value);
            }
            const location = response.headers.get("Location");
            if (location) {
              const destination = new URL(location, upstream);
              if (
                !safeReturn(destination.href) &&
                !(path === "sign-in/social" && destination.origin === "https://accounts.google.com")
              )
                throw new TransportFailure(503);
              headers.set("Location", destination.href);
            }
            for (const cookie of response.headers.getSetCookie()) {
              const [pair, ...attributes] = cookie.split(";").map((x) => x.trim());
              if (!pair || !cookieNames.has(pair.split("=", 1)[0] ?? ""))
                throw new TransportFailure(503);
              const lifetime = attributes.filter((a) => /^(?:Max-Age|Expires)=/i.test(a));
              headers.append(
                "Set-Cookie",
                [pair, ...lifetime, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"].join("; "),
              );
            }
            return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
              status: response.status,
              headers,
            });
          },
          TIMEOUTS.authMs,
          request.signal,
        );
      } catch (errorValue) {
        // Never return provider errors, credentials or incomplete Set-Cookie headers.
        headers.delete("Set-Cookie");
        headers.delete("Location");
        headers.delete("set-auth-jwt");
        headers.delete("set-auth-token");
        return error(errorValue instanceof TransportFailure ? errorValue.status : 503);
      }
    },
  };
}
