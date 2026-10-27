import { expect, it, vi } from "vitest";
import { createStripeLookup } from "../../packages/providers/stripe/src/index.ts";

it("TC-STRIPE-AUDIT-001 bounds the entire request even when transport ignores abort", async () => {
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | null | undefined;
    const transport: typeof fetch = vi.fn(async (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    let settled = false;
    const pending = createStripeLookup("sk_test_synthetic", undefined, transport)
      .checkout("cs_synthetic")
      .then((v) => {
        settled = true;
        return v;
      });
    await vi.advanceTimersByTimeAsync(10001);
    expect(settled).toBe(true);
    expect(await pending).toEqual({ kind: "TEMPORARY_FAILURE" });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("TC-STRIPE-AUDIT-003 never accepts a late successful body when the timer callback was delayed", async () => {
  let clock = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
  try {
    const transport: typeof fetch = async () => {
      clock = 10001;
      return Response.json({ id: "cs_synthetic", status: "complete", payment_status: "paid" });
    };
    expect(
      await createStripeLookup("sk_test_synthetic", undefined, transport).checkout("cs_synthetic"),
    ).toEqual({ kind: "TEMPORARY_FAILURE" });
  } finally {
    now.mockRestore();
  }
});
