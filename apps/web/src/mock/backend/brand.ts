import type { BusinessDateJst, Ref, UtcInstant } from "../../api-client/types";

// The persisted mock data stores plain strings. These helpers re-attach the nominal view-model
// types at the boundary where stored values become API results.

export const asRef = <T extends string>(value: string): Ref<T> => value as Ref<T>;
export const asUtc = (value: string): UtcInstant => value as UtcInstant;
export const asBusinessDate = (value: string): BusinessDateJst => value as BusinessDateJst;
