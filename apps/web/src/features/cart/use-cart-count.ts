"use client";

import { useSyncExternalStore } from "react";
import { CART_STORAGE_KEY, readCartCount } from "./cart-count";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function getSnapshot(): number | null {
  try {
    return readCartCount(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return null;
  }
}

// The server snapshot is null so that hydration never mismatches.
const getServerSnapshot = (): number | null => null;

export function useCartCount(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
