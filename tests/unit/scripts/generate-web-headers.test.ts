import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTree,
  type FileMap,
  findingsOf,
  type RunResult,
  removeTree,
  runScript,
} from "../../harness/script-fixtures.ts";
import { expectedHeadersFile, INDEX_HTML, sha256Source } from "../../harness/web-dist.ts";

// scripts/generate-web-headers.mts: writes apps/web/dist/_headers from the built HTML (SPEC-140 21 / 22 / 22.1,
// SEC-WEB-003..009, SEC-WEB-026, SPEC-180 13.1 / 13.2). Contract: tests/contracts/s9-finalize.md section 8.
// Every case runs the real script as a child process against a synthetic dist directory.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

// Inline script bodies. Their hashes all start with a lower-case letter, so the plain code-unit order and a
// case-insensitive "dictionary" order give the same sequence (the order is not what these cases are about).
const BODY_A = "window.__r39xA = 1;";
const BODY_B = "window.__r39xB = 2;";
const BODY_C = "window.__r39xC = 3;";

const shell = (...scripts: string[]): string =>
  `<!doctype html>\n<html lang="ja"><head><meta charset="UTF-8"></head><body><div id="root"></div>${scripts.join("")}<script type="module" src="/assets/app.js"></script></body></html>\n`;
const inline = (body: string): string => `<script>${body}</script>`;

function makeDist(files: FileMap = { "dist/index.html": INDEX_HTML }): string {
  const root = createTree(files, "r39x-headers-");
  roots.push(root);
  return join(root, "dist");
}

function generate(
  dist: string,
  options: { origins?: string | undefined; args?: readonly string[] } = {},
): RunResult {
  return runScript("generate-web-headers.mts", ["--dist", dist, ...(options.args ?? [])], {
    env: { SPONSOR_IMAGE_ALLOWED_ORIGINS: options.origins },
  });
}

const read = (dist: string): string => readFileSync(join(dist, "_headers"), "utf8");

function directive(headers: string, name: string): string {
  const csp = /^ {2}Content-Security-Policy: (.*)$/m.exec(headers)?.[1] ?? "";
  return csp.split("; ").find((part) => part === name || part.startsWith(`${name} `)) ?? "";
}

describe("TC-STACK-008-201 the generated _headers is exactly the specified file (SEC-WEB-003..009, SPEC-140 21 / 22 / 22.1)", () => {
  it("without inline scripts or origins it matches the v2 content character for character", () => {
    const dist = makeDist();
    const result = generate(dist);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 img-origins=0$/m);
    expect(read(dist)).toBe(expectedHeadersFile());
  });

  it("orders the rules /* then the twelve protected rules, each with no-store, Pragma and no-referrer", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    const paths = headers.split("\n").filter((line) => line.startsWith("/"));
    expect(paths).toEqual([
      "/*",
      "/account",
      "/account/*",
      "/auth",
      "/auth/*",
      "/purchase",
      "/purchase/*",
      "/mypage",
      "/mypage/*",
      "/admin",
      "/admin/*",
      "/staff",
      "/staff/*",
    ]);
    expect(
      (headers.match(/^ {2}Cache-Control: no-store, private, max-age=0$/gm) ?? []).length,
    ).toBe(12);
    expect((headers.match(/^ {2}Pragma: no-cache$/gm) ?? []).length).toBe(12);
    expect((headers.match(/^ {2}Referrer-Policy: no-referrer$/gm) ?? []).length).toBe(12);
  });

  it("carries the six non-CSP security headers once, on the /* rule only, with the specified values", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    for (const line of [
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      "  X-Frame-Options: DENY",
      "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
      "  Cross-Origin-Opener-Policy: same-origin",
      "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    ]) {
      expect(
        headers.split("\n").filter((l) => l === line),
        line,
      ).toHaveLength(1);
    }
    const base = headers.slice(0, headers.indexOf("\n/account\n"));
    expect(base).toContain("X-Frame-Options: DENY");
    expect(base).toContain("Strict-Transport-Security: max-age=63072000; includeSubDomains");
    expect(base).not.toContain("Cache-Control");
  });

  it("keeps the CSP directives of the baseline and no placeholder", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    expect(directive(headers, "script-src")).toBe("script-src 'self'");
    expect(directive(headers, "script-src-attr")).toBe("script-src-attr 'none'");
    expect(directive(headers, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(headers, "connect-src")).toBe("connect-src 'self'");
    expect(directive(headers, "frame-src")).toBe("frame-src 'none'");
    expect(directive(headers, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(headers, "object-src")).toBe("object-src 'none'");
    expect(directive(headers, "base-uri")).toBe("base-uri 'none'");
    expect(directive(headers, "default-src")).toBe("default-src 'self'");
    expect(headers).toContain("; upgrade-insecure-requests\n");
    expect(headers).not.toMatch(/[{}<>]|placeholder|PLACEHOLDER|TODO/);
  });

  it("uses LF line endings and ends with exactly one newline", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    expect(headers).not.toContain("\r");
    expect(headers.endsWith("\n")).toBe(true);
    expect(headers.endsWith("\n\n")).toBe(false);
  });

  it("is deterministic: a second run produces the same file", () => {
    const dist = makeDist();
    generate(dist);
    const first = read(dist);
    generate(dist);
    expect(read(dist)).toBe(first);
  });
});

