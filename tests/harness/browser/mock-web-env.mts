// Test harness only (DEV-REP-004): the child environment that the Playwright webServer launcher
// (tests/harness/browser/start-mock-web.mjs) gives to the web build and to the static server.
// Contract: tests/contracts/s3-layout.md section 10 / 13.3, tests/contracts/s9-finalize.md section 4 (TC-DEV-WEB-011-208).
//
//   mockWebEnv(parent) returns a NEW object (the parent is never changed) that
//   - keeps every other variable of the parent that has a value (PATH and the like);
//   - sets VITE_UI_MOCK to "1";
//   - sets APP_ENV to "test" whatever the parent has (production, staging, development or nothing): the suite fixes its
//     own environment name and never inherits one (SPEC-180 section 8.1: automated tests belong to `test`);
//   - removes NODE_ENV, SPONSOR_IMAGE_ALLOWED_ORIGINS and the former VERCEL_ENV / NEXT_PUBLIC_UI_MOCK.
//
// Loaded under plain `node` by the .mjs launcher (type stripping) and imported by the unit tests:
// erasable TypeScript syntax only, node: built-ins only.
const REMOVED = [
  "NODE_ENV",
  "SPONSOR_IMAGE_ALLOWED_ORIGINS",
  "VERCEL_ENV",
  "NEXT_PUBLIC_UI_MOCK",
] as const;

export function mockWebEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined) env[name] = value;
  }
  for (const name of REMOVED) delete env[name];
  env.VITE_UI_MOCK = "1";
  env.APP_ENV = "test";
  return env;
}
