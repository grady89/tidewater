// The tide clock: a fixed sinusoidal cycle over state.tide. The wet-sand band lags behind a retreating tide.
import { TIDE_HI, TIDE_LO, TIDE_PERIOD, WET_SAND_DRY_RATE } from "../config";
import { TideState } from "./state";

const TAU = Math.PI * 2;

export function tickTide(t: TideState, dt: number): void {
  const before = t.phase;
  t.phase += dt * (TAU / TIDE_PERIOD);
  t.peaked = Math.floor((before - Math.PI / 2) / TAU) !== Math.floor((t.phase - Math.PI / 2) / TAU);
  if (t.peaked) t.cycle++;
  const k = 0.5 + 0.5 * Math.sin(t.phase);
  t.level = t.override ?? TIDE_LO + (TIDE_HI - TIDE_LO) * k;
  t.wetLevel = Math.max(t.level, t.wetLevel - dt * WET_SAND_DRY_RATE);
}

/** 0 at low tide, 1 at high tide. */
export function tideNormalized(t: TideState): number {
  return (t.level - TIDE_LO) / (TIDE_HI - TIDE_LO);
}

/** 0 at high tide, 0.5 at low tide, wrapping at the next high tide. */
export function cycleFraction(t: TideState): number {
  return (((t.phase - Math.PI / 2) % TAU) + TAU) % TAU / TAU;
}

export function isRising(t: TideState): boolean {
  return Math.cos(t.phase) > 0;
}

export function secondsToHighTide(t: TideState): number {
  return (1 - cycleFraction(t)) * TIDE_PERIOD;
}

export function secondsToLowTide(t: TideState): number {
  return (((0.5 - cycleFraction(t)) % 1) + 1) % 1 * TIDE_PERIOD;
}
