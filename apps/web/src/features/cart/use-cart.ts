"use client";

import { useRef, useSyncExternalStore } from "react";
import type { CartLine, OrderItem } from "../../api-client/types";
import type { CartRecoveryResult } from "./cart-lifecycle";
import { getBrowserCartLifecycle, recoverBrowserCartLifecycle } from "./cart-lifecycle";
import {
  type CartAddResult,
  type CartSnapshot,
  type CartStore,
  type CartWriteResult,
  getBrowserCartStore,
} from "./cart-store";

export type CartState =
  | { readonly kind: "loading" }
  | { readonly kind: "busy" }
  | { readonly kind: "blocked" }
  | { readonly kind: "storage_unavailable" }
  | CartSnapshot;
export type CartWriteOutcome = CartWriteResult | { kind: "busy" } | { kind: "blocked" };
export type CartAddOutcome = CartAddResult | { kind: "busy" } | { kind: "blocked" };

const LOADING: CartState = { kind: "loading" };
const BUSY: CartState = { kind: "busy" };
const BLOCKED: CartState = { kind: "blocked" };
const STORAGE_UNAVAILABLE: CartState = { kind: "storage_unavailable" };
const UNAVAILABLE = { kind: "storage_unavailable" } as const;

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
  if (lifecycle === null) return STORAGE_UNAVAILABLE;
  const transition = lifecycle.getSnapshot();
  if (transition.kind === "blocked") return BLOCKED;
  if (transition.kind === "busy") return BUSY;
  const store = getBrowserCartStore();
  return store === null ? STORAGE_UNAVAILABLE : store.getSnapshot();
}

function writeCart<T extends CartWriteResult | CartAddResult>(
  operation: (store: CartStore) => T,
): T | { kind: "busy" } | { kind: "blocked" } | { kind: "storage_unavailable" } {
  const lifecycle = getBrowserCartLifecycle();
  if (lifecycle === null) return UNAVAILABLE;
  const transition = lifecycle.getSnapshot();
  if (transition.kind === "busy") return { kind: "busy" };
  if (transition.kind === "blocked") return { kind: "blocked" };
  const store = getBrowserCartStore();
  if (store === null) return UNAVAILABLE;
  const result = operation(store);
  if (result.kind === "storage_unavailable") getBrowserCartLifecycle()?.block();
  return result;
}

// The server snapshot and the first render are `loading`, so hydration never mismatches.
const getServerSnapshot = (): CartState => LOADING;

export function useCart(): {
  state: CartState;
  add(line: CartLine): CartAddOutcome;
  setQuantity(lineKey: string, quantity: number): CartWriteOutcome;
  remove(lineKey: string): CartWriteOutcome;
  removeLines(lineKeys: readonly string[]): CartWriteOutcome;
  subtractLines(lines: readonly CartLine[]): CartWriteOutcome;
  addFromOrder(items: readonly OrderItem[]): CartAddOutcome;
  reset(): CartWriteOutcome;
  clear(): CartWriteOutcome;
  recover(provenance: "guest" | "authenticated" | "unknown"): Promise<CartRecoveryResult>;
} {
  const initiallyUnavailable = useRef(getBrowserCartLifecycle() === null);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    state,
    add: (line) => writeCart((store) => store.add(line)),
    setQuantity: (lineKey, quantity) => writeCart((store) => store.setQuantity(lineKey, quantity)),
    remove: (lineKey) => writeCart((store) => store.remove(lineKey)),
    removeLines: (lineKeys) => writeCart((store) => store.removeLines(lineKeys)),
    subtractLines: (lines) => writeCart((store) => store.subtractLines(lines)),
    addFromOrder: (items) => writeCart((store) => store.addFromOrder(items)),
    reset: () => writeCart((store) => store.reset()),
    clear: () => writeCart((store) => store.clear()),
    recover: async (provenance) => {
      const recovered = await recoverBrowserCartLifecycle(provenance);
      // Initial storage denial also prevented Header/Auth subscriptions. Reinitialize all wiring.
      if (recovered === "recovered" && initiallyUnavailable.current) window.location.reload();
      return recovered;
    },
  };
}
