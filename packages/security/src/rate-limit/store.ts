// DEV-RLM-001: the store port. Implementations (the Redis adapter, test doubles) must report every
// failure by throwing; the limiter never continues after a throw (SEC-ABU-019).

/**
 * admit: all rules must have room, then all are recorded; on any excess nothing is recorded.
 * check: read-only (Authentication-failure guard confirmation, SEC-ABU-021 (1)).
 * record: unconditional record (Authentication-failure guard, SEC-ABU-021 (3)).
 */
export type StoreMode = "admit" | "check" | "record";

export interface StoreRule {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}
export interface StoreRuleOutcome {
  readonly exceeded: boolean;
  /** Milliseconds until the rule admits again; 0 when not exceeded. */
  readonly retryAfterMs: number;
}
export interface StoreOutcome {
  readonly allowed: boolean;
  readonly rules: readonly StoreRuleOutcome[];
}
export interface RateLimitStore {
  /** One atomic evaluation. `requestId` makes each recorded member unique. */
  evaluate(mode: StoreMode, rules: readonly StoreRule[], requestId: string): Promise<StoreOutcome>;
  /** INF-HLT-004: connection and script execution. Throws when the store cannot be used. */
  assertReady(): Promise<void>;
  close(): Promise<void>;
}

export class RateLimitStoreError extends Error {
  constructor(readonly kind: "timeout" | "error") {
    super(kind === "timeout" ? "Rate limit store deadline exceeded" : "Rate limit store failure");
    this.name = "RateLimitStoreError";
  }
}
