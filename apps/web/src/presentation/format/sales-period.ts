import type { SalesPeriod } from "../../api-client/types";
import { copy } from "../copy/ja";
import { formatJstDateTime } from "./datetime";

/** Both ends of a sales period in JST (SPEC-050 12.1, 14.2). */
export function formatSalesPeriod(period: SalesPeriod): string {
  return copy.home.period.range(
    formatJstDateTime(period.startsAt),
    formatJstDateTime(period.endsAt),
  );
}
