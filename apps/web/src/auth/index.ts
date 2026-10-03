import type { PortFactoryOptions } from "../api-client";
import { resolveBrowserStorage } from "../config/browser-storage";
import { isUiMockEnabled } from "../config/ui-mock";
import { systemClock } from "../mock/backend/clock";
import { uuidIdGenerator } from "../mock/backend/ids";
import { createMockAuth } from "../mock/backend/mock-auth";
import type { AuthPort } from "./port";

export type { PortFactoryOptions };

/** Fails closed unless mock mode is enabled (DEV-WEB-011). Shares storage with createApiPort. */
export function createAuthPort(options: PortFactoryOptions = {}): AuthPort {
  const env = options.env ?? { NEXT_PUBLIC_UI_MOCK: process.env.NEXT_PUBLIC_UI_MOCK };
  if (!isUiMockEnabled(env)) {
    throw new Error("real auth client not implemented");
  }
  return createMockAuth({
    storage: options.storage ?? resolveBrowserStorage(),
    clock: systemClock,
    idGenerator: uuidIdGenerator,
  });
}
