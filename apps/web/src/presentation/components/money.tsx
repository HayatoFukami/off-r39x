import type { Money as MoneyValue } from "../../api-client/types";
import { formatMoney } from "../format/money";

export function Money({ value, className }: { value: MoneyValue; className?: string }) {
  return <span className={className}>{formatMoney(value)}</span>;
}
