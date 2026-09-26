// Seeded RNG for the sim (mulberry32). The stream state lives in SimState so saves replay identically.
import { SimState } from "./state";

/** Uniform in [0, 1). Advances state.rng. */
export function rand(state: SimState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randInt(state: SimState, n: number): number {
  return Math.floor(rand(state) * n);
}
