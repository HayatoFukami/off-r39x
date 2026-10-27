import { bootstrap } from "./index.ts";

function finish(code: number): void {
  const flushDeadline = setTimeout(() => process.exit(code), 2000);
  process.stdout.write("", () => {
    clearTimeout(flushDeadline);
    process.exit(code);
  });
}

try {
  const runtime = bootstrap(process.env);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    runtime.beginDrain();
    const deadline = setTimeout(() => {
      if ("closeAllConnections" in runtime.server) runtime.server.closeAllConnections();
      finish(1);
    }, 20000);
    deadline.unref();
    void runtime.close().then(
      () => {
        clearTimeout(deadline);
        finish(0);
      },
      () => {
        clearTimeout(deadline);
        finish(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  // Configuration may be invalid: do not invent an environment identity.
  process.stderr.write(
    `${JSON.stringify({ event_name: "security.fail_closed.triggered", service: "API", level: "ERROR", result: "FAILED", is_retry: false, error_code: "TEMPORARY_UNAVAILABLE", failure_class: "SECURITY_FAILURE" })}\n`,
  );
  process.exitCode = 1;
}
