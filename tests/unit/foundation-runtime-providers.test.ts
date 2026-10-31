import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createResendSender } from "../../packages/providers/resend/src/index.ts";
import {
  createStripeLookup,
  createStripeWebhookVerifier,
} from "../../packages/providers/stripe/src/index.ts";

describe("provider foundation", () => {
  it("TC-FOUNDATION-RUNTIME-010 verifies exact raw bytes and rejects reserialization [PAY-WHK-005]", () => {
    const now = Math.floor(Date.now() / 1000);
    const raw =
      '{ "id":"evt_synthetic", "object":"event", "type":"synthetic.test", "created":1, "livemode":false, "data":{"object":{"id":"synthetic"}} }';
    const signature = createHmac("sha256", "whsec_synthetic").update(`${now}.${raw}`).digest("hex");
    const header = `t=${now},v1=${signature}`;
    const verifier = createStripeWebhookVerifier("sk_test_synthetic", "whsec_synthetic", "test");
    expect(verifier.verify(Buffer.from(raw), header)).toEqual({
      id: "evt_synthetic",
      type: "synthetic.test",
      created: 1,
      livemode: false,
    });
    expect(verifier.verify(Buffer.from(JSON.stringify(JSON.parse(raw))), header)).toBeNull();
  });
  it("TC-FOUNDATION-RUNTIME-011 aborts transport at ten seconds without automatic resend [REL-TMO-003]", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const sender = createResendSender("synthetic-key", async (_url, init) => {
        calls++;
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("Synthetic abort")), {
            once: true,
          }),
        );
      });
      const sending = sender.send({
        key: "synthetic",
        payload: { from: "a@example.com", to: "b@example.com", subject: "Test", text: "Test" },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await sending).toEqual({ kind: "UNKNOWN_RESULT" });
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("TC-FOUNDATION-RUNTIME-008 rejects unverified raw webhook bytes [PAY-WHK-003]", () => {
    const verifier = createStripeWebhookVerifier("sk_test_synthetic", "whsec_synthetic", "test");
    expect(verifier.verify(new TextEncoder().encode('{"id":"synthetic"}'), "invalid")).toBeNull();
  });
  it("TC-FOUNDATION-RUNTIME-009 blocks malformed authority lookup IDs without network [REL-RTY-005]", async () => {
    const lookup = createStripeLookup("sk_test_synthetic");
    expect(await lookup.checkout("../../emails")).toEqual({ kind: "BLOCKED" });
    expect(await lookup.refund("invalid")).toEqual({ kind: "BLOCKED" });
  });
  it("TC-FOUNDATION-RUNTIME-001 preserves same-key payload and classifies ambiguous acceptance [REL-RTY-004]", async () => {
    const calls: RequestInit[] = [];
    const sender = createResendSender("synthetic-key", async (_url, init) => {
      calls.push(init);
      return new Response(JSON.stringify({ name: "concurrent_idempotent_requests" }), {
        status: 409,
      });
    });
    const request = Object.freeze({
      key: "r39x-email/synthetic/1",
      payload: Object.freeze({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Synthetic",
        text: "Synthetic",
      }),
    });
    expect(await sender.send(request)).toEqual({ kind: "UNKNOWN_RESULT" });
    expect(await sender.send(request)).toEqual({ kind: "UNKNOWN_RESULT" });
    expect(calls[0]?.body).toBe(calls[1]?.body);
    expect(calls).toHaveLength(2);
  });
  it("TC-FOUNDATION-RUNTIME-002 stops different-payload conflicts [EML-IDM-002]", async () => {
    const sender = createResendSender(
      "synthetic-key",
      async () =>
        new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409 }),
    );
    expect(
      await sender.send({
        key: "synthetic",
        payload: { from: "a@example.com", to: "b@example.com", subject: "Test", text: "Test" },
      }),
    ).toEqual({ kind: "BLOCKED" });
  });
  it("TC-FOUNDATION-RUNTIME-015 bounds a transport that ignores cancellation [REL-TMO-003]", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const transport = vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal;
        return new Promise<Response>(() => {});
      });
      const pending = createResendSender("synthetic", transport).send({
        key: "synthetic",
        payload: { from: "a@example.com", to: "b@example.com", subject: "Test", text: "Test" },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ kind: "UNKNOWN_RESULT" });
      expect(signal?.aborted).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("TC-FOUNDATION-RUNTIME-016 rejects malformed runtime send input without throwing [EML-IDM-001]", async () => {
    const transport = vi.fn();
    const sender = createResendSender("synthetic", transport);
    for (const input of [
      undefined,
      null,
      [],
      {},
      { key: 7, payload: {} },
      { key: "synthetic", payload: null },
      {
        key: "synthetic",
        payload: {
          from: "a@example.com",
          to: "b@example.com",
          subject: "Test",
          text: "Test",
          extra: true,
        },
      },
    ]) {
      expect(await sender.send(input as never)).toEqual({ kind: "BLOCKED" });
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("TC-FOUNDATION-RUNTIME-017 maps replyTo and distinguishes not-accepted throttling [REL-RTY-004]", async () => {
    let body: unknown;
    const sender = createResendSender("synthetic", async (_url, init) => {
      body = JSON.parse(String(init.body));
      return new Response("{}", { status: 429 });
    });
    expect(
      await sender.send({
        key: "synthetic",
        payload: {
          from: "a@example.com",
          to: "b@example.com",
          subject: "Test",
          text: "Test",
          replyTo: "reply@example.com",
        },
      }),
    ).toEqual({ kind: "TEMPORARY_FAILURE" });
    expect(body).toEqual({
      from: "a@example.com",
      to: "b@example.com",
      subject: "Test",
      text: "Test",
      reply_to: "reply@example.com",
    });
  });
  it("TC-FOUNDATION-RUNTIME-018 malformed provider acceptance remains unknown [REL-TMO-003]", async () => {
    for (const id of ["", "not-an-id", 42, null]) {
      const sender = createResendSender(
        "synthetic",
        async () => new Response(JSON.stringify({ id }), { status: 200 }),
      );
      expect(
        await sender.send({
          key: "synthetic",
          payload: { from: "a@example.com", to: "b@example.com", subject: "Test", text: "Test" },
        }),
      ).toEqual({ kind: "UNKNOWN_RESULT" });
    }
  });
  it("TC-FOUNDATION-RUNTIME-019 signed wrong-mode and malformed events are rejected [PAY-WHK-003]", () => {
    const verifier = createStripeWebhookVerifier("sk_test_synthetic", "whsec_synthetic", "test");
    const now = Math.floor(Date.now() / 1000);
    for (const event of [
      {
        id: "evt_synthetic",
        object: "event",
        type: "synthetic.test",
        created: 1,
        livemode: true,
        data: { object: {} },
      },
      { id: "evt_synthetic", type: "synthetic.test", created: 1 },
    ]) {
      const raw = JSON.stringify(event);
      const signature = createHmac("sha256", "whsec_synthetic")
        .update(`${now}.${raw}`)
        .digest("hex");
      expect(verifier.verify(Buffer.from(raw), `t=${now},v1=${signature}`)).toBeNull();
    }
  });
  it("TC-FOUNDATION-RUNTIME-020 official SDK classifies authority rejection and unavailability without retry [REL-RTY-005]", async () => {
    for (const [status, kind] of [
      [404, "BLOCKED"],
      [401, "BLOCKED"],
      [429, "TEMPORARY_FAILURE"],
      [503, "TEMPORARY_FAILURE"],
    ] as const) {
      const transport = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { type: "invalid_request_error", message: "Synthetic provider error" },
            }),
            { status, headers: { "Content-Type": "application/json" } },
          ),
      );
      const lookup = createStripeLookup("sk_test_synthetic", undefined, transport);
      expect(await lookup.refund("re_synthetic")).toEqual({ kind });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("TC-FOUNDATION-RUNTIME-021 provider failure logs omit payload, key and raw errors [OBS-LOG-004]", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "EMAIL_WORKER", environment: "test", actor_type: "SYSTEM_WORKER" },
      (line) => {
        lines.push(line);
      },
    );
    const sender = createResendSender(
      "synthetic-secret",
      async () => {
        throw new Error("synthetic-secret synthetic-key recipient@example.com");
      },
      logger,
    );
    expect(
      await sender.send({
        key: "synthetic-key",
        payload: {
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Synthetic body",
          text: "Synthetic body",
        },
      }),
    ).toEqual({ kind: "UNKNOWN_RESULT" });
    expect(lines).toHaveLength(1);
    const serialized = lines.join("");
    for (const forbidden of [
      "synthetic-secret",
      "synthetic-key",
      "recipient@example.com",
      "Synthetic body",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event_name: "reliability.unknown_result.opened",
      failure_class: "UNKNOWN_RESULT",
    });
  });
});
