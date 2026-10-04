import type { BusinessDateJst, Ref } from "../../api-client/types";
import { parseBusinessDateJst } from "../../presentation/format/datetime";

// Route parameters are validated on the server before any read (SPEC-050 5.2, 19.1). No normalisation.

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseAnnouncementRef(raw: string): Ref<"announcement"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"announcement">) : null;
}

export function parseBusinessDateParam(raw: string): BusinessDateJst | null {
  return parseBusinessDateJst(raw);
}

export function parseSlotRef(raw: string): Ref<"slot"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"slot">) : null;
}

export function parseGoodsRef(raw: string): Ref<"goods"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"goods">) : null;
}
