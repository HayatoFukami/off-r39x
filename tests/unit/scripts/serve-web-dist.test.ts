import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTree,
  type FileMap,
  REPO_ROOT,
  removeTree,
  scriptPath,
} from "../../harness/script-fixtures.ts";
import {
  BASE_SECURITY_HEADERS,
  cspValue,
  DEFAULT_REFERRER_POLICY,
  DOTFILE_SENTINEL,
  distTree,
  expectedHeadersFile,
  headerLines,
  headerValue,
  INDEX_HTML,
  NO_STORE,
  OUTSIDE_SENTINEL,
  PROTECTED_REFERRER_POLICY,
  type RawResponse,
  RESERVED_SENTINEL,
  type RunningServer,
  rawRequest,
  startServe,
} from "../../harness/web-dist.ts";

// scripts/serve-web-dist.mts: the local static server for apps/web/dist (SPEC-180 13.1, SPEC-140 22, SEC-WEB-009,
// DEV-WEB-001, DEV-REP-001 / 004, TST-GEN-006). It reads dist/_headers, serves the SPA shell for extension-less
// unknown paths and a non-HTML 404 for missing assets. Contract: tests/contracts/s9-finalize.md section 8.
// Every case starts the real script as a child process on port 0 and talks to it over HTTP.

const SERVER_TIMEOUT = { timeout: 60_000 } as const;

const roots: string[] = [];
const servers: RunningServer[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const blocker of blockers.splice(0))
    await new Promise<void>((done) => blocker.close(() => done()));
  for (const root of roots.splice(0)) removeTree(root);
});

function tree(files: FileMap = {}): string {
  const root = createTree(distTree(files), "r39x-serve-");
  roots.push(root);
  return root;
}

async function serve(
  files: FileMap = {},
  args: readonly string[] = [],
): Promise<{
  server: RunningServer;
  root: string;
}> {
  const root = tree(files);
  const server = await startServe(join(root, "dist"), args);
  servers.push(server);
  return { server, root };
}

const get = (server: RunningServer, path: string): Promise<RawResponse> =>
  rawRequest(server.port, "GET", path);

const SECURITY_NAMES = [
  "Content-Security-Policy",
  ...BASE_SECURITY_HEADERS.map(([name]) => name),
].filter((name) => name !== "Referrer-Policy");

describe("TC-STACK-008-101 an extension-less unknown path is the SPA shell (DEV-WEB-001, SPEC-050 5.4)", () => {
  it(
    "answers 200 text/html with the index.html body for application URLs, unknown URLs and a bare directory name",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const path of ["/", "/mypage", "/goods/not-a-uuid", "/no-such/deeper", "/assets"]) {
        const response = await get(server, path);
        expect(response.status, path).toBe(200);
        expect(headerValue(response, "content-type"), path).toMatch(/^text\/html/);
        expect(response.body, path).toBe(INDEX_HTML);
      }
    },
  );

  it(
    "serves the shell for a path with a query and for a trailing slash",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const path of ["/mypage?context=x", "/goods/", "/karaoke/schedule/2026-11-14"]) {
        const response = await get(server, path);
        expect(response.status, path).toBe(200);
        expect(response.body, path).toBe(INDEX_HTML);
      }
    },
  );
});

describe("TC-STACK-008-102 assets are served with a type and a missing asset is a non-HTML 404 (SPEC-180 13.1)", () => {
  it(
    "returns an existing file with 200 and the content type of its extension",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      const expected: [string, RegExp][] = [
        ["/index.html", /^text\/html/],
        ["/assets/app.js", /^(text|application)\/javascript/],
        ["/assets/app.css", /^text\/css/],
        ["/mock/x.svg", /^image\/svg\+xml/],
        ["/data.json", /^application\/json/],
        ["/robots.txt", /^text\/plain/],
        ["/favicon.ico", /^image\/(x-icon|vnd\.microsoft\.icon)/],
        ["/fonts/f.woff2", /^(font\/woff2|application\/font-woff2)/],
        ["/site.webmanifest", /^application\/(manifest\+json|json)/],
        ["/assets/blob.bin", /^application\/octet-stream/],
      ];
      for (const [path, type] of expected) {
        const response = await get(server, path);
        expect(response.status, path).toBe(200);
        expect(headerValue(response, "content-type"), path).toMatch(type);
      }
      const js = await get(server, "/assets/app.js");
      expect(js.body).toBe("export const app = 1;\n");
    },
  );

  it(
    "answers 404 text/plain without HTML for a missing asset (a path whose last segment has an extension)",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const path of ["/assets/missing.js", "/mock/sponsors/__broken__.svg", "/favicon.png"]) {
        const response = await get(server, path);
        expect(response.status, path).toBe(404);
        expect(headerValue(response, "content-type"), path).toMatch(/^text\/plain/);
        expect(response.body, path).not.toContain("<html");
        expect(response.body, path).not.toContain(INDEX_HTML.trim());
      }
    },
  );
});

