// DEV-RLM-002: the only module that imports a Redis client. Every failure is reported by throwing a
// value-free RateLimitStoreError; no command is ever re-sent for the same evaluation.
import { DeadlineError, TIMEOUTS, withDeadline } from "@off-r39x/reliability";
import {
  type RateLimitStore,
  RateLimitStoreError,
  type StoreMode,
  type StoreOutcome,
  type StoreRule,
} from "@off-r39x/security";
import { Redis } from "ioredis";
import { loadRateLimitScript, type RateLimitScript } from "./script.ts";

export interface RedisRateLimitStoreOptions {
  /** `redis://` or `rediss://` URL (RATE_LIMIT_REDIS_URL). Never logged. */
  readonly url: string;
  /** Defaults to the 250 ms of REL-SEC-003. */
  readonly deadlineMs?: number;
}

function parseOutcome(reply: unknown, rules: number): StoreOutcome {
  if (!Array.isArray(reply) || reply.length !== 1 + 2 * rules)
    throw new RateLimitStoreError("error");
  const numbers = reply.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new RateLimitStoreError("error");
    return value;
  });
  return {
    allowed: numbers[0] === 1,
    rules: Array.from({ length: rules }, (_, i) => ({
      exceeded: numbers[1 + 2 * i] === 1,
      retryAfterMs: numbers[2 + 2 * i] ?? 0,
    })),
  };
}

export function createRedisRateLimitStore(options: RedisRateLimitStoreOptions): RateLimitStore {
  let protocol: string;
  try {
    protocol = new URL(options.url).protocol;
  } catch {
    throw new Error("Invalid rate limit store configuration");
  }
  if (protocol !== "redis:" && protocol !== "rediss:")
    throw new Error("Invalid rate limit store configuration");
  const deadlineMs = options.deadlineMs ?? TIMEOUTS.rateLimitStoreMs;
  const script: RateLimitScript = loadRateLimitScript();
  const client = new Redis(options.url, {
    // Fail immediately instead of queueing while disconnected; never replay a command after a
    // reconnect (a replay could count one request twice, REL-SEC-004).
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 0,
    enableAutoPipelining: false,
    connectTimeout: 1000,
    commandTimeout: deadlineMs,
    retryStrategy: (attempt) => Math.min(attempt * 100, 1000),
    lazyConnect: true,
  });
  // A connection error is surfaced by the failing command; the event must not become uncaught.
  client.on("error", () => {});

  /** EVALSHA; if the script cache was lost (restart without persistence) load it once and run it. */
  async function run(keys: readonly string[], argv: readonly string[]): Promise<unknown> {
    const call = () => client.evalsha(script.sha, keys.length, ...keys, ...argv);
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("NOSCRIPT")) throw error;
      // The first EVALSHA did not execute, so loading and running once cannot double count.
      await client.script("LOAD", script.source);
      return call();
    }
  }
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await withDeadline(operation, deadlineMs);
    } catch (error) {
      if (error instanceof RateLimitStoreError) throw error;
      throw new RateLimitStoreError(error instanceof DeadlineError ? "timeout" : "error");
    }
  }
  let connecting: Promise<void> | undefined;
  /** One shared connect attempt; concurrent evaluations must not each call connect(). */
  async function connected(): Promise<void> {
    if (client.status === "ready") return;
    if (connecting) return connecting;
    if (client.status === "wait" || client.status === "end") {
      connecting = client.connect().finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
  }

  return Object.freeze({
    evaluate(
      mode: StoreMode,
      rules: readonly StoreRule[],
      requestId: string,
    ): Promise<StoreOutcome> {
      return guarded(async () => {
        await connected();
        const reply = await run(
          rules.map((rule) => rule.key),
          [
            mode,
            requestId,
            ...rules.flatMap((rule) => [String(rule.limit), String(rule.windowMs)]),
          ],
        );
        return parseOutcome(reply, rules.length);
      });
    },
    /** INF-HLT-004: connection and script execution (a no-rule check reads the store clock). */
    assertReady(): Promise<void> {
      return guarded(async () => {
        await connected();
        parseOutcome(await run([], ["check", "ready"]), 0);
      });
    },
    async close(): Promise<void> {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  });
}
