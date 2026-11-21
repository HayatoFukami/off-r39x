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
 * - `delay_ack`: PostgreSQL executes COMMIT and the commit is durable, but its acknowledgement (and every
 *   frame after it) reaches the caller only after `delayMs` (or `releaseAck()`). The caller's own
 *   deadline can therefore pass while the COMMIT is in flight; the connection stays open.
 * - `rollback_for_commit`: the COMMIT frame is replaced by ROLLBACK, so the transaction is NOT committed
 *   and its transaction locks go, but the backend session (and its session-level advisory locks) stays
 *   alive. The ROLLBACK acknowledgement reaches the caller only after `delayMs` (or `releaseAck()`).
 */
export type CommitProxyMode =
  | "drop_ack"
  | "drop_request"
  | "hold_request"
  | "delay_ack"
  | "rollback_for_commit";

const ROLLBACK_FRAME = Buffer.concat([
  Buffer.from([81]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from("ROLLBACK\0"),
]);

const isCommitComplete = (frame: Buffer) =>
  frame[0] === 67 && frame.subarray(5).toString() === "COMMIT\0";

/** Plain local fixture transport only (it cannot carry TLS). */
export async function startCommitAcknowledgementDropProxy(
  target: URL,
  options: { mode?: CommitProxyMode; delayMs?: number } = {},
) {
  const mode = options.mode ?? "drop_ack";
  const delayMs = options.delayMs ?? 3000;
  const flushers = new Set<() => void>();
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
    // delay_ack / rollback_for_commit: server frames withheld from the caller.
    let holding = false;
    let rollbackSent = false;
    const held: Buffer[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushers.delete(flush);
      holding = false;
      for (const frame of held.splice(0)) if (!downstream.destroyed) downstream.write(frame);
    };
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
        if (isCommit && mode === "rollback_for_commit") {
          fired += 1;
          rollbackSent = true;
          upstream.write(ROLLBACK_FRAME);
          startup = false;
          continue;
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
        const startsHolding =
          (mode === "delay_ack" && commitPending && isCommitComplete(frame)) ||
          (mode === "rollback_for_commit" &&
            rollbackSent &&
            frame[0] === 67 &&
            frame.subarray(5).toString() === "ROLLBACK\0");
        if (startsHolding && !holding) {
          if (mode === "delay_ack") fired += 1;
          holding = true;
          flushers.add(flush);
          flushTimer = setTimeout(flush, delayMs);
          flushTimer.unref();
        }
        if (holding) {
          held.push(frame);
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
      if (flushTimer) clearTimeout(flushTimer);
      flushers.delete(flush);
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
    /** delay_ack and rollback_for_commit: hand the withheld acknowledgement to the caller now. */
    releaseAck: () => {
      for (const flush of [...flushers]) flush();
    },
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
