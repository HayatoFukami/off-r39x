// DEV-WEB-011: UI mock mode is opt-in and must never ship in a production deployment.
type Env = Readonly<Record<string, string | undefined>>;

export function isUiMockEnabled(env: Env): boolean {
  return env.NEXT_PUBLIC_UI_MOCK === "1";
}

export function assertUiMockNotInProductionBuild(env: Env): void {
  if (isUiMockEnabled(env) && env.VERCEL_ENV === "production") {
    throw new Error("UI mock mode must not be enabled in a production build");
  }
}

/** DEV-WEB-012: the /dev/* area exists only while mock mode is on and never in a production deployment. */
export function isDevAreaEnabled(env: Env): boolean {
  return isUiMockEnabled(env) && env.VERCEL_ENV !== "production";
}
