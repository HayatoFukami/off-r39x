import { describe, expect, it } from "vitest";
import type {
  BusinessDateJst,
  KaraokeSales,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { buildKaraokeGuideModel } from "../../../../apps/web/src/features/karaoke/karaoke-guide-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstDateTime,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { D1, D2 } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md section 2.8 (SPEC-050 13.1, 9.2, 21, FR-PUB-008).

const sales = (patch: Partial<KaraokeSales> = {}): KaraokeSales => ({
  price: { amount: "1000", currency: "JPY" },
  salesPeriod: {
    startsAt: "2027-02-01T00:00:00Z" as UtcInstant,
    endsAt: "2027-03-30T14:59:00Z" as UtcInstant,
  },
  saleStatus: "ON_SALE",
  salesDates: [D1, D2],
  ...patch,
});

describe("TC-PG-KRK-001-602 karaoke guide model (SPEC-050 13.1)", () => {
  it("formats the price with formatMoney and the sales period in JST", () => {
    const model = buildKaraokeGuideModel({ kind: "ok", data: sales() });
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.priceText).toBe(formatMoney({ amount: "1000", currency: "JPY" }));
    expect(model.priceText).toBe("¥1,000");
    // 14:59 UTC on 03-30 is 23:59 JST on 03-30; 00:00 UTC on 02-01 is 09:00 JST.
    expect(model.salesPeriodText).toContain(
      formatJstDateTime("2027-02-01T00:00:00Z" as UtcInstant),
    );
    expect(model.salesPeriodText).toContain(
      formatJstDateTime("2027-03-30T14:59:00Z" as UtcInstant),
    );
    expect(model.salesPeriodText).toContain("2027/03/30 23:59");
  });

  it("builds from the seed port data and links every sales date to its schedule", async () => {
    const { api } = createBackend();
    const data = okData(await api.public.getKaraokeSales());
    const model = buildKaraokeGuideModel({ kind: "ok", data });
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.saleStatus.onSale).toBe(true);
    expect(model.dates.kind).toBe("items");
    if (model.dates.kind !== "items") return;
    expect(model.dates.items).toEqual(
      data.salesDates.map((date) => ({
        date,
        text: formatBusinessDate(date),
        href: `/karaoke/schedule/${date}`,
      })),
    );
  });

  it("orders the sales dates chronologically", () => {
    const model = buildKaraokeGuideModel({
      kind: "ok",
      data: sales({ salesDates: [D2, D1] as BusinessDateJst[] }),
    });
    expect(
      model.kind === "ready" &&
        model.dates.kind === "items" &&
        model.dates.items.map((i) => i.date),
    ).toEqual([D1, D2]);
  });

  it("distinguishes before / ended / suspended / on sale by the status label", () => {
    const labels = (["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const).map(
      (saleStatus) => {
        const model = buildKaraokeGuideModel({ kind: "ok", data: sales({ saleStatus }) });
        return model.kind === "ready" ? model.saleStatus.label : null;
      },
    );
    expect(labels).toEqual([
      copy.availability.label.ON_SALE,
      copy.availability.label.BEFORE_SALES,
      copy.availability.label.SALES_ENDED,
      copy.availability.label.SUSPENDED,
    ]);
    expect(new Set(labels).size).toBe(4);
  });

  it("keeps the sales dates listed when the sale is not running (the status says why)", () => {
    for (const saleStatus of ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
      const model = buildKaraokeGuideModel({ kind: "ok", data: sales({ saleStatus }) });
      expect(model.kind === "ready" && model.dates.kind, saleStatus).toBe("items");
    }
  });

  it("is empty only when a successful read has no sales dates", () => {
    const model = buildKaraokeGuideModel({ kind: "ok", data: sales({ salesDates: [] }) });
    expect(model.kind === "ready" && model.dates).toEqual({ kind: "empty" });
  });

  it("never turns a failed read into 'no sales dates' (SPEC-050 13.1, 33)", () => {
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildKaraokeGuideModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    expect(buildKaraokeGuideModel({ kind: "loading" })).toEqual({ kind: "loading" });
  });
});
