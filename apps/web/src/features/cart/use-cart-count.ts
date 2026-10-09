"use client";

import { useSyncExternalStore } from "react";
import { cartTotalQuantity } from "./cart-model";
import { getBrowserCartStore } from "./cart-store";

function subscribe(listener: () => void): () => void {
  const store = getBrowserCartStore();
  return store === null ? () => {} : store.subscribe(listener);
}

function getSnapshot(): number | null {
  const store = getBrowserCartStore();
  if (store === null) return null;
  const snapshot = store.getSnapshot();
  return snapshot.kind === "ready" ? cartTotalQuantity(snapshot.cart) : null;
}

// The server snapshot is null so that hydration never mismatches.
const getServerSnapshot = (): number | null => null;

/** Total quantity from the shared browser store; null when it cannot be read (never shown as a number). */
export function useCartCount(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
