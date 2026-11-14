import { randomInt } from "node:crypto";
import { Redis } from "ioredis";

/** DEV-RLM-008 / TST-RLM-001: a real Redis is mandatory; an unset URL fails, it never skips. */
export function requireRedisTestUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const url = env.TEST_REDIS_URL;
  if (!url) throw new Error("TEST_REDIS_URL is required: real Redis tests never skip");
  return url;
}

export interface RedisTestSession {
  readonly url: string;
  /** Test-only inspection client (the production adapter is the only production Redis importer). */
  readonly redis: Redis;
  /** Unique per session so concurrently running suites never share counters. */
  readonly keyVersion: number;
  keys(): Promise<string[]>;
  close(): Promise<void>;
}

export async function openRedisTestSession(): Promise<RedisTestSession> {
  const url = requireRedisTestUrl();
  const redis = new Redis(url, {
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 2000,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    if ((await redis.ping()) !== "PONG") throw new Error("unexpected reply");
  } catch {
    redis.disconnect();
    throw new Error("TEST_REDIS_URL is unreachable: real Redis tests never skip");
  }
  const keyVersion = randomInt(1_000_000, 2_000_000_000);
  const keys = async () => {
    const found: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", `rl:v${keyVersion}:*`, "COUNT", 500);
      cursor = next;
      found.push(...batch);
    } while (cursor !== "0");
    return found;
  };
  return {
    url,
    redis,
    keyVersion,
    keys,
    async close() {
      const owned = await keys();
      if (owned.length) await redis.del(...owned);
      redis.disconnect();
    },
  };
}
