// External links become links only for https URLs without credentials (SEC-WEB-016).

export function safeExternalHref(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return url;
}
