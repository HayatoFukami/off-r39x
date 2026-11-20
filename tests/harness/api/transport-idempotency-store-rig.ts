import type { Context, MiddlewareHandler } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import { type ApiEnvironment, createApp } from "../../../apps/api/src/api/app.ts";
import { ApiFailure } from "../../../apps/api/src/api/failure.ts";
import { requireTransportIdempotency } from "../../../apps/api/src/api/middleware/idempotency.ts";
import { validateJson } from "../../../apps/api/src/api/middleware/json.ts";
import { markAuthorizationConfirmed } from "../../../apps/api/src/api/rate-limit.ts";
import { respond } from "../../../apps/api/src/api/respond.ts";
import type { ServiceResult } from "../../../apps/api/src/api/services/result.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";
import { type EffectHooks, nonLockingEffect, profileLockingEffect } from "../db/idempotency.ts";

// PR-S0-3d test harness (SPEC-170 TST-GEN-006): a Hono app with one harness-only route that wires the
// production pieces the way a business route will: the real Transport Idempotency middleware (S0-3c,
// digests only), a test-only business transaction that calls the production claim primitive on a real
// PostgreSQL 17 pool, and the real respond() mapping. No route here enters the production route table.
//
// The route is POST /api/v1/test/idempotent-store/:ref. The path reference is the synthetic Business
// Cause (UNIQUE in synthetic_business.effects) and the body is { label }. First answer 201 (or 200 when
// the Domain row already existed), replay 200, reused 409 IDEMPOTENCY_KEY_REUSED. A replay does not
// return a stored body: it rebuilds the answer from the effect row's current state (API-IDM-007).

export const WEB = "https://web.example.test";
export const ROUTE_PREFIX = "/api/v1/test/idempotent-store";

const lower = (value: string) => value.toLowerCase();
const bodySchema = z.strictObject({ label: z.string().min(1).max(40) });
const pathSchema = z.strictObject({ ref: z.uuid().transform(lower) });
const dataSchema = z.strictObject({ ref: z.uuid(), label: z.string() });

export interface StoreRigOptions {
  /** The app_api_runtime pool the business transaction runs on; replaceable per test with `use`. */
  readonly pool: Pool;
  /** The Principal's Business Profile public reference (a row created with insertProfile). */
  readonly principalProfileRef: string;
}

export function idempotencyStoreRig(options: StoreRigOptions) {
  let pool = options.pool;
  let hooks: EffectHooks | undefined;
  let position: "profile-lock" | "no-profile-lock" = "profile-lock";
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
    },
  );
  const app = createApp({ webOrigin: WEB, ready: async () => true, logger });

  const context: MiddlewareHandler<ApiEnvironment> = async (c, next) => {
    c.set("operationId", "API-ORD-002");
    c.set("principal", {
      subject: "synthetic-subject",
      profileRef: options.principalProfileRef,
      emailVerified: true,
      roles: [],
    });
    // Stand-in for the owner-relation check that a self Operation mounts (SEC-ABU-029).
    markAuthorizationConfirmed(c);
    await next();
  };
  const validated = new WeakMap<Context<ApiEnvironment>, z.output<typeof pathSchema>>();
  const validatePath: MiddlewareHandler<ApiEnvironment> = async (c, next) => {
    const result = pathSchema.safeParse(c.req.param());
    if (!result.success) throw new ApiFailure("VALIDATION_FAILED");
    validated.set(c, result.data);
    await next();
  };

  app.post(
    `${ROUTE_PREFIX}/:ref`,
    context,
    validatePath,
    validateJson(bodySchema),
    requireTransportIdempotency("API-ORD-002", (c) => {
      const path = validated.get(c);
      if (path === undefined) throw new Error("validatePath did not run");
      return { params: { target_ref: path.ref }, query: {}, body: c.get("validatedJson") };
    }),
    async (c) => {
      const transport = c.get("transportIdempotency");
      const path = validated.get(c);
      const body = c.get("validatedJson") as z.output<typeof bodySchema>;
      if (transport === undefined || path === undefined) throw new ApiFailure("INTERNAL_ERROR");
      const effect = position === "profile-lock" ? profileLockingEffect : nonLockingEffect;
      const done = await effect(
        pool,
        {
          principalProfileRef: transport.principalProfileRef,
          operationId: transport.operationId,
          keyDigest: transport.keyDigest,
          requestDigest: transport.requestDigest,
          causeKey: path.ref,
          label: body.label,
        },
        hooks ? { hooks } : {},
      );
      let result: ServiceResult<z.input<typeof dataSchema>>;
      if (done.status === "commit_unknown") {
        result = { kind: "commit_unknown" };
      } else if (done.value.kind === "reused") {
        result = { kind: "rejected", code: "IDEMPOTENCY_KEY_REUSED" };
      } else if (done.value.kind === "first") {
        result = {
          kind: "success",
          status: done.value.created ? 201 : 200,
          data: await currentState(done.value.effectRef),
        };
      } else {
        const replay = done.value.result;
        const effectRef = replay?.refs[0];
        if (replay === null || replay.type !== "SYNTHETIC_EFFECT" || effectRef === undefined)
          throw new ApiFailure("INTERNAL_ERROR");
        result = { kind: "success", status: 200, data: await currentState(effectRef) };
      }
      return respond(c, result, dataSchema);
    },
  );

  /** The effect row's current state: replay answers are rebuilt from it, never from a stored body. */
  async function currentState(effectRef: string): Promise<{ ref: string; label: string }> {
    const row = (
      await pool.query(
        "SELECT public_ref, label FROM synthetic_business.effects WHERE public_ref = $1",
        [effectRef],
      )
    ).rows[0] as { public_ref: string; label: string } | undefined;
    if (row === undefined) throw new ApiFailure("INTERNAL_ERROR");
    return { ref: row.public_ref, label: row.label };
  }

  async function post(
    causeRef: string,
    init: { key: string; body: unknown; requestId?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Origin: WEB,
      "Content-Type": "application/json",
      "Idempotency-Key": init.key,
    };
    if (init.requestId !== undefined) headers["X-Request-Id"] = init.requestId;
    return app.request(`${ROUTE_PREFIX}/${causeRef}`, {
      method: "POST",
      headers,
      body: JSON.stringify(init.body),
    });
  }

  return {
    app,
    lines,
    post,
    /** Replace the pool and/or the fault hooks for the following requests (per-test injection). */
    use(next: {
      pool?: Pool;
      hooks?: EffectHooks | undefined;
      position?: "profile-lock" | "no-profile-lock";
    }) {
      if (next.pool) pool = next.pool;
      if ("hooks" in next) hooks = next.hooks;
      if (next.position) position = next.position;
    },
  };
}

export type StoreRig = ReturnType<typeof idempotencyStoreRig>;

export async function readJson(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  return { text, json: JSON.parse(text) as unknown };
}
