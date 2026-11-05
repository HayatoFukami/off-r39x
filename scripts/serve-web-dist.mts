// Local static server for apps/web/dist (SPEC-180 13.1, SPEC-140 22, SEC-WEB-009, DEV-WEB-001). It stands in for
// the static host in development and E2E: it applies dist/_headers per path, answers the SPA shell (200) for an
// unknown extension-less path and a non-HTML 404 for a missing asset. It is not a deployment target and adds no
// Cache-Control of its own. Nothing about a request (URL, query, headers) is ever written to stdout / stderr.
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/serve-web-dist.mts [--dir <path>] [--port <0-65535>] [--host <host>]
// Exit codes: 0 after SIGINT / SIGTERM, 1 start-up check or listen failure, 2 usage error.
import { existsSync, readFileSync, statSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "USAGE node scripts/serve-web-dist.mts [--dir <path>] [--port <0-65535>] [--host <host>]";
const DEFAULT_PORT = 3100;
const DEFAULT_HOST = "127.0.0.1";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const FALLBACK_TYPE = "application/octet-stream";
const TEXT_TYPE = "text/plain; charset=utf-8";

// ---- CLI ------------------------------------------------------------------------------------

interface Options {
  readonly dir: string;
  readonly port: number;
  readonly host: string;
}

class CliExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super("exit");
    this.code = code;
  }
}

function runCli(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    process.exitCode = error.code;
  }
}

function fail(message: string, code: number): never {
  writeSync(2, `${message}\n`);
  throw new CliExit(code);
}

function parseArgs(argv: readonly string[]): Options {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "dist");
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--dir" && arg !== "--port" && arg !== "--host") fail(USAGE, 2);
    const value = argv[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) fail(USAGE, 2);
    i += 1;
    if (arg === "--dir") {
      dir = resolve(value);
    } else if (arg === "--host") {
      host = value;
    } else {
      if (!/^\d+$/.test(value)) fail(USAGE, 2);
      port = Number(value);
      if (port > 65535) fail(USAGE, 2);
    }
  }
  return { dir, port, host };
}

// ---- dist/_headers ------------------------------------------------------------------------------

interface Rule {
  readonly path: string;
  readonly headers: readonly (readonly [string, string])[];
}

/** `/*` (every path), `<prefix>/*` (below the prefix) or an exact path. No placeholder, no other wildcard. */
function isSupportedRulePath(path: string): boolean {
  if (!path.startsWith("/") || /[\s:]/.test(path)) return false;
  const star = path.indexOf("*");
  return star < 0 || (star === path.length - 1 && (path === "/*" || path.endsWith("/*")));
}

/**
 * The syntax that scripts/generate-web-headers.mts writes: `#` comment lines, blank lines, path lines and
 * header lines indented by two or more spaces. Header removal (`! Name`), placeholders, wildcards inside a path
 * and absolute URLs are refused instead of being half understood (fail closed).
 */
function parseHeaders(text: string): Rule[] {
  const rules: { path: string; headers: [string, string][] }[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || line.startsWith("#")) continue;
    const invalid = `ERROR headers-invalid line=${index + 1}`;
    if (line.startsWith("  ")) {
      const current = rules[rules.length - 1];
      const match = /^ {2,}([A-Za-z][A-Za-z0-9-]*):[ \t]*(\S.*?)[ \t]*$/.exec(line);
      const value = match?.[2] ?? "";
      // Only visible ASCII and tab: anything else would make the HTTP layer throw later.
      if (current === undefined || match === null || !/^[\t\x20-\x7e]*$/.test(value)) {
        fail(invalid, 1);
      }
      current.headers.push([match[1] ?? "", value]);
      continue;
    }
    const path = line.trimEnd();
    if (!isSupportedRulePath(path)) fail(invalid, 1);
    rules.push({ path, headers: [] });
  }
  return rules;
}

function ruleMatches(rulePath: string, pathname: string): boolean {
  if (rulePath === "/*") return true;
  // `/mypage/*` covers what is below `/mypage/`; the prefix itself has its own `/mypage` rule.
  if (rulePath.endsWith("/*")) return pathname.startsWith(rulePath.slice(0, -1));
  return pathname === rulePath;
}

/** Every matching rule contributes in file order; the same header of several rules is joined with ", " (Pages does the same). */
function headersFor(rules: readonly Rule[], pathname: string): Map<string, string> {
  const joined = new Map<string, { name: string; values: string[] }>();
  for (const rule of rules) {
    if (!ruleMatches(rule.path, pathname)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      const entry = joined.get(key);
      if (entry === undefined) joined.set(key, { name, values: [value] });
      else entry.values.push(value);
    }
  }
  return new Map([...joined.values()].map((entry) => [entry.name, entry.values.join(", ")]));
}

