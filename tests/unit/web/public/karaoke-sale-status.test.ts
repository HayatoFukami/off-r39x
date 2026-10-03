import { describe, expect, it } from "vitest";
import type { KaraokeSaleStatus } from "../../../../apps/web/src/api-client/types.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentKaraokeSaleStatus } from "../../../../apps/web/src/presentation/state-mapping/karaoke-sale-status.ts";
import { TONES } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s4-public.md section 2.7 (SPEC-050 13.1, 25, 33).

const STATUSES: readonly KaraokeSaleStatus[] = [
  "ON_SALE",
  "BEFORE_SALES",
  "SALES_ENDED",
  "SUSPENDED",
];

describe("TC-PG-KRK-001-601 presentKaraokeSaleStatus separates before / ended / suspended by text", () => {
  it("uses the shared availability labels", () => {
    expect(presentKaraokeSaleStatus("ON_SALE").label).toBe(copy.availability.label.ON_SALE);
    expect(presentKaraokeSaleStatus("BEFORE_SALES").label).toBe(
      copy.availability.label.BEFORE_SALES,
    );
    expect(presentKaraokeSaleStatus("SALES_ENDED").label).toBe(copy.availability.label.SALES_ENDED);
    expect(presentKaraokeSaleStatus("SUSPENDED").label).toBe(copy.availability.label.SUSPENDED);
  });

  it("gives four distinct labels and four distinct descriptions", () => {
    const results = STATUSES.map((s) => presentKaraokeSaleStatus(s));
    expect(new Set(results.map((r) => r.label)).size).toBe(4);
    expect(new Set(results.map((r) => r.description)).size).toBe(4);
    for (const result of results) {
      expect(result.label.length).toBeGreaterThan(0);
      expect(TONES).toContain(result.tone);
    }
  });

  it("is on sale only for ON_SALE", () => {
    for (const status of STATUSES) {
      expect(presentKaraokeSaleStatus(status).onSale, status).toBe(status === "ON_SALE");
    }
  });

  it("never says that existing reservations were canceled, and uses the suspended note", () => {
    for (const status of STATUSES) {
      expect(presentKaraokeSaleStatus(status).description, status).not.toMatch(
        /(取り消|取消|キャンセル)(されました|しました)/,
      );
    }
    expect(presentKaraokeSaleStatus("SUSPENDED").description).toBe(
      copy.karaoke.saleStatus.description.SUSPENDED,
    );
  });

  it("fails closed on an unknown status", () => {
    expect(() => presentKaraokeSaleStatus("UNKNOWN" as KaraokeSaleStatus)).toThrow();
  });
});
