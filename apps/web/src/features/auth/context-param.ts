// The opaque verification / reset context arrives as a query parameter (mock). It is read once and
// removed from the address bar at once; other parameters stay (SEC-AUTH-018).

export const CONTEXT_PARAM = "context";

/** An empty value is no context. */
export function readContext(raw: string | null): string | null {
  return raw === null || raw === "" ? null : raw;
}

export function removeContextFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(CONTEXT_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
