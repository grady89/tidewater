// The tide clock over state.tide. Each half-cycle eases between the previous extreme and the next; every
// SPRING_EVERY-th cycle uses the spring extremes, so the shape stays continuous through a spring tide.
import { SPRING_EVERY, SPRING_HI, SPRING_LO, TIDE_HI, TIDE_LO, TIDE_PERIOD, WET_SAND_DRY_RATE } from "../config";
import { TideState } from "./state";

const TAU = Math.PI * 2;

/** Is cycle number `k` (the k-th high tide since the start) a spring tide? */
export function isSpringCycle(k: number): boolean {
  return k > 0 && k % SPRING_EVERY === 0;
}
export function peakLevel(k: number): number {
  return isSpringCycle(k) ? SPRING_HI : TIDE_HI;
}
export function troughLevel(k: number): number {
  return isSpringCycle(k) ? SPRING_LO : TIDE_LO;
}

/** 0 at high tide, 0.5 at low tide, wrapping at the next high tide. */
export function cycleFraction(t: TideState): number {
  return (((t.phase - Math.PI / 2) % TAU) + TAU) % TAU / TAU;
}

/** Water level for a clock position: eased between the extremes of the current half-cycle. */
export function levelAt(t: TideState): number {
  const f = cycleFraction(t);
  let a: number, b: number, u: number;
  if (f < 0.5) { a = peakLevel(t.cycle); b = troughLevel(t.cycle + 1); u = f / 0.5; }
  else { a = troughLevel(t.cycle + 1); b = peakLevel(t.cycle + 1); u = (f - 0.5) / 0.5; }
  return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * u));
}

export function tickTide(t: TideState, dt: number): void {
  const before = t.phase;
  t.phase += dt * (TAU / TIDE_PERIOD);
  t.peaked = Math.floor((before - Math.PI / 2) / TAU) !== Math.floor((t.phase - Math.PI / 2) / TAU);
  if (t.peaked) t.cycle++;
  t.level = t.override ?? levelAt(t);
  t.wetLevel = Math.max(t.level, t.wetLevel - dt * WET_SAND_DRY_RATE);
}

/** 0 at the ordinary low tide, 1 at the ordinary high tide (spring tides go outside 0..1). */
export function tideNormalized(t: TideState): number {
  return (t.level - TIDE_LO) / (TIDE_HI - TIDE_LO);
}

export function isRising(t: TideState): boolean {
  return cycleFraction(t) >= 0.5;
}

export function secondsToHighTide(t: TideState): number {
  return (1 - cycleFraction(t)) * TIDE_PERIOD;
}

export function secondsToLowTide(t: TideState): number {
  return (((0.5 - cycleFraction(t)) % 1) + 1) % 1 * TIDE_PERIOD;
}

/** The upcoming peak belongs to a spring cycle. */
/** High tides until the next spring peak, counting the upcoming one as 1. */
export function cyclesToSpring(t: TideState): number {
  let k = t.cycle + 1, n = 1;
  while (!isSpringCycle(k)) { k++; n++; }
  return n;
}

/**
 * Where the clock stands within the current shift, 0..1: 0 as the water crossed into high/low water, 1 as it
 * crosses back out. Solved numerically on the eased tide shape so the view can animate trips against it.
 */
export function phaseProgress(t: TideState, highMark: number, lowMark: number): number {
  const f = cycleFraction(t);
  const lvl = (frac: number) => levelAt({ ...t, phase: Math.PI / 2 + frac * TAU, override: null });
  const cross = (target: number, from: number, to: number, rising: boolean): number => {
    // Bisection on the monotone half-cycle segment between `from` and `to`.
    let lo = from, hi = to;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if ((lvl(m) > target) === rising) hi = m; else lo = m; }
    return (lo + hi) / 2;
  };
  const level = t.override ?? lvl(f);
  if (level > highMark) {
    const enter = cross(highMark, 0.5, 1, true) - 1;   // rising crossing, expressed relative to the peak at 0
    const exit = cross(highMark, 0, 0.5, false);       // falling crossing
    const pos = f >= 0.5 ? f - 1 : f;
    return Math.min(1, Math.max(0, (pos - enter) / (exit - enter)));
  }
  if (level < lowMark) {
    const enter = cross(lowMark, 0, 0.5, false);
    const exit = cross(lowMark, 0.5, 1, true);
    return Math.min(1, Math.max(0, (f - enter) / (exit - enter)));
  }
  return 0;
}

/** Fate of a deck at `floorY`: which tides put it under water. */
export function floodFate(floorY: number): "safe" | "spring" | "always" {
  if (floorY <= TIDE_HI) return "always";
  if (floorY <= SPRING_HI) return "spring";
  return "safe";
}
