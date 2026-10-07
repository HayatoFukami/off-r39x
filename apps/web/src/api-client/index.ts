import { resolveBrowserStorage, type StorageLike } from "../config/browser-storage";
import { isUiMockEnabled } from "../config/ui-mock";
import { systemClock } from "../mock/backend/clock";
import { uuidIdGenerator } from "../mock/backend/ids";
import { defaultSleep } from "../mock/backend/latency";
import { createMockApi } from "../mock/backend/mock-api";
import type { ApiPort } from "./port";

export type PortFactoryOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  storage?: StorageLike;
};

/**
 * Selects the ApiPort implementation. Only the mock exists today: any other configuration fails
 * closed instead of silently falling back to the mock (DEV-WEB-011).
 */
export function createApiPort(options: PortFactoryOptions = {}): ApiPort {
  // A direct property access lets Next inline NEXT_PUBLIC_UI_MOCK into the client bundle.
  const env = options.env ?? { NEXT_PUBLIC_UI_MOCK: process.env.NEXT_PUBLIC_UI_MOCK };
  if (!isUiMockEnabled(env)) {
    throw new Error("real api client not implemented");
  }
  return createMockApi({
    storage: options.storage ?? resolveBrowserStorage(),
    clock: systemClock,
    sleep: defaultSleep,
    idGenerator: uuidIdGenerator,
  });
}
