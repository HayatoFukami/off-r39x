import type { Tone } from "../state-mapping/order";
import { Badge } from "./ui/badge";

// The tone only colours the badge: the text always carries the state (SPEC-050 25).

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <Badge tone={tone}>{label}</Badge>;
}
