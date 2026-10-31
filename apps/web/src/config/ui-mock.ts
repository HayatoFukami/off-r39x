// DEV-WEB-011: UI mock mode is opt-in (VITE_UI_MOCK=1) and fails closed: a build or dev server with the flag on is
// accepted only when APP_ENV is exactly development, staging or test (the non-production names of INF-ENV-001).
// An unset, empty, differently cased, padded, aliased or production value is refused, and the message never echoes it.
// Using APP_ENV for the static Web build is this repository's choice under DEV-AI-003; SPEC-180 section 9 lists it as a
// variable of server processes, not of the Web build.
// Pure on purpose: apps/web/vite.config.ts imports this file under plain node, so it must not import build-env.ts.
type Env = Readonly<Record<string, string | undefined>>;

export function isUiMockEnabled(env: Env): boolean {
  return env.VITE_UI_MOCK === "1";
}

/** INF-ENV-001: exact match (case-sensitive, not trimmed, no alias) with a non-production Environment name. */
export function isUiMockAppEnv(value: string | undefined): boolean {
  return value === "development" || value === "staging" || value === "test";
}

export function assertUiMockNotInProductionBuild(env: Env): void {
  if (!isUiMockEnabled(env) || isUiMockAppEnv(env.APP_ENV)) return;
  if (env.APP_ENV === "production") {
    throw new Error("UI mock mode must not be enabled in a production build (APP_ENV=production)");
  }
  if (env.APP_ENV === undefined) {
    throw new Error(
      "UI mock mode requires APP_ENV to be development, staging or test (APP_ENV is unset)",
    );
  }
  throw new Error(
    "UI mock mode requires APP_ENV to be development, staging or test (APP_ENV is not one of them)",
  );
}

/** DEV-WEB-012: the /dev/* area exists only while mock mode is on and APP_ENV is an allowed non-production name. */
export function isDevAreaEnabled(env: Env): boolean {
  return isUiMockEnabled(env) && isUiMockAppEnv(env.APP_ENV);
}
