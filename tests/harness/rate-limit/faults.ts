import { type RateLimitStore, RateLimitStoreError } from "../../../packages/security/src/index.ts";

/** FP.RATELIMIT.* (SPEC-170 TST-FLT-002): DI-only fault injection around a RateLimitStore. */
export type RateLimitFaultPoint =
  | "FP.RATELIMIT.STORE_UNAVAILABLE"
  | "FP.RATELIMIT.STORE_TIMEOUT"
  | "FP.RATELIMIT.STORE_MEMORY_FULL"
  | "FP.RATELIMIT.SCRIPT_ERROR";

export interface FaultyStore extends RateLimitStore {
  /** Calls that reached the store while a fault was active. */
  readonly faultedCalls: number;
  inject(point: RateLimitFaultPoint | undefined): void;
}
export function withFault(base: RateLimitStore): FaultyStore {
  let active: RateLimitFaultPoint | undefined;
  let faultedCalls = 0;
  const fail = async (): Promise<never> => {
    faultedCalls += 1;
    if (active === "FP.RATELIMIT.STORE_TIMEOUT") return new Promise<never>(() => {});
    throw new RateLimitStoreError("error");
  };
  return {
    get faultedCalls() {
      return faultedCalls;
    },
    inject(point) {
      active = point;
    },
    evaluate: (mode, rules, requestId) => (active ? fail() : base.evaluate(mode, rules, requestId)),
    assertReady: () => (active ? fail() : base.assertReady()),
    close: () => base.close(),
  };
}
