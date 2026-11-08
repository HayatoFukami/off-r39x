import type { AdvisoryLockPort } from "@off-r39x/application/reconciliation";
import { type createDatabase, withWorkerAdvisoryLock } from "@off-r39x/db";

export function createAdvisoryLock(
  pool: ReturnType<typeof createDatabase>["pool"],
): AdvisoryLockPort {
  return { withLock: (key, run) => withWorkerAdvisoryLock(pool, key, () => run()) };
}
