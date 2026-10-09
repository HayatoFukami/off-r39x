import type { UtcInstant } from "../../api-client/types";
import { formatJstDate, formatJstDateTime } from "../format/datetime";

// Dates are shown in JST whatever the browser time zone is (SPEC-030 8).

export function DateTime({
  instant,
  variant = "date",
  className,
}: {
  instant: UtcInstant;
  variant?: "date" | "dateTime";
  className?: string;
}) {
  return (
    <time dateTime={instant} className={className}>
      {variant === "date" ? formatJstDate(instant) : formatJstDateTime(instant)}
    </time>
  );
}
