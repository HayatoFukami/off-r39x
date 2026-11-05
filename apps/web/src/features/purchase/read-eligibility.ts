import type { CartLine, PurchaseEligibilityRead } from "../../api-client/types";
import {
  chunkEligibilityTargets,
  type EligibilityInput,
  toEligibilityInput,
} from "./eligibility-model";

// Reads the owner-scoped eligibility (SPEC-110 API-PUR-ELG-001) for any number of lines. One request carries
// at most 50 items, so a longer list is split. The answer is used only when every request succeeded: a failed,
// rejected or not-ok request makes the whole read a failure, never a partial "under the limit" (fail closed,
// SPEC-050 12.1 / 14A.1). The requests are read-only snapshots; nothing is kept here.

export async function readEligibilityOf(
  read: (lines: readonly CartLine[]) => Promise<PurchaseEligibilityRead>,
  lines: readonly CartLine[],
): Promise<EligibilityInput> {
  if (lines.length === 0) return { kind: "ok", data: [] };
  try {
    const answers = await Promise.all(chunkEligibilityTargets(lines).map((chunk) => read(chunk)));
    const data = [];
    for (const answer of answers) {
      const input = toEligibilityInput(answer);
      if (input.kind !== "ok") return { kind: "unavailable" };
      data.push(...input.data);
    }
    return { kind: "ok", data };
  } catch {
    return { kind: "unavailable" };
  }
}
