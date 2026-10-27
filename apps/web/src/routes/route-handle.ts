// What a route module may attach to its route through `export const handle` (DEV-WEB-001). The root layout reads
// the deepest matched handle to build the document title (SPEC-050 7), so a page names its title here and
// nowhere else.
export type RouteHandle = {
  readonly title?: string;
};

/** `useMatches()` types `handle` as unknown: check it at run time instead of casting. */
export function isRouteHandle(value: unknown): value is RouteHandle {
  if (typeof value !== "object" || value === null) return false;
  const title: unknown = Reflect.get(value, "title");
  return title === undefined || typeof title === "string";
}
