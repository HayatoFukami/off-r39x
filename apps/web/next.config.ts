import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { assertUiMockNotInProductionBuild } from "./src/config/ui-mock.ts";

const noStore = [
  { key: "Cache-Control", value: "no-store, private, max-age=0" },
  { key: "Pragma", value: "no-cache" },
];

export default function config(phase: string): NextConfig {
  // DEV-WEB-011: the dev server defaults to mock mode; builds only when set explicitly.
  process.env.NEXT_PUBLIC_UI_MOCK ??= phase === PHASE_DEVELOPMENT_SERVER ? "1" : "0";
  assertUiMockNotInProductionBuild(process.env);
  return {
    transpilePackages: ["@off-r39x/domain"],
    async headers() {
      // SEC-WEB-009
      return ["/mypage/:path*", "/purchase/:path*", "/account/:path*"].map((source) => ({
        source,
        headers: noStore,
      }));
    },
  };
}
