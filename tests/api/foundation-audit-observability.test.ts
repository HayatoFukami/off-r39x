import { expect, it } from "vitest";
import {
  createApp,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

it("TC-OBS-AUDIT-002 auth and authorization success/rejection/outage emit safe canonical events", async () => {
  const lines: string[] = [];
  let outage = false;
  const subject = "00000000-0000-4000-8000-000000000051";
  const app = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => true,
    logger: createLogger({ service: "API", environment: "test", actor_type: "GUEST" }, (line) => {
      lines.push(line);
    }),
  });
  app.get(
    "/api/v1/test",
    requirePrincipal(
      {
        verify: async () => {
          if (outage) throw new AuthFailure("unavailable");
          return { subject };
        },
      },
      {
        findByAuthSubject: async () => ({
          directory: { authSubject: subject, emailVerified: true },
          profile: { id: "1", publicRef: subject, authSubject: subject },
          roles: ["STAFF"],
        }),
      },
    ),
    requireVerifiedEmail(),
    requireCapability("entry_checkin.execute"),
    (c) => c.json({ ok: true }),
  );
  const good = { headers: { Authorization: "Bearer e30.e30.c2ln" } };
  expect((await app.request("/api/v1/test", good)).status).toBe(200);
  let events = lines.map((x) => JSON.parse(x));
  for (const name of [
    "auth.verification.completed",
    "auth.email_verified_resolution.completed",
    "auth.business_profile_resolution.completed",
    "authorization.role_resolution.completed",
    "authorization.decision.completed",
  ])
    expect(events).toContainEqual(expect.objectContaining({ event_name: name, result: "SUCCESS" }));
  expect((await app.request("/api/v1/test")).status).toBe(401);
  outage = true;
  expect((await app.request("/api/v1/test", good)).status).toBe(503);
  events = lines.map((x) => JSON.parse(x));
  expect(events).toContainEqual(
    expect.objectContaining({
      event_name: "auth.verification.completed",
      error_code: "AUTHENTICATION_REQUIRED",
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      event_name: "auth.verification.completed",
      error_code: "AUTH_SERVICE_UNAVAILABLE",
    }),
  );
  expect(lines.join("")).not.toContain("e30.e30.c2ln");
  expect(events.every((e) => e.request_id)).toBe(true);
});