describe("TC-STACK-008-103 dist/_headers is applied per path (SEC-WEB-009, SPEC-140 22, SPEC-180 13.1)", () => {
  const protectedPaths = [
    "/account",
    "/account/login",
    "/auth",
    "/auth/x",
    "/purchase/anything",
    "/mypage",
    "/mypage/orders/x",
    "/admin",
    "/admin/deeper/path",
    "/staff",
    "/staff/x",
    "/mypage?context=x",
  ];

  it(
    "(a) puts no-store and Pragma on every protected prefix and ends the Referrer-Policy with no-referrer",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const path of protectedPaths) {
        const response = await get(server, path);
        expect(response.status, path).toBe(200);
        expect(headerValue(response, "cache-control"), path).toBe(NO_STORE);
        expect(headerValue(response, "pragma"), path).toBe("no-cache");
        const policy = headerValue(response, "referrer-policy") ?? "";
        expect(policy, path).toBe(`${DEFAULT_REFERRER_POLICY}, ${PROTECTED_REFERRER_POLICY}`);
        expect(policy.split(",").pop()?.trim(), path).toBe("no-referrer");
      }
    },
  );

  it(
    "(b) leaves public paths without private / no-store and with the default Referrer-Policy only",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      // `/accounting` and `/mypagefoo` merely start with a protected prefix: a prefix rule matches whole segments.
      for (const path of [
        "/",
        "/goods",
        "/announcements/x",
        "/accounting",
        "/mypagefoo",
        "/staffing",
      ]) {
        const response = await get(server, path);
        expect(response.status, path).toBe(200);
        const cacheControl = headerValue(response, "cache-control") ?? "";
        expect(cacheControl, path).not.toMatch(/private|no-store/);
        expect(headerValue(response, "pragma"), path).toBeUndefined();
        expect(headerValue(response, "referrer-policy"), path).toBe(DEFAULT_REFERRER_POLICY);
      }
    },
  );

  it(
    "(c) sends the CSP and the five other security headers exactly once on every response, 404 included",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      const expectedValue = new Map<string, string>([
        ["Content-Security-Policy", cspValue()],
        ...BASE_SECURITY_HEADERS,
      ]);
      for (const path of [
        "/",
        "/goods",
        "/mypage",
        "/assets/missing.js",
        "/no-such/deeper",
        "/assets/app.js",
      ]) {
        const response = await get(server, path);
        for (const name of SECURITY_NAMES) {
          expect(headerLines(response, name), `${path} ${name}`).toBe(1);
          expect(headerValue(response, name), `${path} ${name}`).toBe(expectedValue.get(name));
        }
        expect(headerLines(response, "Referrer-Policy"), path).toBe(1);
      }
    },
  );

  it(
    "(c) a 404 for a protected path also carries the protected headers",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      const response = await get(server, "/mypage/missing.js");
      expect(response.status).toBe(404);
      expect(headerValue(response, "cache-control")).toBe(NO_STORE);
      expect(headerLines(response, "Content-Security-Policy")).toBe(1);
    },
  );

  it(
    "(d) joins the same header of several matching rules with a comma, in file order",
    SERVER_TIMEOUT,
    async () => {
      const custom = [
        "/*",
        "  X-Order: first",
        "",
        "/mypage/*",
        "  X-Order: second",
        "",
        "/mypage/orders",
        "  X-Order: third",
        "",
      ].join("\n");
      const { server } = await serve({ "dist/_headers": custom });
      const nested = await get(server, "/mypage/orders");
      expect(headerValue(nested, "x-order")).toBe("first, second, third");
      expect(headerLines(nested, "X-Order")).toBe(1);
      const single = await get(server, "/mypage/other");
      expect(headerValue(single, "x-order")).toBe("first, second");
      const other = await get(server, "/goods");
      expect(headerValue(other, "x-order")).toBe("first");
    },
  );

  it(
    "applies the headers of the file in use, not a built-in copy (a changed file changes the answer)",
    SERVER_TIMEOUT,
    async () => {
      const changed = expectedHeadersFile().replace(
        "X-Frame-Options: DENY",
        "X-Frame-Options: SAMEORIGIN",
      );
      const { server } = await serve({ "dist/_headers": changed });
      expect(headerValue(await get(server, "/"), "x-frame-options")).toBe("SAMEORIGIN");
    },
  );

  it(
    "adds no Cache-Control of its own: a path without a matching rule has none",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve({ "dist/_headers": "/only-here\n  X-A: b\n" });
      const response = await get(server, "/mypage");
      expect(headerValue(response, "cache-control")).toBeUndefined();
      expect(headerValue(response, "x-a")).toBeUndefined();
      expect(headerValue(await get(server, "/only-here"), "x-a")).toBe("b");
    },
  );
});

