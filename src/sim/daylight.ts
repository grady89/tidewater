// Time of day as a function of sim time. The view lights the scene from `duskAt`; the sim uses `isDaytime` for
// swimming and night risk. Late morning at the start of each day, full dusk half a day later.
import { DAY_CYCLES, TIDE_PERIOD } from "../config";

/** The study's default slider position: late morning. Used as the daytime floor. */
export const DUSK_MIN = 0.15;
/** Above this much dusk it counts as night. */
export const NIGHT_DUSK = 0.6;

export function dayFraction(time: number): number {
  return (time / (DAY_CYCLES * TIDE_PERIOD)) % 1;
}

export function duskAt(time: number): number {
  const d = dayFraction(time);
  return DUSK_MIN + (1 - DUSK_MIN) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (d - 0.25)));
}

export function isDaytime(time: number): boolean {
  return duskAt(time) < NIGHT_DUSK;
}
