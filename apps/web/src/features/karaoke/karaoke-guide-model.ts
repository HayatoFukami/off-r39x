import type { BusinessDateJst, KaraokeSales } from "../../api-client/types";
import { karaokeDayHref } from "../../config/public-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatBusinessDate, formatJstDateTime } from "../../presentation/format/datetime";
import { formatMoney } from "../../presentation/format/money";
import {
  type KaraokeSaleStatusPresentation,
  presentKaraokeSaleStatus,
} from "../../presentation/state-mapping/karaoke-sale-status";

// View model for PG-KRK-001 (SPEC-050 13.1). A failed read is never "no sales dates".

export type KaraokeGuideModel =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      priceText: string;
      salesPeriodText: string;
      saleStatus: KaraokeSaleStatusPresentation;
      dates:
        | { kind: "empty" }
        | {
            kind: "items";
            items: readonly { date: BusinessDateJst; text: string; href: string }[];
          };
    };

export function buildKaraokeGuideModel(input: Loadable<KaraokeSales>): KaraokeGuideModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "ok": {
      const sales = input.data;
      const dates = [...sales.salesDates].sort();
      return {
        kind: "ready",
        priceText: formatMoney(sales.price),
        salesPeriodText: copy.home.period.range(
          formatJstDateTime(sales.salesPeriod.startsAt),
          formatJstDateTime(sales.salesPeriod.endsAt),
        ),
        saleStatus: presentKaraokeSaleStatus(sales.saleStatus),
        dates:
          dates.length === 0
            ? { kind: "empty" }
            : {
                kind: "items",
                items: dates.map((date) => ({
                  date,
                  text: formatBusinessDate(date),
                  href: karaokeDayHref(date),
                })),
              },
      };
    }
    case "not_found":
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