describe("TC-STACK-008-104 paths cannot leave dist or reach reserved files (SEC-WEB-001, DEV-SEC)", () => {
  it(
    "answers 404 for traversal, encoded traversal, a backslash, NUL, dotfiles and the reserved files",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const path of [
        "/../package.json",
        "/%2e%2e/package.json",
        "/%2e%2e/x",
        "/..%5cx",
        "/..%5cpackage.json",
        "/%00",
        "/assets/%00.js",
        "/.env",
        "/_headers",
        "/_redirects",
        "/assets/../../package.json",
      ]) {
        const response = await rawRequest(server.port, "GET", path);
        expect(response.status, path).toBe(404);
        for (const sentinel of [OUTSIDE_SENTINEL, DOTFILE_SENTINEL, RESERVED_SENTINEL]) {
          expect(response.body, path).not.toContain(sentinel);
        }
        expect(response.body, path).not.toContain("<html");
      }
    },
  );

  it("does not crash on a malformed percent escape and keeps serving", SERVER_TIMEOUT, async () => {
    const { server } = await serve();
    const bad = await get(server, "/%E0%A4%A");
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect((await get(server, "/")).status).toBe(200);
  });
});

describe("TC-STACK-008-105 only GET and HEAD are accepted", () => {
  it(
    "answers 405 with Allow: GET, HEAD for POST and PUT (and DELETE)",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      for (const method of ["POST", "PUT", "DELETE"]) {
        const response = await rawRequest(server.port, method, "/mypage");
        expect(response.status, method).toBe(405);
        expect(headerValue(response, "allow"), method).toBe("GET, HEAD");
      }
    },
  );

  it(
    "answers HEAD with the headers of GET and no body, for a page, an asset and a 404",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      const volatile = new Set(["date", "connection", "keep-alive", "transfer-encoding"]);
      for (const path of ["/mypage", "/assets/app.js", "/assets/missing.js", "/"]) {
        const getResponse = await get(server, path);
        const head = await rawRequest(server.port, "HEAD", path);
        expect(head.status, path).toBe(getResponse.status);
        expect(head.body, path).toBe("");
        const names = (response: RawResponse): string[] =>
          Object.keys(response.headers)
            .filter((name) => !volatile.has(name) && name !== "content-length")
            .sort();
        expect(names(head), path).toEqual(names(getResponse));
        for (const name of names(getResponse)) {
          expect(headerValue(head, name), `${path} ${name}`).toBe(headerValue(getResponse, name));
        }
      }
    },
  );
});

