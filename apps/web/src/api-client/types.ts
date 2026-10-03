// Shared presentation-facing types (S1 subset). Money is a decimal string (DEV-TS-006).

export type Ref<T extends string> = string & { readonly __ref: T };

export type Money = { readonly amount: string; readonly currency: string };

export type UtcInstant = string & { readonly __utc: true };

export type BusinessDateJst = string & { readonly __jst: true };

export type SaleAvailability =
  | { kind: "ON_SALE"; maxSelectableQuantity: number | null }
  | { kind: "BEFORE_SALES"; startsAt: UtcInstant }
  | { kind: "SALES_ENDED" }
  | { kind: "SUSPENDED" }
  | { kind: "SOLD_OUT" }
  | { kind: "INSUFFICIENT_QUANTITY"; maxSelectableQuantity: number }
  | { kind: "PURCHASE_LIMIT_EXCEEDED" };
