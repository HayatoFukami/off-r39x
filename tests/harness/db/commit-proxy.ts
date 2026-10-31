import { createConnection, createServer, type Socket } from "node:net";

/** Plain local fixture transport only. PostgreSQL executes COMMIT; its complete
 * CommandComplete frame is observed but never forwarded to the caller. */
export async function startCommitAcknowledgementDropProxy(target: URL) {
  const sockets = new Set<Socket>();
  let dropped = false;
  const server = createServer((downstream) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(downstream);
    sockets.add(upstream);
    let startup = true;
    let incoming = Buffer.alloc(0);
    let outgoing = Buffer.alloc(0);
    let commitPending = false;
    downstream.on("data", (chunk) => {
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= (startup ? 4 : 5)) {
        const size = startup ? incoming.readInt32BE(0) : 1 + incoming.readInt32BE(1);
        if (incoming.length < size) break;
        const frame = incoming.subarray(0, size);
        incoming = incoming.subarray(size);
        if (!startup && frame[0] === 81 && /^COMMIT\s*;?\s*\0$/i.test(frame.subarray(5).toString()))
          commitPending = true;
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
        if (commitPending && frame[0] === 67 && frame.subarray(5).toString() === "COMMIT\0") {
          dropped = true;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        downstream.write(frame);
      }
    });
    for (const socket of [upstream, downstream]) {
      socket.on("error", () => {
        upstream.destroy();
        downstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        upstream.destroy();
        downstream.destroy();
      });
    }
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
    didDrop: () => dropped,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
