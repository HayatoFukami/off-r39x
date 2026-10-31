import { startWorkerHost as emailHost } from "../../../apps/email-worker/src/bootstrap/host.ts";
import { startWorkerHost as reconciliationHost } from "../../../apps/reconciliation-worker/src/bootstrap/host.ts";
import { createWorker, processItems } from "../../../packages/application/src/worker.ts";

const [service, mode] = process.argv.slice(2);
if (
  !["email", "reconciliation"].includes(service ?? "") ||
  !["ignored", "cooperative", "health"].includes(mode ?? "")
)
  throw new Error("Invalid synthetic fixture mode");
async function* items() {
  yield 1;
  yield 2;
}
let enteredItem: () => void = () => {};
const itemEntered = new Promise<void>((resolve) => {
  enteredItem = resolve;
});
const worker = createWorker(
  { now: () => new Date(0) },
  mode === "health"
    ? []
    : [
        {
          cadenceMs: 15_000,
          run: async (signal) =>
            processItems(
              items(),
              async (item, itemSignal) => {
                process.stdout.write(`item-${item}\n`);
                enteredItem();
                await new Promise<void>((resolve) => {
                  if (mode === "cooperative")
                    itemSignal.addEventListener("abort", () => resolve(), { once: true });
                });
              },
              signal,
            ),
        },
        {
          cadenceMs: 15_000,
          run: async () => {
            process.stdout.write("later-job\n");
          },
        },
      ],
);
let enteredReadiness: () => void = () => {};
const readinessEntered = new Promise<void>((resolve) => {
  enteredReadiness = resolve;
});
const host = (service === "email" ? emailHost : reconciliationHost)({
  worker,
  port: 0,
  checkReadiness: async () => {
    enteredReadiness();
    return new Promise<boolean>(() => {});
  },
  close: async () => {
    process.stdout.write("dependency-close\n");
  },
  failure: () => {},
});
await new Promise<void>((resolve) => host.server.once("listening", resolve));
if (mode !== "health") await itemEntered;
if (mode === "health") {
  const address = host.server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic listener unavailable");
  void fetch(`http://127.0.0.1:${address.port}/internal/health/ready`).catch(() => {});
  await readinessEntered;
}
// Match the production entry's sanitized shutdown rejection handling.
try {
  await host.stop();
  process.stdout.write("drained\n");
} catch {
  process.exitCode = 1;
}
