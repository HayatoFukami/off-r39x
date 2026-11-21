// PR-L2-3 C1. TC-API-006-102 (API-PUB-012) and TC-API-009-007 (API-PUB-001..005) (G5): security of the six
// public read Operations without a database: no non-public content, SQL, SQLSTATE or stack in any
// response, no token / role / header that selects anything (SPEC-110 §6, API-PUB-READ-001), Origin on GET
// unchanged, Rate Limit refusals that never reach the public store (SEC-ABU-017/019) and log redaction
// (SPEC-160 §49.1). What the repository selects is TC-API-009-005 / TC-API-006-101 on a real PG17.
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_REFS,
  announcementRows,
  BAD,
  createRecordingPublicContentStore,
  errorOf,
  faqRows,
  GOOD,
  logoRows,
  NONPUBLIC_MARKER,
  offeringRows,
  PUBLIC_OPERATIONS,
  publicReadRig,
  WEB,
} from "../harness/api/public-read.ts";

const OPS_001_005 = PUBLIC_OPERATIONS.filter((o) => o.key !== "sponsorLogos");
const OPS_012 = PUBLIC_OPERATIONS.filter((o) => o.key === "sponsorLogos");
const SQL_OR_STACK =
  /\b(select|insert|update|delete)\b.*\bfrom\b|SQLSTATE|\bat \S+ \(|node_modules|\.ts:\d+/i;

function securityCases(ops: readonly (typeof PUBLIC_OPERATIONS)[number][]): void {
  describe.each(ops)("$operationId $path", ({ path }) => {
    it("every refusal and failure body carries no marker of a non-public row, SQL, SQLSTATE, stack or the store's failure text", async () => {
      const failures: [
        string,
        number,
        (r: ReturnType<typeof publicReadRig>) => Promise<Response>,
      ][] = [
        [
          "400 unknown query",
          400,
          (r) => r.get(`${path}${path.includes("?") ? "&" : "?"}state=DRAFT`),
        ],
        [
          "405",
          405,
          (r) =>
            r.send(path, {
              method: "POST",
              headers: { Origin: WEB, "Content-Type": "application/json" },
              body: "{}",
            }),
        ],
        [
          "503 database",
          503,
          (r) => {
            r.store.inject("FP.DB.INSIDE_STATEMENT");
            return r.get(path);
          },
        ],
        [
          "500 store throws",
          500,
          (r) => {
            r.store.inject("PUBLIC.STORE_THROWS");
            return r.get(path);
          },
        ],
        [
          "500 multiple Events",
          500,
          (r) => {
            r.store.inject("PUBLIC.MULTIPLE_EVENTS");
            return r.get(path);
          },
        ],
      ];
      for (const [label, status, run] of failures) {
        const r = publicReadRig();
        const res = await run(r);
        expect(res.status, label).toBe(status);
        const text = await res.text();
        expect(text, label).not.toContain(NONPUBLIC_MARKER);
        expect(text, label).not.toContain("synthetic public store failure");
        expect(text, label).not.toMatch(SQL_OR_STACK);
        expect(text, label).not.toContain("Synthetic");
        expect(Object.keys(JSON.parse(text) as object), label).toEqual(["error"]);
      }
    });

    it("an unclassified failure leaves the response body generic and logs no row content", async () => {
      const r = publicReadRig();
      r.store.inject("PUBLIC.STORE_THROWS");
      const res = await r.get(path);
      expect(res.status).toBe(500);
      expect((await errorOf(res)).code).toBe("INTERNAL_ERROR");
      const logs = r.lines.join("\n");
      expect(logs).not.toContain("Synthetic");
    });

    it("no request input selects anything: Authorization, Cookie, X-Profile-Ref and role-like headers do not change the response and no Principal is resolved", async () => {
      const reference = await (await publicReadRig().get(path)).json();
      const headerSets: Record<string, string>[] = [
        { Authorization: `Bearer ${GOOD}` },
        { Authorization: `Bearer ${BAD}` },
        { Authorization: "Bearer " },
        { Authorization: "not a scheme" },
        { "X-Profile-Ref": "00000000-0000-4000-8000-0000000000b1" },
        { "X-Role": "ADMINISTRATOR", "X-Capabilities": "public_content.manage" },
        { Cookie: "better-auth.session_token=synthetic; role=ADMINISTRATOR" },
        { "X-Forwarded-User": "00000000-0000-4000-8000-0000000000b1" },
      ];
      for (const headers of headerSets) {
        const r = publicReadRig();
        const res = await r.get(path, headers);
        expect(res.status, JSON.stringify(headers)).toBe(200);
        expect((await res.json()).data, JSON.stringify(headers)).toEqual(
          (reference as { data: unknown }).data,
        );
        expect(r.verifications()).toBe(0);
        expect(r.principalReads()).toBe(0);
        expect(r.order.some((entry) => entry === "verify" || entry === "db")).toBe(false);
        // Stage 1 only: no second (subject) evaluation.
        expect(r.order.filter((entry) => entry.startsWith("store:"))).toEqual(["store:admit"]);
      }
    });

    it("identity-like query parameters are refused, not ignored (400, no store call)", async () => {
      for (const query of [
        "?profile_ref=00000000-0000-4000-8000-0000000000b1",
        "?auth_subject=00000000-0000-4000-8000-0000000000b1",
        "?role=ADMINISTRATOR",
        "?state=DRAFT&state=PUBLISHED",
        "?include_drafts=true",
      ]) {
        const r = publicReadRig();
        const res = await r.get(`${path}${query}`);
        expect(res.status, query).toBe(400);
        expect((await errorOf(res)).code, query).toBe("VALIDATION_FAILED");
        expect(r.store.calls, query).toEqual([]);
      }
    });

    it("Origin on GET is unchanged: a different origin is 403 AUTHORIZATION_DENIED (no store call); no Origin and the Web Origin are served", async () => {
      const denied = publicReadRig();
      const res = await denied.get(path, { Origin: "https://evil.example.test" });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("AUTHORIZATION_DENIED");
      expect(denied.store.calls).toEqual([]);
      for (const headers of [{}, { Origin: WEB }]) {
        const r = publicReadRig();
        expect((await r.get(path, headers)).status, JSON.stringify(headers)).toBe(200);
      }
    });

    it("a 429 and a rate limit store failure stop before the public store, with an integer Retry-After on 429 (SEC-ABU-017, SEC-ABU-019)", async () => {
      const limited = publicReadRig({
        overrides: {
          public_read: {
            burst_limit: 2,
            sustained_limit: 120,
            additional: { "public_read.global": { limit: 10000, window_seconds: 60 } },
          },
        },
      });
      expect((await limited.get(path)).status).toBe(200);
      expect((await limited.get(path)).status).toBe(200);
      const before = limited.store.calls.length;
      const refused = await limited.get(path);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect(limited.store.calls).toHaveLength(before);

      const broken = publicReadRig();
      broken.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
      const res = await broken.get(path);
      expect(res.status).toBe(503);
      expect((await errorOf(res)).code).toBe("TEMPORARY_UNAVAILABLE");
      expect(broken.store.calls).toEqual([]);
      expect(broken.principalReads()).toBe(0);
    });

    it("the response body of a successful read does not appear in any log line (redaction, SPEC-160 §49.1)", async () => {
      const r = publicReadRig();
      const res = await r.get(path);
      expect(res.status).toBe(200);
      const logs = r.lines.join("\n");
      expect(r.lines.length).toBeGreaterThan(0);
      for (const text of [
        "Synthetic",
        "https://logos.example.test",
        "https://sponsor.example.test",
        ...announcementRows().flatMap((row) => [row.title, row.body]),
        ...faqRows().flatMap((row) => [row.question, row.answer]),
        ...logoRows().flatMap((row) => [row.displayName, row.imageUrl]),
        ...offeringRows().map((row) => row.name),
      ])
        expect(logs, text).not.toContain(text);
      expect(logs).not.toContain(ANNOUNCEMENT_REFS[0]);
    });
  });
}

describe("TC-API-009-007 security of API-PUB-001..005 (SPEC-110 §6, §55, SEC-API-022, SEC-ABU-017, SEC-ABU-019, SPEC-160 §49.1, INV-010-08)", () => {
  securityCases(OPS_001_005);

  it("the store's rows are the only source of content: a row a store never returned (a DRAFT or ARCHIVED one) cannot appear, whatever the request says", async () => {
    // The route holds no row of its own: with a store that returns nothing, nothing is shown.
    const empty = createRecordingPublicContentStore({
      faqs: { status: "ok", items: [] },
      announcements: { status: "ok", items: [] },
      announcement: { status: "not_found" },
      offerings: { status: "ok", now: "2030-06-15T00:00:00.000Z", items: [] },
      logos: { status: "ok", items: [] },
    });
    const r = publicReadRig({ store: empty });
    for (const key of ["faqs", "announcements", "entryOfferings"] as const) {
      const op = PUBLIC_OPERATIONS.find((o) => o.key === key) as (typeof PUBLIC_OPERATIONS)[number];
      const res = await r.get(`${op.path}`);
      expect((await res.json()).data, key).toEqual({ items: [] });
    }
    const detail = await r.get(`/api/v1/public/announcements/${ANNOUNCEMENT_REFS[1]}`);
    expect(detail.status).toBe(404);
    expect(await detail.text()).not.toContain(ANNOUNCEMENT_REFS[1]);
  });

  it("another Announcement ref in the path is never echoed, in a 404 or in the log (API-PUB-004: the same 404 for a DRAFT, an ARCHIVED and an unknown ref)", async () => {
    const r = publicReadRig({
      store: createRecordingPublicContentStore({ announcement: { status: "not_found" } }),
    });
    const res = await r.get(`/api/v1/public/announcements/${ANNOUNCEMENT_REFS[1]}`);
    expect(res.status).toBe(404);
    expect(r.store.refs).toEqual([ANNOUNCEMENT_REFS[1]]);
    expect(await res.text()).not.toContain(ANNOUNCEMENT_REFS[1]);
    expect(r.lines.join("\n")).not.toContain(ANNOUNCEMENT_REFS[1]);
  });

  it("an invalid ref is refused before the store and is not echoed", async () => {
    const hostile = "x'%3B%20drop%20table%20app.announcements%3B--";
    const r = publicReadRig();
    const res = await r.get(`/api/v1/public/announcements/${hostile}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("drop table");
    expect(text).not.toContain("x'");
    expect(r.store.calls).toEqual([]);
    expect(r.lines.join("\n")).not.toContain("drop table");
  });
});

describe("TC-API-006-102 security of API-PUB-012 (SPEC-110 §6, §26 API-PUB-012, SEC-ABU-017, SEC-ABU-019, SPEC-160 §49.1, INV-010-08)", () => {
  securityCases(OPS_012);

  it("the Logo URLs are not logged (image_url and link_url never appear in a log line)", async () => {
    const r = publicReadRig();
    expect((await r.get("/api/v1/public/sponsor-logos")).status).toBe(200);
    expect(r.lines.join("\n")).not.toMatch(/logos\.example\.test|sponsor\.example\.test/);
  });
});
