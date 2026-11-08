import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { createStripeLookup } from "../../packages/providers/stripe/src/index.ts";

it("TC-STRIPE-AUDIT-002 default SDK transport aborts a real trickling HTTP body at the total ten-second deadline", async () => {
  let requests = 0;
  let closed = false;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"id":"cs_synthetic",');
    // Frequent bytes defeat a socket inactivity timeout; full valid body at 12s.
    const trickle = setInterval(() => res.write(" "), 250);
    const finish = setTimeout(() => res.end('"status":"complete","payment_status":"paid"}'), 12000);
    res.on("close", () => {
      closed = true;
      clearInterval(trickle);
      clearTimeout(finish);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  const realFetch = globalThis.fetch;
  // Redirect only the network destination. Use the production factory without
  // an injected SDK/response/timeout; real Fetch, SDK parsing and socket close.
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    realFetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init),
  );
  try {
    const start = performance.now();
    expect(await createStripeLookup("sk_test_synthetic").checkout("cs_synthetic")).toEqual({
      kind: "TEMPORARY_FAILURE",
    });
    expect(performance.now() - start).toBeGreaterThanOrEqual(9900);
    expect(performance.now() - start).toBeLessThan(11000);
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(requests).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}, 15000);
