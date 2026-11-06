import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTree,
  type FileMap,
  findingsOf,
  REPO_ROOT,
  type RunResult,
  removeTree,
  runScript,
} from "../../harness/script-fixtures.ts";
import {
  expectedHeadersFile,
  HASHED_ASSET,
  INDEX_HTML,
  sha256Source,
} from "../../harness/web-dist.ts";

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
  it("without inline scripts, origins or assets it matches the v3 content character for character", () => {
    const dist = makeDist();
    const result = generate(dist);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 img-origins=0$/m);
    expect(read(dist)).toBe(expectedHeadersFile());
  });

  it("writes a single /* rule: no protected-prefix rule, no header removal line, no old Referrer-Policy", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    const paths = headers.split("\n").filter((line) => line.startsWith("/"));
    expect(paths).toEqual(["/*"]);
    expect(headers).not.toContain("strict-origin-when-cross-origin");
    expect(headers).not.toMatch(/^\/(account|auth|purchase|mypage|admin|staff)/m);
    expect(headers).not.toMatch(/^ *!/m);
  });

  it("carries the eight non-CSP headers once, on the /* rule, with the specified values", () => {
    const dist = makeDist();
    generate(dist);
    const headers = read(dist);
    for (const line of [
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: no-referrer",
      "  X-Frame-Options: DENY",
      "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
      "  Cross-Origin-Opener-Policy: same-origin",
      "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
      "  Cache-Control: no-store, private, max-age=0",
      "  Pragma: no-cache",
    ]) {
      expect(
        headers.split("\n").filter((l) => l === line),
        line,
      ).toHaveLength(1);
    }
    expect(
      headers.split("\n").filter((l) => l.startsWith("  Content-Security-Policy: ")),
    ).toHaveLength(1);
    // Every header name appears exactly once in the whole file (a single rule carries them all).
    for (const name of [
      "Referrer-Policy",
      "Cache-Control",
      "Pragma",
      "X-Frame-Options",
      "Strict-Transport-Security",
    ]) {
      expect(
        headers.split("\n").filter((l) => l.startsWith(`  ${name}:`)),
        name,
      ).toHaveLength(1);
    }
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

const hashedBody = (name: string): string => `export const n = ${JSON.stringify(name)};\n`;

describe("TC-STACK-008-208 each content-hashed asset gets an exact-match rule that restores a long cache (SEC-WEB-009, SPEC-140 22, SPEC-180 13.1)", () => {
  const assets = ["index-AbCd1234.js", "index-EfGh_5-8.css", "logo-0123abcd.svg"];
  const files: FileMap = {
    "dist/index.html": INDEX_HTML,
    "dist/assets/index-AbCd1234.js": hashedBody("a"),
    "dist/assets/index-EfGh_5-8.css": "body { margin: 0; }\n",
    "dist/assets/logo-0123abcd.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    "dist/mock/x.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    "dist/favicon.ico": "ico",
  };

  it("matches the v3 file with one rule per asset, in code unit order, and --check agrees", () => {
    for (const name of assets) expect(HASHED_ASSET.test(name), name).toBe(true);
    const dist = makeDist(files);
    const result = generate(dist);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^OK headers inline-scripts=0 img-origins=0$/m);
    const headers = read(dist);
    expect(headers).toBe(expectedHeadersFile({ assets }));
    expect(headers.split("\n").filter((line) => line.startsWith("/"))).toEqual([
      "/*",
      "/assets/index-AbCd1234.js",
      "/assets/index-EfGh_5-8.css",
      "/assets/logo-0123abcd.svg",
    ]);
    const check = generate(dist, { args: ["--check"] });
    expect(check.status, check.output).toBe(0);
    expect(read(dist)).toBe(headers);
  });

  it("writes exactly the three lines ! Cache-Control, ! Pragma and the long cache under each asset rule", () => {
    const dist = makeDist(files);
    generate(dist);
    const lines = read(dist).split("\n");
    for (const name of assets) {
      const at = lines.indexOf(`/assets/${name}`);
      expect(at, name).toBeGreaterThan(0);
      expect(lines.slice(at + 1, at + 5), name).toEqual([
        "  ! Cache-Control",
        "  ! Pragma",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ]);
    }
  });

  it("writes no rule for files outside dist/assets/ (mock/x.svg, favicon.ico, index.html)", () => {
    const dist = makeDist(files);
    generate(dist);
    const headers = read(dist);
    expect(headers).not.toContain("/mock/");
    expect(headers).not.toContain("x.svg");
    expect(headers).not.toContain("favicon");
    expect(headers).not.toContain("/index.html");
    expect(headers.split("\n").filter((line) => line.startsWith("/"))).toHaveLength(4);
  });
});

describe("TC-STACK-008-209 a dist that breaks the header assumptions fails the build and writes nothing (SEC-WEB-009, SPEC-180 13.1, SEC-WEB-003)", () => {
  // Runs generate and --check on the files; both must exit 1 with every expected line. A plain run must not
  // create _headers and must leave an existing _headers byte for byte unchanged.
  function expectBuildFailure(
    files: FileMap,
    errorLines: readonly string[],
    origins?: string,
  ): string {
    const dist = makeDist(files);
    const run = generate(dist, { origins });
    expect(run.status, run.output).toBe(1);
    for (const line of errorLines) expect(run.output).toContain(`${line}\n`);
    expect(existsSync(join(dist, "_headers"))).toBe(false);

    const check = generate(dist, { origins, args: ["--check"] });
    expect(check.status, check.output).toBe(1);
    for (const line of errorLines) expect(check.output).toContain(`${line}\n`);
    expect(check.output).not.toMatch(/^ERROR headers-stale/m);
    expect(existsSync(join(dist, "_headers"))).toBe(false);

    writeFileSync(join(dist, "_headers"), "STALE-SENTINEL\n", "utf8");
    const again = generate(dist, { origins });
    expect(again.status, again.output).toBe(1);
    expect(read(dist)).toBe("STALE-SENTINEL\n");
    return run.output;
  }

  const indexOnly: FileMap = { "dist/index.html": INDEX_HTML };

  it("(1) an unhashed file in dist/assets/: ERROR asset-unhashed <path>", () => {
    expectBuildFailure({ ...indexOnly, "dist/assets/app.js": "export {};\n" }, [
      "ERROR asset-unhashed assets/app.js",
    ]);
  });

  it("(2) a subdirectory of dist/assets/: ERROR asset-unhashed <directory>", () => {
    expectBuildFailure({ ...indexOnly, "dist/assets/sub/x-AbCd1234.js": "export {};\n" }, [
      "ERROR asset-unhashed assets/sub",
    ]);
  });

  it("(3) several violations are all listed, one line each", () => {
    expectBuildFailure(
      { ...indexOnly, "dist/assets/a.js": "export {};\n", "dist/assets/b.css": "a {}\n" },
      ["ERROR asset-unhashed assets/a.js", "ERROR asset-unhashed assets/b.css"],
    );
  });

  it.each([["404.html"], ["guide/404.html"], ["404.HTML"]])(
    "(4) %s anywhere under dist: ERROR html-404-present <path>",
    (path) => {
      expectBuildFailure({ ...indexOnly, [`dist/${path}`]: INDEX_HTML }, [
        `ERROR html-404-present ${path}`,
      ]);
    },
  );

  const assetName = (i: number): string => `chunk${String(i).padStart(3, "0")}-AbCd1234.js`;
  const manyAssets = (count: number): FileMap =>
    Object.fromEntries(
      Array.from({ length: count }, (_unused, i) => [
        `dist/assets/${assetName(i)}`,
        hashedBody(String(i)),
      ]),
    );

  it("(5) 100 hashed assets make 101 rules: ERROR headers-rule-limit rules=101", () => {
    expectBuildFailure({ ...indexOnly, ...manyAssets(100) }, [
      "ERROR headers-rule-limit rules=101",
    ]);
  });

  it("(5) boundary: 99 hashed assets make exactly 100 rules and are accepted", () => {
    const dist = makeDist({ ...indexOnly, ...manyAssets(99) });
    const result = generate(dist);
    expect(result.status, result.output).toBe(0);
    const headers = read(dist);
    expect(headers.split("\n").filter((line) => line.startsWith("/"))).toHaveLength(100);
    expect(headers).toBe(
      expectedHeadersFile({ assets: Array.from({ length: 99 }, (_unused, i) => assetName(i)) }),
    );
    expect(generate(dist, { args: ["--check"] }).status).toBe(0);
  });

  // Sponsor image origins (reserved domain example.com, lower case, labels of 30..63 characters) that make line
  // 3 of the file, the CSP line, exactly `target` characters long. The harness computes the line length itself.
  function originsForCspLine(target: number): string[] {
    const make = (count: number, extra: readonly number[]): string[] =>
      Array.from(
        { length: count },
        (_unused, i) =>
          `https://h${String(i).padStart(2, "0")}${"a".repeat(27 + (extra[i] ?? 0))}.example.com`,
      );
    const lineLength = (origins: readonly string[]): number =>
      (expectedHeadersFile({ imgOrigins: origins }).split("\n")[2] ?? "").length;
    let count = 1;
    while (lineLength(make(count + 1, [])) <= target) count += 1;
    let remainder = target - lineLength(make(count, []));
    const extra: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const add = Math.min(remainder, 33);
      extra.push(add);
      remainder -= add;
    }
    const origins = make(count, extra);
    expect(remainder).toBe(0);
    expect(lineLength(origins)).toBe(target);
    return origins;
  }

  it("(6) a CSP line of 2,001 characters: ERROR headers-line-too-long line=3, without any origin in the output", () => {
    const origins = originsForCspLine(2001);
    const output = expectBuildFailure(
      indexOnly,
      ["ERROR headers-line-too-long line=3"],
      JSON.stringify(origins),
    );
    expect(output).not.toContain("example.com");
    expect(output).not.toMatch(/h00a/);
  });

  it("(6) boundary: a CSP line of exactly 2,000 characters is accepted", () => {
    const origins = originsForCspLine(2000);
    const dist = makeDist(indexOnly);
    const result = generate(dist, { origins: JSON.stringify(origins) });
    expect(result.status, result.output).toBe(0);
    expect(read(dist)).toBe(expectedHeadersFile({ imgOrigins: origins }));
    expect(
      Math.max(
        ...read(dist)
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBe(2000);
  });
});

describe("TC-STACK-008-210 the hash check relies on Vite's default asset naming, which the repository keeps (SEC-WEB-009, DEV-WEB-001, SPEC-180 13.1)", () => {
  it("has no apps/web/public/assets directory, so no fixed-name public file lands in dist/assets/", () => {
    expect(existsSync(join(REPO_ROOT, "apps", "web", "public", "assets"))).toBe(false);
  });

  it("does not set assetsDir, entryFileNames, chunkFileNames or assetFileNames in vite.config.ts", () => {
    const config = readFileSync(join(REPO_ROOT, "apps", "web", "vite.config.ts"), "utf8");
    for (const key of ["assetsDir", "entryFileNames", "chunkFileNames", "assetFileNames"]) {
      expect(config, key).not.toContain(key);
    }
  });
});
