import type { Scenario } from "./scenario";

export type Sleep = (ms: number) => Promise<void>;

/** Default timer for the running mock. Tests inject a recorder instead. */
export const defaultSleep: Sleep = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits once with the scenario's long latency, or not at all when latency is none. */
export function applyLatency(sleep: Sleep, scenario: Scenario): Promise<void> {
  if (scenario.latency === "long") {
    return sleep(scenario.latencyLongMs);
  }
  return Promise.resolve();
}