describe("TC-STACK-008-106 start-up checks fail closed and nothing listens (exit 1)", () => {
  function run(dir: string): { status: number | null; output: string } {
    const result = spawnSync(
      process.execPath,
      [scriptPath("serve-web-dist.mts"), "--dir", dir, "--port", "0"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 20_000 },
    );
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  function expectRefused(result: { status: number | null; output: string }, line: RegExp): void {
    expect(result.status).toBe(1);
    expect(result.output).toMatch(line);
    expect(result.output).not.toMatch(/^READY /m);
  }

  it("a missing dist directory: ERROR dist-missing", () => {
    const root = tree();
    expectRefused(run(join(root, "no-such-dist")), /^ERROR dist-missing/m);
  });

  it("a missing index.html: ERROR index-missing", () => {
    const root = createTree({ "dist/_headers": expectedHeadersFile() }, "r39x-serve-");
    roots.push(root);
    expectRefused(run(join(root, "dist")), /^ERROR index-missing/m);
  });

  it("a missing _headers: ERROR headers-missing", () => {
    const root = createTree({ "dist/index.html": INDEX_HTML }, "r39x-serve-");
    roots.push(root);
    expectRefused(run(join(root, "dist")), /^ERROR headers-missing/m);
  });

  it.each([
    ["header removal with !", ["/*", "  X-A: b", "  ! X-B"], 3],
    ["a placeholder in a path", ["# c", "/*", "  X-A: b", "", "/:id", "  X-B: c"], 5],
    ["an absolute URL as a path", ["https://example.com/*", "  X-A: b"], 1],
    ["a wildcard in the middle of a path", ["/*", "  X-A: b", "/a/*/b", "  X-B: c"], 3],
  ] as const)(
    "an unsupported _headers syntax (%s): ERROR headers-invalid line=<n>",
    (_name, lines, at) => {
      const root = tree({ "dist/_headers": `${lines.join("\n")}\n` });
      expectRefused(run(join(root, "dist")), new RegExp(`^ERROR headers-invalid line=${at}$`, "m"));
    },
  );

  it("a port that is already in use: ERROR listen <code>", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    const root = tree();
    const result = spawnSync(
      process.execPath,
      [scriptPath("serve-web-dist.mts"), "--dir", join(root, "dist"), "--port", String(port)],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 20_000 },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/^ERROR listen EADDRINUSE/m);
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/^READY /m);
  });
});

describe("TC-STACK-008-107 CLI errors are USAGE (exit 2) and request data is never logged", () => {
  function usage(args: readonly string[]): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [scriptPath("serve-web-dist.mts"), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 20_000,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  it.each([
    [["--bogus"]],
    [["--port", "abc"]],
    [["--port", "70000"]],
    [["--port", "-1"]],
    [["--port"]],
    [["--dir"]],
    [["--host"]],
    [["unexpected-positional"]],
  ] as const)("%j: exit 2 with a USAGE line", (args) => {
    const result = usage(args);
    expect(result.status, args.join(" ")).toBe(2);
    expect(result.output).toMatch(/USAGE/);
    expect(result.output).not.toMatch(/^READY /m);
  });

  it("prints READY with the actual port for --port 0 and the host", SERVER_TIMEOUT, async () => {
    const { server } = await serve();
    expect(server.port).toBeGreaterThan(0);
    expect(server.output()).toMatch(
      new RegExp(`^READY http://127\\.0\\.0\\.1:${server.port}$`, "m"),
    );
  });

  it(
    "does not write the URL, the query or a header of a request to stdout or stderr",
    SERVER_TIMEOUT,
    async () => {
      const { server } = await serve();
      await rawRequest(server.port, "GET", "/?secret=sentinel-9f3a");
      await rawRequest(server.port, "GET", "/mypage/sentinel-path-77c2?token=sentinel-query-31d8", {
        headers: { "X-Sentinel": "sentinel-header-2b8d", Cookie: "sid=sentinel-cookie-5e10" },
      });
      await rawRequest(server.port, "GET", "/assets/missing-sentinel-8a44.js");
      await rawRequest(server.port, "POST", "/sentinel-post-6c02");
      const output = server.output();
      for (const sentinel of [
        "sentinel-9f3a",
        "sentinel-path-77c2",
        "sentinel-query-31d8",
        "sentinel-header-2b8d",
        "sentinel-cookie-5e10",
        "sentinel-8a44",
        "sentinel-post-6c02",
      ]) {
        expect(output, sentinel).not.toContain(sentinel);
      }
    },
  );
});
