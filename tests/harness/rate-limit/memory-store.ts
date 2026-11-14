import type {
  RateLimitStore,
  StoreMode,
  StoreOutcome,
  StoreRule,
} from "../../../packages/security/src/index.ts";

/**
 * API-layer test double only (SPEC-170 TST-RLM-001): it mirrors the documented sliding window log
 * semantics but proves nothing about Redis atomicity, TTL, memory or the store clock.
 */
export interface MemoryStore extends RateLimitStore {
  readonly calls: { mode: StoreMode; rules: readonly StoreRule[]; requestId: string }[];
  advance(ms: number): void;
  count(key: string): number;
  keys(): string[];
}
export function createMemoryStore(startMs = 1_700_000_000_000): MemoryStore {
  let now = startMs;
  const logs = new Map<string, number[]>();
  const calls: MemoryStore["calls"] = [];
  const live = (key: string, windowMs: number): number[] => {
    const entries = (logs.get(key) ?? []).filter((score) => score > now - windowMs);
    logs.set(key, entries);
    return entries;
  };
  return {
    calls,
    advance: (ms) => {
      now += ms;
    },
    count: (key) => (logs.get(key) ?? []).length,
    keys: () => [...logs.keys()],
    async evaluate(mode, rules, requestId): Promise<StoreOutcome> {
      calls.push({ mode, rules, requestId });
      const outcomes = rules.map((rule) => {
        const entries = live(rule.key, rule.windowMs);
        if (entries.length < rule.limit) return { exceeded: false, retryAfterMs: 0 };
        const pivot = entries[entries.length - rule.limit] ?? now;
        return { exceeded: true, retryAfterMs: pivot + rule.windowMs - now };
      });
      const allowed = outcomes.every((outcome) => !outcome.exceeded);
      if (mode === "record" || (mode === "admit" && allowed))
        for (const rule of rules) {
          const entries = live(rule.key, rule.windowMs);
          entries.push(now);
          logs.set(rule.key, entries);
        }
      return { allowed: mode === "record" ? true : allowed, rules: outcomes };
    },
    async assertReady() {},
    async close() {},
  };
}
