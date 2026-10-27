// The only module that reads import.meta.env (DEV-WEB-011). Vite replaces the property accesses below with
// literals at build time, so each variable is referenced directly instead of through a spread or a loop.
// VITE_UI_MOCK is exposed by Vite's VITE_ prefix; APP_ENV is injected by `define` in vite.config.ts. Neither is a Secret.
declare global {
  interface ImportMetaEnv {
    readonly VITE_UI_MOCK?: string;
    readonly APP_ENV?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export type BuildEnv = {
  readonly VITE_UI_MOCK: string | undefined;
  readonly APP_ENV: string | undefined;
};

export function readBuildEnv(): BuildEnv {
  return {
    VITE_UI_MOCK: import.meta.env.VITE_UI_MOCK,
    APP_ENV: import.meta.env.APP_ENV,
  };
}
