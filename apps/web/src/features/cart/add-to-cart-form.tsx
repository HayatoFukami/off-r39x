"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useId, useState } from "react";
import type { CartLine, Money } from "../../api-client/types";
import { CART_HREF } from "../../config/site";
import { Button } from "../../presentation/components/ui/button";
import { Input } from "../../presentation/components/ui/input";
import { copy } from "../../presentation/copy/ja";
import type { CartWriteResult } from "./cart-store";
import { formatDisplayTotal, parseQuantityInput, type QuantityParse } from "./quantity";
import { useCart } from "./use-cart";

// Quantity + "add to Cart" control shared by the Entry sales page and the Goods detail page
// (SPEC-050 12.1, 14.2, 25). It stores a reference and a quantity only; adding is not a purchase.

export type AddResult = { kind: "idle" } | CartWriteResult;

function invalidMessage(parse: QuantityParse, max: number | null): string | null {
  if (parse.kind === "valid") return null;
  return parse.reason === "above_max" && max !== null
    ? copy.quantity.exceedsMax(max)
    : copy.quantity.invalid;
}

/** Page-level result: one status live region that is always present, and an alert when the write did not happen. */
export function AddResultNotice({ result }: { result: AddResult }) {
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm font-medium text-tone-success-fg">
        {result.kind === "ok" ? copy.sales.addSucceeded : ""}
      </p>
      {result.kind === "corrupted" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-1 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          <p>{copy.cart.corrupted.title}</p>
          <Link href={CART_HREF} prefetch={false} className="underline underline-offset-4">
            {copy.cart.corrupted.goToCart}
          </Link>
        </div>
      ) : null}
      {result.kind === "storage_unavailable" ? (
        <p
          role="alert"
          className="rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          {copy.sales.addFailed}
        </p>
      ) : null}
    </div>
  );
}

export type AddToCartFormProps = {
  /** Builds the Cart line (reference and quantity only) for a validated quantity. */
  buildLine: (quantity: number) => CartLine;
  unitPrice: Money;
  /** The announced maximum (ON_SALE only); null announces none and the UI invents none. */
  maxSelectableQuantity: number | null;
  addable: boolean;
  /** Element that holds the reason text of a disabled add; tied to the button by aria-describedby. */
  reasonId: string;
  onResult: (result: AddResult) => void;
};

export function AddToCartForm({
  buildLine,
  unitPrice,
  maxSelectableQuantity,
  addable,
  reasonId,
  onResult,
}: AddToCartFormProps) {
  const cart = useCart();
  const [raw, setRaw] = useState("1");
  const baseId = useId();
  const inputId = `${baseId}-quantity`;
  const errorId = `${baseId}-error`;
  const hintId = `${baseId}-hint`;

  const parse = parseQuantityInput(raw, maxSelectableQuantity);
  const error = invalidMessage(parse, maxSelectableQuantity);
  const invalid = error !== null;

  const describedBy = [
    maxSelectableQuantity !== null ? hintId : null,
    invalid ? errorId : null,
  ].filter((id): id is string => id !== null);
  const buttonDescribedBy = [invalid ? errorId : null, addable ? null : reasonId].filter(
    (id): id is string => id !== null,
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setRaw(event.target.value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!addable || parse.kind !== "valid") return;
    try {
      onResult(cart.add(buildLine(parse.quantity)));
    } catch (failure) {
      if (!(failure instanceof RangeError)) throw failure;
      onResult({ kind: "storage_unavailable" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {copy.quantity.label}
        </label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          value={raw}
          onChange={handleChange}
          disabled={!addable}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
        />
        <Button
          type="submit"
          disabled={!addable || invalid}
          aria-describedby={buttonDescribedBy.length > 0 ? buttonDescribedBy.join(" ") : undefined}
        >
          {copy.sales.add}
        </Button>
      </div>
      {maxSelectableQuantity !== null ? (
        <p id={hintId} className="text-sm text-foreground/80">
          {copy.quantity.guidance(maxSelectableQuantity)}
        </p>
      ) : null}
      {error !== null ? (
        <p id={errorId} className="text-sm text-tone-failure-fg">
          {error}
        </p>
      ) : null}
      <p className="text-sm">
        <span className="font-medium">{copy.sales.displayTotalLabel}</span>{" "}
        {parse.kind === "valid" ? (
          <span>{formatDisplayTotal(unitPrice, parse.quantity)}</span>
        ) : null}
      </p>
      <p className="text-xs text-foreground/70">{copy.sales.displayTotalNote}</p>
    </form>
  );
}
