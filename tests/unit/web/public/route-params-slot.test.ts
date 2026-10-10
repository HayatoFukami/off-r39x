import { describe, expect, it } from "vitest";
import { parseSlotRef } from "../../../../apps/web/src/features/public/route-params.ts";
import { SLOT } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s7b-karaoke.md section 3.1 (SPEC-050 5.2, 13.3, 19.1).

describe("TC-PG-KRK-003-604 parseSlotRef accepts only canonical lowercase UUIDs", () => {
  it("returns the seed slot refs unchanged", () => {
    for (const ref of Object.values(SLOT)) expect(parseSlotRef(ref)).toBe(ref);
  });

  it("rejects non-UUIDs, uppercase, padded and encoded values", () => {
    for (const raw of [
      "",
      "slot",
      "1",
      "5a000000-0000-4000-8000-00000000000",
      "5a000000-0000-4000-8000-0000000000011",
      "5A000000-0000-4000-8000-000000011000",
      " 5a000000-0000-4000-8000-000000011000",
      "5a000000-0000-4000-8000-000000011000 ",
      "5a000000-0000-4000-8000-00000001100g",
      "5a000000%2D0000-4000-8000-000000011000",
      "5a000000-0000-4000-8000-000000011000/../x",
      "5a000000000040008000000000011000",
    ]) {
      expect(parseSlotRef(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
