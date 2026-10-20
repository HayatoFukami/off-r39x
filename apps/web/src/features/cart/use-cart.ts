"use client";

import { useSyncExternalStore } from "react";
import type { CartLine, OrderItem } from "../../api-client/types";
import { getBrowserCartLifecycle } from "./cart-lifecycle";
import {
  type CartAddResult,
  type CartSnapshot,
  type CartWriteResult,
  getBrowserCartStore,
} from "./cart-store";

export type CartState = { readonly kind: "loading" } | { readonly kind: "blocked" } | CartSnapshot;

const LOADING: CartState = { kind: "loading" };
const BLOCKED: CartState = { kind: "blocked" };
// A store that cannot be reached is not an empty Cart: its content is unknown.
const UNREADABLE: CartState = { kind: "corrupted" };
const UNAVAILABLE: CartWriteResult = { kind: "storage_unavailable" };

function subscribe(listener: () => void): () => void {
  const store = getBrowserCartStore();
  const lifecycle = getBrowserCartLifecycle();
  const unsubscribeCart = store?.subscribe(listener) ?? (() => {});
  const unsubscribeLifecycle = lifecycle?.subscribe(listener) ?? (() => {});
  return () => {
    unsubscribeCart();
    unsubscribeLifecycle();
  };
}

function getSnapshot(): CartState {
  const lifecycle = getBrowserCartLifecycle();
  if (lifecycle === null) return UNREADABLE;
  if (lifecycle.getSnapshot().kind === "blocked") return BLOCKED;
  const store = getBrowserCartStore();
  return store === null ? UNREADABLE : store.getSnapshot();
}

function writableStore() {
  return getBrowserCartLifecycle()?.getSnapshot().kind === "ready" ? getBrowserCartStore() : null;
}

function writeCart<T extends CartWriteResult | CartAddResult>(operation: () => T): T {
  const result = operation();
  if (result.kind === "storage_unavailable") getBrowserCartLifecycle()?.block();
  return result;
}

// The server snapshot and the first render are `loading`, so hydration never mismatches.
const getServerSnapshot = (): CartState => LOADING;

export function useCart(): {
  state: CartState;
  add(line: CartLine): CartAddResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  subtractLines(lines: readonly CartLine[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartAddResult;
  reset(): CartWriteResult;
  clear(): CartWriteResult;
  recover(provenance: "guest" | "authenticated" | "unknown"): boolean;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    state,
    add: (line) => writeCart(() => writableStore()?.add(line) ?? UNAVAILABLE),
    setQuantity: (lineKey, quantity) =>
      writeCart(() => writableStore()?.setQuantity(lineKey, quantity) ?? UNAVAILABLE),
    remove: (lineKey) => writeCart(() => writableStore()?.remove(lineKey) ?? UNAVAILABLE),
    removeLines: (lineKeys) =>
      writeCart(() => writableStore()?.removeLines(lineKeys) ?? UNAVAILABLE),
    subtractLines: (lines) => writeCart(() => writableStore()?.subtractLines(lines) ?? UNAVAILABLE),
    addFromOrder: (items) => writeCart(() => writableStore()?.addFromOrder(items) ?? UNAVAILABLE),
    reset: () => writeCart(() => writableStore()?.reset() ?? UNAVAILABLE),
    clear: () => writeCart(() => getBrowserCartStore()?.clear() ?? UNAVAILABLE),
    recover: (provenance) => getBrowserCartLifecycle()?.recover(provenance) ?? false,
  };
}