describe("TC-STACK-008-202 inline script hashes come from the built HTML (SEC-WEB-003)", () => {
  it("hashes every src-less script, once, in order, and never a script with a src", () => {
    const dist = makeDist({
      "dist/index.html": shell(inline(BODY_A), inline(BODY_B)),
      "dist/guide/index.html": shell(inline(BODY_A), inline(BODY_C)),
    });
    const result = generate(dist);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=3 img-origins=0$/m);
    const hashes = [...new Set([BODY_A, BODY_B, BODY_C].map(sha256Source))].sort();
    expect(hashes).toHaveLength(3);
    expect(directive(read(dist), "script-src")).toBe(
      `script-src 'self' ${hashes.map((h) => `'${h}'`).join(" ")}`,
    );
    expect(read(dist)).toBe(expectedHeadersFile({ hashes }));
  });

  it("hashes the exact text between the tags, whitespace included", () => {
    const body = `\n  ${BODY_A}\n`;
    const dist = makeDist({ "dist/index.html": shell(inline(body)) });
    generate(dist);
    expect(directive(read(dist), "script-src")).toBe(`script-src 'self' '${sha256Source(body)}'`);
  });

  it("does not hash a script that has a src, with or without other attributes", () => {
    const dist = makeDist({
      "dist/index.html": shell('<script type="module" crossorigin src="/assets/x.js"></script>'),
    });
    const result = generate(dist);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 /m);
    expect(directive(read(dist), "script-src")).toBe("script-src 'self'");
  });
});

describe("TC-STACK-008-203 Sponsor image origins go to img-src only (SEC-WEB-026, SPEC-180 13.2)", () => {
  const input = JSON.stringify([
    "https://Logo.Example.com",
    "https://cdn.example.org:443/",
    "https://logo.example.com",
  ]);

  it("normalises, de-duplicates and keeps the input order", () => {
    const dist = makeDist();
    const result = generate(dist, { origins: input });
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 img-origins=2$/m);
    expect(directive(read(dist), "img-src")).toBe(
      "img-src 'self' data: blob: https://logo.example.com https://cdn.example.org",
    );
  });

  it("puts no origin in any other directive (the rest of the file is unchanged)", () => {
    const dist = makeDist();
    generate(dist, { origins: input });
    expect(read(dist)).toBe(
      expectedHeadersFile({ imgOrigins: ["https://logo.example.com", "https://cdn.example.org"] }),
    );
    const headers = read(dist);
    for (const name of ["default-src", "script-src", "connect-src", "frame-src", "font-src"]) {
      expect(directive(headers, name), name).not.toContain("example");
    }
  });

  it("lower-cases and punycode-encodes the host", () => {
    const dist = makeDist();
    generate(dist, { origins: JSON.stringify(["https://Bücher.example.org"]) });
    expect(directive(read(dist), "img-src")).toBe(
      "img-src 'self' data: blob: https://xn--bcher-kva.example.org",
    );
  });

  it.each([
    ["an empty array", "[]"],
    ["an unset variable", undefined],
    ["an empty string", ""],
  ])("%s leaves no origin and no placeholder", (_name, origins) => {
    const dist = makeDist();
    const result = generate(dist, { origins });
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 img-origins=0$/m);
    expect(read(dist)).toBe(expectedHeadersFile());
  });
});

describe("TC-STACK-008-204 an unsafe Sponsor image origin fails the build without leaking the value (SEC-WEB-004, SEC-WEB-026)", () => {
  const invalidOrigins = [
    "http://logo.example.com",
    "https://*.example.com",
    "https://192.0.2.1",
    "https://[2001:db8::1]",
    "https://localhost",
    "https://x.local",
    "https://example.com:8443",
    "https://example.com/path",
    "https://example.com/?q=1",
    "https://example.com/#frag",
    "https://u:p@example.com",
    "not a url",
    "",
  ];

  it.each(invalidOrigins)(
    "rejects the element %j with its index, writes no _headers and prints no value",
    (value) => {
      const dist = makeDist();
      const result = generate(dist, { origins: JSON.stringify(["https://ok.example.com", value]) });
      expect(result.status).toBe(1);
      expect(result.output).toMatch(/^ERROR sponsor-image-origin-invalid index=1$/m);
      expect(existsSync(join(dist, "_headers"))).toBe(false);
      if (value !== "") {
        expect(result.output).not.toContain(value);
        expect(result.output).not.toContain(value.replace(/^https?:\/\//, ""));
      }
    },
  );

  it.each([
    ["a value that is not JSON", "https://logo.example.com"],
    ["JSON that is not an array", '{"a":"https://logo.example.com"}'],
    ["a JSON string", '"https://logo.example.com"'],
    ["JSON null", "null"],
    ["an array with a non-string element", "[1]"],
    ["an array with a nested array", '[["https://logo.example.com"]]'],
  ])("rejects %s", (_name, origins) => {
    const dist = makeDist();
    const result = generate(dist, { origins });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR sponsor-image-origin-invalid/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);
    expect(result.output).not.toContain("logo.example.com");
  });

  it("leaves an existing _headers untouched when the origins are invalid", () => {
    const dist = makeDist({
      "dist/index.html": INDEX_HTML,
      "dist/_headers": "STALE-SENTINEL\n",
    });
    const result = generate(dist, { origins: '["http://logo.example.com"]' });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR sponsor-image-origin-invalid index=0$/m);
    expect(read(dist)).toBe("STALE-SENTINEL\n");
  });
});

