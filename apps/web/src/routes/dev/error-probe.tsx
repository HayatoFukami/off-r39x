import { useEffect, useState } from "react";

// Test support: throws during render (after mount) so that the route error boundary can be checked for leaks.
// The message is a fixed synthetic string, not a secret.
export default function ErrorProbeRoute() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(true);
  }, []);
  if (armed) {
    throw new Error("r39x-error-probe: SENSITIVE-MARKER-9f3a C:secretpathleak.ts");
  }
  return <p>error probe</p>;
}
