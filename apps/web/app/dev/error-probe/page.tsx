"use client";

import { useEffect, useState } from "react";

// Test support: throws during render (after mount) so that app/error.tsx can be checked for leaks.
// The message is a fixed synthetic string, not a secret.
export default function ErrorProbePage() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(true);
  }, []);
  if (armed) {
    throw new Error("r39x-error-probe: SENSITIVE-MARKER-9f3a C:\\secret\\path\\leak.ts");
  }
  return <p>error probe</p>;
}