describe("TC-STACK-008-205 the CSP never allows inline code and inline handlers are refused (SEC-WEB-003)", () => {
  it("never puts unsafe-inline or unsafe-eval in script-src, whatever the input", () => {
    const cases: [FileMap, string | undefined][] = [
      [{ "dist/index.html": INDEX_HTML }, undefined],
      [{ "dist/index.html": shell(inline(BODY_A), inline(BODY_B)) }, undefined],
      [{ "dist/index.html": INDEX_HTML }, JSON.stringify(["https://logo.example.com"])],
    ];
    for (const [files, origins] of cases) {
      const dist = makeDist(files);
      expect(generate(dist, { origins }).status).toBe(0);
      const scriptSrc = directive(read(dist), "script-src");
      expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(directive(read(dist), "script-src-attr")).toBe("script-src-attr 'none'");
    }
  });

  it.each([
    ["an onclick attribute", '<button onclick="go()">x</button>'],
    ["an onerror attribute without quotes", "<img src=x onerror=go()>"],
    ["an uppercase handler attribute", '<a ONLOAD="go()">x</a>'],
    ["a javascript: URL", '<a href="javascript:void(0)">x</a>'],
  ])("fails with ERROR inline-handler for %s and writes nothing", (_name, markup) => {
    const dist = makeDist({
      "dist/index.html": INDEX_HTML,
      "dist/guide/index.html": `<!doctype html><html><body>${markup}</body></html>\n`,
    });
    const result = generate(dist);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR inline-handler guide\/index\.html$/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);
  });
});

describe("TC-STACK-008-206 --check compares against the file on disk without writing", () => {
  it("exits 0 for a matching file and leaves it byte for byte unchanged", () => {
    const dist = makeDist({ "dist/index.html": shell(inline(BODY_A)) });
    generate(dist);
    const before = read(dist);
    const result = generate(dist, { args: ["--check"] });
    expect(result.status, result.output).toBe(0);
    expect(read(dist)).toBe(before);
  });

  it("fails with ERROR headers-stale when one character differs, and does not repair it", () => {
    const dist = makeDist();
    generate(dist);
    const changed = read(dist).replace("X-Frame-Options: DENY", "X-Frame-Options: DENX");
    writeFileSync(join(dist, "_headers"), changed, "utf8");
    const result = generate(dist, { args: ["--check"] });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR headers-stale/m);
    expect(read(dist)).toBe(changed);
  });

  it("fails when an inline script was added after the file was generated (the CSP hash no longer matches)", () => {
    const dist = makeDist();
    generate(dist);
    writeFileSync(join(dist, "index.html"), shell(inline(BODY_B)), "utf8");
    const result = generate(dist, { args: ["--check"] });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR headers-stale/m);
  });

  it("fails when _headers does not exist and does not create it", () => {
    const dist = makeDist();
    const result = generate(dist, { args: ["--check"] });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR headers-stale/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);
  });
});

describe("TC-STACK-008-207 unusable input and CLI errors", () => {
  it("fails with ERROR index-missing when dist has no index.html", () => {
    const dist = makeDist({ "dist/assets/app.js": "export {};\n" });
    const result = generate(dist);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR index-missing/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);
  });

  it("fails with ERROR html-unparsable for an unclosed <script", () => {
    const dist = makeDist({
      "dist/index.html": "<!doctype html><html><body><script>window.x = 1;\n",
    });
    const result = generate(dist);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^ERROR html-unparsable/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);
  });

  it.each([
    [["--bogus"]],
    [["--dist"]],
    [["--dist", "x", "--bogus"]],
    [["unexpected-positional"]],
  ] as const)("%j: exit 2 with a USAGE line", (args) => {
    const result = runScript("generate-web-headers.mts", args);
    expect(result.status).toBe(2);
    expect(result.output).toMatch(/USAGE/);
    expect(findingsOf(result)).toEqual([]);
  });
});
