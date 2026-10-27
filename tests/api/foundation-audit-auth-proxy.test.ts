import { expect, it, vi } from "vitest";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";

it("TC-AUTH-AUDIT-001 limited proxy preserves provider bytes/status/cookies and rejects CSRF, admin paths and open redirects", async () => {
  const transport = vi.fn(
    async (_url: string, init: RequestInit) =>
      new Response(init.body as string, {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            "__Secure-neon-auth.session_token=synthetic; Domain=neon.example.test; Path=/auth; HttpOnly; Secure; SameSite=None; Partitioned",
        },
      }),
  );
  const proxy = createAuthProxy(
    {
      baseUrl: "https://neon.example.test/auth",
      publicAuthOrigin: "https://api.example.test",
      webOrigin: "https://web.example.test",
    },
    transport,
  );
  const request = (
    path: string,
    body = '{"email":"synthetic@example.test","password":"synthetic-test-only"}',
    origin = "https://web.example.test",
    method = "POST",
  ) =>
    new Request(`https://api.example.test/auth/${path}`, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: "__Secure-neon-auth.session_token=old; unrelated=private",
      },
      ...(method === "POST" ? { body } : {}),
    });
  const res = await proxy.handle(request("sign-in/email"));
  expect(res.status).toBe(201);
  expect(await res.text()).toBe(
    '{"email":"synthetic@example.test","password":"synthetic-test-only"}',
  );
  const cookie = res.headers.getSetCookie()[0];
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).not.toMatch(/Domain=|Partitioned/);
  expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(transport.mock.calls[0]?.[0]).toBe("https://neon.example.test/auth/sign-in/email");
  expect(new Headers(transport.mock.calls[0]?.[1].headers).get("cookie")).not.toContain(
    "unrelated",
  );
  expect(
    (await proxy.handle(request("sign-in/email", "{}", "https://evil.example.test"))).status,
  ).toBe(403);
  expect((await proxy.handle(request("admin/list-users"))).status).toBe(404);
  expect(
    (await proxy.handle(request("sign-in/email", "{}", "https://web.example.test", "GET"))).status,
  ).toBe(405);
  expect(
    (
      await proxy.handle(
        request(
          "sign-in/magic-link",
          '{"email":"a@example.test","callbackURL":"https://evil.example.test/"}',
        ),
      )
    ).status,
  ).toBe(400);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("TC-AUTH-AUDIT-002 upstream failure/body stall/redirects fail closed without leaking credentials", async () => {
  const cfg = {
    baseUrl: "https://neon.example.test/auth",
    publicAuthOrigin: "https://api.example.test",
    webOrigin: "https://web.example.test",
  };
  const req = () =>
    new Request("https://api.example.test/auth/token", { headers: { Origin: cfg.webOrigin } });
  const failed = createAuthProxy(cfg, async () => {
    throw new Error("synthetic-private-credential");
  });
  const res = await failed.handle(req());
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain("synthetic-private");
  const redirect = createAuthProxy(
    cfg,
    async () =>
      new Response(null, { status: 302, headers: { Location: "https://evil.example.test" } }),
  );
  expect((await redirect.handle(req())).status).toBe(503);
  vi.useFakeTimers();
  try {
    const stalled = createAuthProxy(
      cfg,
      async () => new Response(new ReadableStream({ start() {} })),
    );
    const pending = stalled.handle(req());
    await vi.advanceTimersByTimeAsync(3001);
    expect((await pending).status).toBe(503);
  } finally {
    vi.useRealTimers();
  }
});

it("TC-AUTH-AUDIT-003 mounts all four auth transports behind mandatory shared enforcement", async () => {
  const { createApp } = await import("../../apps/api/src/api/app.ts");
  let calls = 0;
  let blocked = false;
  const proxy = createAuthProxy(
    {
      baseUrl: "https://neon.example.test/auth",
      publicAuthOrigin: "https://api.example.test",
      webOrigin: "https://web.example.test",
    },
    async () => {
      calls++;
      return Response.json({ ok: true });
    },
  );
  const base = { webOrigin: "https://web.example.test", ready: async () => true, authProxy: proxy };
  const make = (path: string, body: string) =>
    new Request(`https://api.example.test/auth/${path}`, {
      method: "POST",
      headers: { Origin: base.webOrigin, "Content-Type": "application/json" },
      body,
    });
  expect((await createApp(base).request(make("sign-in/email", "{}"))).status).toBe(503);
  expect(calls).toBe(0);
  const app = createApp({
    ...base,
    enforcement: {
      assertAvailable: async () => {
        if (blocked) throw new Error("synthetic-shared-store-down");
      },
      middleware: async (_c, next) => {
        await next();
      },
    },
  });
  for (const [path, body] of [
    ["sign-in/email", '{"email":"a@example.test","password":"synthetic"}'],
    ["sign-in/social", '{"provider":"google","callbackURL":"https://web.example.test/mypage"}'],
    ["sign-in/email-otp", '{"email":"a@example.test","otp":"synthetic"}'],
    [
      "sign-in/magic-link",
      '{"email":"a@example.test","callbackURL":"https://web.example.test/mypage"}',
    ],
  ]) {
    expect((await app.request(make(path as string, body as string))).status).toBe(200);
  }
  expect(calls).toBe(4);
  blocked = true;
  const unavailable = await app.request(make("sign-in/email", "{}"));
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain("synthetic-shared-store-down");
  expect(calls).toBe(4);
});
