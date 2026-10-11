"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** Moves focus to the error summary each time a failed submit asks for it (SPEC-050 25). */
export function useErrorSummaryFocus(): {
  summaryRef: RefObject<HTMLDivElement | null>;
  requestFocus: () => void;
} {
  const summaryRef = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    if (requests > 0) summaryRef.current?.focus();
  }, [requests]);

  const requestFocus = useCallback((): void => {
    setRequests((count) => count + 1);
  }, []);

  return { summaryRef, requestFocus };
}
