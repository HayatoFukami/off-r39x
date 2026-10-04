"use client";

import { useSyncExternalStore } from "react";
import type { CartLine, OrderItem } from "../../api-client/types";
import { type CartSnapshot, type CartWriteResult, getBrowserCartStore } from "./cart-store";

export type CartState = { readonly kind: "loading" } | CartSnapshot;

const LOADING: CartState = { kind: "loading" };
// A store that cannot be reached is not an empty Cart: its content is unknown.
const UNREADABLE: CartState = { kind: "corrupted" };
const UNAVAILABLE: CartWriteResult = { kind: "storage_unavailable" };

function subscribe(listener: () => void): () => void {
  const store = getBrowserCartStore();
  return store === null ? () => {} : store.subscribe(listener);
}

function getSnapshot(): CartState {
  const store = getBrowserCartStore();
  return store === null ? UNREADABLE : store.getSnapshot();
}

// The server snapshot and the first render are `loading`, so hydration never mismatches.
const getServerSnapshot = (): CartState => LOADING;

export function useCart(): {
  state: CartState;
  add(line: CartLine): CartWriteResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartWriteResult;
  reset(): CartWriteResult;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    state,
    add: (line) => getBrowserCartStore()?.add(line) ?? UNAVAILABLE,
    setQuantity: (lineKey, quantity) =>
      getBrowserCartStore()?.setQuantity(lineKey, quantity) ?? UNAVAILABLE,
    remove: (lineKey) => getBrowserCartStore()?.remove(lineKey) ?? UNAVAILABLE,
    removeLines: (lineKeys) => getBrowserCartStore()?.removeLines(lineKeys) ?? UNAVAILABLE,
    addFromOrder: (items) => getBrowserCartStore()?.addFromOrder(items) ?? UNAVAILABLE,
    reset: () => getBrowserCartStore()?.reset() ?? UNAVAILABLE,
  };
}