// ---- request handling ---------------------------------------------------------------------------

type Resolved =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "shell" }
  | { readonly kind: "not-found" }
  | { readonly kind: "bad-request" };

const RESERVED_FILES = new Set(["_headers", "_redirects"]);

/** Maps the raw request path to a file inside `dir`, the SPA shell, or a refusal. Never leaves `dir`. */
function resolveRequest(dir: string, rawPath: string): Resolved {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { kind: "bad-request" };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { kind: "not-found" };
  const segments = decoded.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    // Dot segments and dotfiles; characters and endings that Windows resolves to another name.
    if (segment.startsWith(".") || /[<>:"|?*\p{Cc}]|[. ]$/u.test(segment)) {
      return { kind: "not-found" };
    }
  }
  if (segments.length === 1 && RESERVED_FILES.has((segments[0] ?? "").toLowerCase())) {
    return { kind: "not-found" };
  }
  const target = resolve(dir, ...segments);
  if (target !== dir && !target.startsWith(dir + sep)) return { kind: "not-found" };
  try {
    if (statSync(target).isFile()) return { kind: "file", path: target };
  } catch {
    // not an existing path: fall through
  }
  // A last segment without "." is an application URL (or a directory name): the SPA shell. With "." it is an asset.
  const last = segments[segments.length - 1] ?? "";
  return last.includes(".") ? { kind: "not-found" } : { kind: "shell" };
}

function startServer(options: Options, rules: readonly Rule[]): void {
  const dir = options.dir;

  function send(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    type: string,
    body: Buffer,
    extra: Readonly<Record<string, string>> = {},
  ): void {
    // Matching uses the path as sent, before decoding.
    const pathname = (req.url ?? "/").split(/[?#]/, 1)[0] ?? "/";
    for (const [name, value] of headersFor(rules, pathname)) res.setHeader(name, value);
    for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(body.length));
    res.statusCode = status;
    res.end(req.method === "HEAD" ? undefined : body);
  }

  const text = (req: IncomingMessage, res: ServerResponse, status: number, message: string): void =>
    send(req, res, status, TEXT_TYPE, Buffer.from(message, "utf8"));

  function respond(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(req, res, 405, TEXT_TYPE, Buffer.from("Method Not Allowed", "utf8"), {
        Allow: "GET, HEAD",
      });
      return;
    }
    const rawPath = (req.url ?? "").split(/[?#]/, 1)[0] ?? "";
    const resolved = rawPath.startsWith("/")
      ? resolveRequest(dir, rawPath)
      : ({ kind: "bad-request" } as const);
    if (resolved.kind === "bad-request") {
      text(req, res, 400, "Bad Request");
    } else if (resolved.kind === "not-found") {
      text(req, res, 404, "Not Found");
    } else {
      // The shell is read per request so that a rebuild of dist is served without a restart.
      const file = resolved.kind === "shell" ? join(dir, "index.html") : resolved.path;
      let body: Buffer | undefined;
      try {
        body = readFileSync(file);
      } catch {
        body = undefined;
      }
      if (body === undefined) {
        text(req, res, 404, "Not Found");
      } else {
        send(req, res, 200, CONTENT_TYPES[extname(file).toLowerCase()] ?? FALLBACK_TYPE, body);
      }
    }
  }

  const server = createServer((req, res) => {
    try {
      respond(req, res);
    } catch {
      // Nothing about the request or the error is logged; answer with a fixed body.
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", TEXT_TYPE);
      }
      res.end(req.method === "HEAD" ? undefined : "Internal Server Error");
    }
  });
  server.once("error", (error: NodeJS.ErrnoException) => {
    writeSync(2, `ERROR listen ${error.code ?? "UNKNOWN"}\n`);
    process.exitCode = 1;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : options.port;
    const host = options.host.includes(":") ? `[${options.host}]` : options.host;
    process.stdout.write(`READY http://${host}:${port}\n`);
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const dir = options.dir;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail("ERROR dist-missing", 1);
  if (!existsSync(join(dir, "index.html"))) fail("ERROR index-missing", 1);
  if (!existsSync(join(dir, "_headers"))) fail("ERROR headers-missing", 1);
  const rules = parseHeaders(readFileSync(join(dir, "_headers"), "utf8"));
  startServer(options, rules);
}

runCli(main);
