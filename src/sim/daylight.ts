// Time of day as a function of sim time. The view lights the scene from `duskAt` and places the sun and moon
// from `sunVector`; the sim uses `isDaytime` for swimming and night risk. A day is DAY_CYCLES tide cycles:
// dawn at the start of each day, noon a quarter in, sunset half way, midnight three quarters in.
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

/** Is the sun above the horizon (the first half of the day, sunrise to sunset)? */
export function isSunUp(time: number): boolean {
  return sunVector(dayFraction(time)).y > 0;
}

export interface Vec3 { x: number; y: number; z: number }

function unit(v: Vec3): Vec3 { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; }
/** Where the sun stands at noon: the study's late-morning direction, so the settled look is the noon look. */
export const NOON_SUN: Vec3 = unit({ x: -0.321, y: 0.833, z: 0.450 });
/** The east point of the sun's circle: horizontal, perpendicular to the noon direction. */
export const EAST: Vec3 = unit({ x: NOON_SUN.z, y: 0, z: -NOON_SUN.x });

/**
 * The sun's direction for a day fraction: a great circle from the east horizon (d = 0) through the noon point
 * (d = 0.25) to the west horizon (d = 0.5) and under the world at night. The moon is opposite.
 */
export function sunVector(d: number): Vec3 {
  const t = 2 * Math.PI * d;
  const c = Math.cos(t), s = Math.sin(t);
  return { x: c * EAST.x + s * NOON_SUN.x, y: c * EAST.y + s * NOON_SUN.y, z: c * EAST.z + s * NOON_SUN.z };
}

export function moonVector(d: number): Vec3 {
  const v = sunVector(d);
  return { x: -v.x, y: -v.y, z: -v.z };
}
