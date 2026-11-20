import { createConnection, createServer, type Socket } from "node:net";

/**
 * FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK fixture modes (SPEC-170 TST-FLT-001: every mode reports how often
 * it fired).
 *
 * - `drop_ack` (default): PostgreSQL executes COMMIT; its complete CommandComplete frame is observed but
 *   never forwarded to the caller, then both sockets are destroyed. The commit is durable.
 * - `drop_request`: the COMMIT frame is never sent upstream and both sockets are destroyed. Nothing is
 *   committed; the server rolls the transaction back when it sees the connection close.
 * - `hold_request`: only the caller's socket is destroyed. The COMMIT frame is withheld, so the server
 *   backend stays inside its transaction (still holding its locks) until `releaseCommit()` forwards it.
 */
export type CommitProxyMode = "drop_ack" | "drop_request" | "hold_request";

const isCommitComplete = (frame: Buffer) =>
  frame[0] === 67 && frame.subarray(5).toString() === "COMMIT\0";

/** Plain local fixture transport only (it cannot carry TLS). */
export async function startCommitAcknowledgementDropProxy(
  target: URL,
  options: { mode?: CommitProxyMode } = {},
) {
  const mode = options.mode ?? "drop_ack";
  const sockets = new Set<Socket>();
  let fired = 0;
  const heldCommits: Array<() => Promise<void>> = [];
  const server = createServer((downstream) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(downstream);
    sockets.add(upstream);
    let startup = true;
    let incoming = Buffer.alloc(0);
    let outgoing = Buffer.alloc(0);
    let commitPending = false;
    // hold_request only: the caller is gone but the upstream backend must stay alive.
    let detached = false;
    downstream.on("data", (chunk) => {
      if (detached) return;
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= (startup ? 4 : 5)) {
        const size = startup ? incoming.readInt32BE(0) : 1 + incoming.readInt32BE(1);
        if (incoming.length < size) break;
        const frame = incoming.subarray(0, size);
        incoming = incoming.subarray(size);
        const isCommit =
          !startup && frame[0] === 81 && /^COMMIT\s*;?\s*\0$/i.test(frame.subarray(5).toString());
        if (isCommit && mode === "drop_request") {
          fired += 1;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (isCommit && mode === "hold_request") {
          fired += 1;
          detached = true;
          heldCommits.push(
            () =>
              new Promise<void>((resolve) => {
                upstream.once("close", () => resolve());
                if (upstream.destroyed) resolve();
                else upstream.write(frame);
              }),
          );
          downstream.destroy();
          return;
        }
        if (isCommit) commitPending = true;
        upstream.write(frame);
        startup = false;
      }
    });
    upstream.on("data", (chunk) => {
      outgoing = Buffer.concat([outgoing, chunk]);
      while (outgoing.length >= 5) {
        const size = 1 + outgoing.readInt32BE(1);
        if (outgoing.length < size) break;
        const frame = outgoing.subarray(0, size);
        outgoing = outgoing.subarray(size);
        if (detached) {
          // The held COMMIT was released and PostgreSQL has executed it; nobody is listening.
          if (isCommitComplete(frame)) {
            upstream.destroy();
            return;
          }
          continue;
        }
        if (mode === "drop_ack" && commitPending && isCommitComplete(frame)) {
          fired += 1;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        downstream.write(frame);
      }
    });
    upstream.on("error", () => {
      upstream.destroy();
      downstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
    downstream.on("error", () => {
      if (!detached) upstream.destroy();
      downstream.destroy();
    });
    downstream.on("close", () => {
      sockets.delete(downstream);
      if (!detached) upstream.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy listener missing");
  const url = new URL(target);
  url.hostname = "127.0.0.1";
  url.port = String(address.port);
  return {
    url: url.toString(),
    /** True once the fault fired at least once (any mode). */
    didDrop: () => fired > 0,
    /** How many times the fault fired (TST-FLT-001). */
    fired: () => fired,
    /** hold_request only: forward every withheld COMMIT; resolves once PostgreSQL has executed it. */
    releaseCommit: async () => {
      const pending = heldCommits.splice(0);
      await Promise.all(pending.map((release) => release()));
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
