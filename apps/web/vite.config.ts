// Vite configuration of the static SPA (SPEC-010 8.1.1, DEV-WEB-001). Output: apps/web/dist.
// DEV-WEB-011: the UI mock is selected only by VITE_UI_MOCK=1, the dev server defaults to it, and a build or
// dev server for APP_ENV=production with the flag on is refused. Loaded under plain node by tests (type stripping):
// erasable TypeScript syntax only, and ./src/config/ui-mock.ts is imported with its extension.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { assertUiMockNotInProductionBuild } from "./src/config/ui-mock.ts";

const webDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode }) => {
  // process.env wins over the .env files, the same order Vite itself uses.
  const fileEnv = loadEnv(mode, webDir, "");
  const read = (name: string): string | undefined => process.env[name] ?? fileEnv[name];

  // The dev server defaults to mock mode; a build enables it only when set explicitly.
  if (command === "serve" && read("VITE_UI_MOCK") === undefined) {
    process.env.VITE_UI_MOCK = "1";
  }
  const appEnv = read("APP_ENV");
  assertUiMockNotInProductionBuild({ VITE_UI_MOCK: read("VITE_UI_MOCK"), APP_ENV: appEnv });

  return {
    plugins: [react()],
    resolve: { alias: { "@": resolve(webDir, "src") } },
    // The environment name is public configuration, not a Secret (SPEC-180 13.1).
    define: { "import.meta.env.APP_ENV": JSON.stringify(appEnv ?? "") },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // SEC-WEB-011: no public source map.
      sourcemap: false,
    },
  };
});
