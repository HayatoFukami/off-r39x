import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  assertAuthAllowlist,
  assertMountedAuthRoutes,
  assertMountedRoutesClassified,
  CANONICAL_AUTH_ALLOWLIST,
  createRouteClassifier,
  findUnclassifiedRoutes,
  ROUTES,
} from "../../apps/api/src/api/routes.ts";
import {
  assertRouteRegistry,
  GUARD_CLASS_IDS,
  normalizeLoginIdentifier,
  OPERATION_CLASS_ASSIGNMENT,
  RATE_LIMIT_CLASS_IDS,
  type RouteRegistration,
  rateLimitClassOf,
} from "../../packages/security/src/index.ts";

const specs = resolve(import.meta.dirname, "../../docs/specs");
const spec = (name: string) => readFileSync(resolve(specs, name), "utf8");
const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

/** Canonical ceilings written as a full RATE_LIMIT_CONFIG. */

describe("Operation -> class assignment", () => {
  const expandCell = (cell: string): string[] => {
    const ids: string[] = [];
    const rangePattern = /`(API-[A-Z-]+?)-(\d{3})`〜`(API-[A-Z-]+?)-(\d{3})`/g;
    for (const match of cell.matchAll(rangePattern))
      for (let n = Number(match[2]); n <= Number(match[4]); n += 1)
        ids.push(`${match[1]}-${String(n).padStart(3, "0")}`);
    const withoutRanges = cell.replace(rangePattern, "");
    for (const match of withoutRanges.matchAll(/`(API-[A-Z-]+-\d{3})`/g))
      ids.push(match[1] as string);
    return ids;
  };

  it("TC-RLM-007-001 every canonical Operation ID has exactly one class, equal to SPEC-110 §56.1", () => {
    const text = spec("110-api-specification.md");
    const section = text.slice(text.indexOf("## 56.1 Rate limit class assignment"));
    const table = section
      .slice(0, section.indexOf("`auth_failure_guard_attendee` と"))
      .split("\n")
      .filter((line) => /^\| [`a-z_（A-Za-z）]/.test(line) && !line.startsWith("| Class ID"))
      .map(cells);
    const fromSpec = new Map<string, string>();
    const catalog = text.slice(text.indexOf("## 41. Administrator read catalog"));
    const catalogIds = [
      ...catalog
        .slice(0, catalog.indexOf("Admin responseもInternal PK"))
        .matchAll(/^\| `(API-[A-Z-]+-\d{3})` \|/gm),
    ].map((match) => match[1] as string);
    expect(catalogIds).toHaveLength(29);
    for (const row of table) {
      const classId = (row[0] ?? "").replace(/`|（.*）/g, "");
      const ids = row[0]?.includes("Administrator read")
        ? [...catalogIds, ...expandCell(row[1] ?? "")]
        : expandCell(row[1] ?? "");
      for (const id of ids) {
        expect(fromSpec.has(id), `${id} appears in two classes`).toBe(false);
        fromSpec.set(id, classId);
      }
    }
    expect(fromSpec.size).toBeGreaterThan(100);
    expect(Object.fromEntries(OPERATION_CLASS_ASSIGNMENT)).toEqual(Object.fromEntries(fromSpec));
    // Every Operation ID defined by a heading or the PUB/§41 tables is in §56.1.
    const defined = new Set<string>(catalogIds);
    for (const file of ["110-api-specification.md", "120-email-notification-specification.md"]) {
      const body = spec(file);
      for (const match of body.matchAll(/^#{2,5} `?(API-[A-Z-]+-\d{3})`? /gm))
        defined.add(match[1] as string);
    }
    for (const match of text.matchAll(/^\| `(API-PUB-\d{3})` \|/gm))
      defined.add(match[1] as string);
    for (const id of defined) expect(rateLimitClassOf(id), id).toBeDefined();
    // The class set of §56.1 plus the two guards is exactly the §68 Class ID set.
    const classSet = new Set(table.map((row) => (row[0] ?? "").replace(/`|（.*）/g, "")));
    expect([...classSet, ...GUARD_CLASS_IDS].sort()).toEqual([...RATE_LIMIT_CLASS_IDS].sort());
    // TST-RLM-007: the 15 Operation classes are the §68 set without the two guards, which are
    // never an Operation class (their targets are checked in TC-RLM-006-001 / TST-RLM-005).
    expect(classSet.size).toBe(15);
    for (const id of ["auth_session", "auth_callback", "auth_form_proxy"])
      expect(classSet.has(id), id).toBe(true);
    for (const guard of GUARD_CLASS_IDS) expect(classSet.has(guard)).toBe(false);
    expect([...RATE_LIMIT_CLASS_IDS].filter((id) => !classSet.has(id)).sort()).toEqual(
      [...GUARD_CLASS_IDS].sort(),
    );
  });

  it("TC-RLM-007-003 a mounted route that is not in the registry is reported; middleware, OPTIONS and health are the only exceptions", () => {
    const mounted = new Hono();
    mounted.use("*", async (_c, next) => next());
    mounted.use("/api/v1/*", async (_c, next) => next());
    mounted.get("/api/v1/self/principal", (c) => c.body(null));
    mounted.on(["POST", "OPTIONS"], "/auth/sign-in/email", (c) => c.body(null));
    mounted.get("/internal/health/live", (c) => c.body(null));
    mounted.get("/internal/health/ready", (c) => c.body(null));
    expect(findUnclassifiedRoutes(mounted.routes)).toEqual([]);
    expect(() => assertMountedRoutesClassified(mounted.routes)).not.toThrow();

    // A later route that nobody added to the registry is found, whatever the method or shape.
    mounted.get("/api/v1/offerings/:id", (c) => c.body(null));
    mounted.post("/api/v1/orders", (c) => c.body(null));
    mounted.get("/files/*", (c) => c.body(null));
    mounted.all("/webhooks/stripe", (c) => c.body(null));
    expect(findUnclassifiedRoutes(mounted.routes).sort()).toEqual([
      "ALL /webhooks/stripe",
      "GET /api/v1/offerings/:id",
      "GET /files/*",
      "POST /api/v1/orders",
    ]);
    expect(() => assertMountedRoutesClassified(mounted.routes)).toThrow(
      "Routes without a rate limit class registration",
    );
    // The registered routes themselves are recognised (parameterised ones included).
    const classify = createRouteClassifier([
      {
        method: "GET",
        path: "/api/v1/self/principal",
        operationId: "API-AUTH-001",
        rateLimitClass: "self_read",
      },
    ]);
    expect(
      findUnclassifiedRoutes([{ method: "GET", path: "/api/v1/self/principal" }], classify),
    ).toEqual([]);
  });

  it("TC-RLM-007-002 an Operation outside the table, a wrong class or a duplicate is rejected by startup validation and by the type system", () => {
    const good: RouteRegistration = {
      method: "GET",
      path: "/api/v1/self/principal",
      operationId: "API-AUTH-001",
      rateLimitClass: "self_read",
    };
    expect(() => assertRouteRegistry([good])).not.toThrow();
    const declare = (route: RouteRegistration): RouteRegistration => route;
    const registrations: RouteRegistration[] = [
      // biome-ignore format: the directive must share a line with the offending literal
      // @ts-expect-error DEV-RLM-005: an Operation outside the class table is a type error
      declare({ method: "GET", path: "/x", operationId: "API-UNKNOWN-001", rateLimitClass: "public_read" }),
      // biome-ignore format: the directive must share a line with the offending literal
      // @ts-expect-error DEV-RLM-005: the rate limit class is mandatory
      declare({ method: "GET", path: "/y", operationId: "API-AUTH-001" }),
      // biome-ignore format: the directive must share a line with the offending literal
      // @ts-expect-error DEV-RLM-005: the class must be the Operation's §56.1 class
      declare({ method: "GET", path: "/z", operationId: "API-AUTH-001", rateLimitClass: "public_read" }),
      // biome-ignore format: the directive must share a line with the offending literal
      // @ts-expect-error a guard is not an Operation class
      declare({ method: "GET", path: "/g", operationId: "API-AUTH-001", rateLimitClass: "auth_failure_guard_attendee" }),
    ];
    for (const bad of registrations) expect(() => assertRouteRegistry([bad])).toThrow();
    expect(() => assertRouteRegistry([good, { ...good, path: "/other" }])).toThrow();
    expect(() => assertRouteRegistry([good, { ...good }])).toThrow();
    expect(() =>
      assertRouteRegistry([
        {
          method: "POST",
          path: "/auth/sign-in/email",
          operationId: null,
          rateLimitClass: "auth_form_proxy",
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertRouteRegistry([
        { method: "GET", path: "/x", operationId: null, rateLimitClass: "public_read" } as never,
      ]),
    ).toThrow();
  });
});

describe("/auth/* allowlist equals SPEC-110 §23.1 (API-RLC-004, TST-RLM-007)", () => {
  /** The 15 rows of the Canonical `/auth/*` allowlist table, read from the specification itself. */
  const specTable = (): [string, string, string][] => {
    const body = spec("110-api-specification.md");
    const start = body.indexOf("**Canonical `/auth/*` allowlist:**");
    expect(start).toBeGreaterThan(0);
    const rows: [string, string, string][] = [];
    for (const line of body.slice(start, start + 4000).split("\n")) {
      const row = cells(line);
      if (row.length === 4 && /^\d+$/.test(row[0] ?? ""))
        rows.push([
          (row[1] ?? "").replace(/`/g, ""),
          (row[2] ?? "").replace(/`/g, ""),
          (row[3] ?? "").replace(/`/g, ""),
        ]);
    }
    return rows;
  };
  const implemented = () =>
    ROUTES.filter((route) => route.path.startsWith("/auth/")).map((route) => ({
      method: route.method,
      path: route.path,
      classId: route.rateLimitClass as string,
    }));
  const asKeys = (rows: readonly (readonly string[])[]) => rows.map((row) => row.join(" ")).sort();

  it("TC-RLM-007-004 the implemented allowlist (method, path, class) is exactly the 15 routes of the SPEC-110 §23.1 table", () => {
    const fromSpec = specTable();
    expect(fromSpec).toHaveLength(15);
    expect(asKeys(CANONICAL_AUTH_ALLOWLIST)).toEqual(asKeys(fromSpec));
    expect(asKeys(implemented().map((r) => [r.method, r.path, r.classId]))).toEqual(
      asKeys(fromSpec),
    );
    expect(() => assertAuthAllowlist(implemented(), fromSpec)).not.toThrow();
    // No Google OAuth callback and no other route is admitted while UCR-110-002 is unresolved.
    expect(implemented().every((route) => route.path.startsWith("/auth/"))).toBe(true);
    // The §56.1 rows of the three /auth classes name the same routes as the table.
    const text = spec("110-api-specification.md");
    for (const classId of ["auth_session", "auth_callback", "auth_form_proxy"]) {
      const row = text.split("\n").find((line) => line.startsWith(`| \`${classId}\` |`)) ?? "";
      const named = [...row.matchAll(/`(?:GET |POST )?(\/auth\/[a-z/-]+)`/g)].map((m) => m[1]);
      const expected = fromSpec.filter((r) => r[2] === classId).map((r) => r[1]);
      for (const path of named) expect(expected, `${classId} ${path}`).toContain(path);
    }
  });

  it("TC-RLM-007-005 an extra route, a missing route, a different class or a duplicate makes the startup check fail", () => {
    const base = implemented();
    expect(() => assertAuthAllowlist(base)).not.toThrow();
    const extra = [
      ...base,
      { method: "POST", path: "/auth/sign-in/phone", classId: "auth_form_proxy" },
    ];
    expect(() => assertAuthAllowlist(extra)).toThrow("extra");
    expect(() => assertAuthAllowlist(base.slice(1))).toThrow("missing");
    const reclassed = base.map((r) =>
      r.path === "/auth/verify-email" ? { ...r, classId: "auth_form_proxy" } : r,
    );
    expect(() => assertAuthAllowlist(reclassed)).toThrow();
    const otherMethod = base.map((r) =>
      r.path === "/auth/get-session" ? { ...r, method: "POST" } : r,
    );
    expect(() => assertAuthAllowlist(otherMethod)).toThrow();
    expect(() => assertAuthAllowlist([...base, ...base.slice(0, 1)])).toThrow("duplicated");
    // A Google OAuth callback path is not in the table, so it cannot be added on the quiet.
    expect(() =>
      assertAuthAllowlist([
        ...base,
        { method: "GET", path: "/auth/callback/google", classId: "auth_callback" },
      ]),
    ).toThrow("extra");
  });

  it("TC-RLM-007-006 the mounted /auth/* routes must equal the table when the proxy exists, and be absent when it does not", () => {
    const mount = (extra: [string, string][] = [], without: string[] = []) => {
      const app = new Hono();
      app.use("/auth/*", async (_c, next) => next());
      for (const [method, path] of CANONICAL_AUTH_ALLOWLIST)
        if (!without.includes(path)) app.on([method, "OPTIONS"], path, (c) => c.body(null));
      for (const [method, path] of extra) app.on([method], path, (c) => c.body(null));
      return app.routes;
    };
    expect(() => assertMountedAuthRoutes(mount(), true)).not.toThrow();
    expect(() => assertMountedAuthRoutes(mount([["POST", "/auth/sign-in/phone"]]), true)).toThrow();
    expect(() => assertMountedAuthRoutes(mount([], ["/auth/token"]), true)).toThrow();
    expect(() => assertMountedAuthRoutes(mount(), false)).toThrow();
    expect(() => assertMountedAuthRoutes([], false)).not.toThrow();
  });
});

describe("counter keys (SEC-ABU-015 / 016)", () => {
  const _secret = Buffer.alloc(32, 9);
  it("TC-RLM-004-101 login identifiers are normalised before hashing", () => {
    expect(normalizeLoginIdentifier("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeLoginIdentifier("ＵＳＥＲ@example.com")).toBe("user@example.com");
    expect(normalizeLoginIdentifier("   ")).toBeUndefined();
    expect(normalizeLoginIdentifier(42)).toBeUndefined();
    expect(normalizeLoginIdentifier("a".repeat(321))).toBeUndefined();
  });

  it("TC-RLM-004-226 the login identifier normalisation of SEC-ABU-024: trim, NFKC, lower case, 1 to 320 characters, strings only", () => {
    const same = [
      "User@Example.test",
      " user@example.test ",
      "\u3000USER@example.test\n",
      "ＵＳＥＲ＠example.test",
    ];
    for (const value of same)
      expect(normalizeLoginIdentifier(value), value).toBe("user@example.test");
    // Not a string: the identifier cannot be taken, whatever the value.
    for (const value of [
      undefined,
      null,
      0,
      123,
      true,
      ["a@example.test"],
      { email: "a@example.test" },
    ])
      expect(normalizeLoginIdentifier(value), String(value)).toBeUndefined();
    // Empty (also after trimming) and over-long values are not usable.
    for (const value of ["", "   ", "\u3000"])
      expect(normalizeLoginIdentifier(value)).toBeUndefined();
    expect(normalizeLoginIdentifier("a".repeat(320))).toHaveLength(320);
    expect(normalizeLoginIdentifier("a".repeat(321))).toBeUndefined();
    // The limit applies to the normalised text: a compatibility character that expands is counted expanded.
    expect(normalizeLoginIdentifier("㈱".repeat(106))).toBe("(株)".repeat(106));
    expect(normalizeLoginIdentifier("㈱".repeat(107))).toBeUndefined();
    // The lower casing does not depend on the process locale (Turkish dotted / dotless i).
    expect(normalizeLoginIdentifier("I@example.test")).toBe("i@example.test");
  });
});
