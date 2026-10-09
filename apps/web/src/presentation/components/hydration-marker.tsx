"use client";

import { useEffect } from "react";

// Token-free readiness signal for tests: set after the same commit that hydrates the page.
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
