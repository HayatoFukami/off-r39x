import type { UtcInstant } from "../../api-client/types";

export interface Clock {
  /** Current instant in UTC: YYYY-MM-DDTHH:mm:ss(.SSS)?Z */
  now(): UtcInstant;
}

/** Default clock for the running mock. Tests inject their own clock instead. */
export const systemClock: Clock = {
  now: () => new Date(performance.timeOrigin + performance.now()).toISOString() as UtcInstant,
};
