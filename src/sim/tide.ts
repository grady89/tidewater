// The tide clock. A fixed sinusoidal cycle; the wet-sand band lags behind a retreating tide.
import { TIDE_HI, TIDE_LO, TIDE_PERIOD, WET_SAND_DRY_RATE } from "../config";

const TAU = Math.PI * 2;

export class TideClock {
  /** Phase in radians. Starts at high tide, matching the study. */
  phase = Math.PI * 0.5;
  /** Current water level in world Y. */
  level = TIDE_HI;
  /** Upper edge of the wet-sand band in world Y. Never below `level`; dries slowly as the tide retreats. */
  wetLevel = 0;
  /** High tides passed since the start. */
  cycle = 0;
  /** True only on the frame in which the tide peaks. */
  peaked = false;

  update(dt: number): void {
    const before = this.phase;
    this.phase += dt * (TAU / TIDE_PERIOD);
    this.peaked = Math.floor((before - Math.PI / 2) / TAU) !== Math.floor((this.phase - Math.PI / 2) / TAU);
    if (this.peaked) this.cycle++;
    const t = 0.5 + 0.5 * Math.sin(this.phase);
    this.level = TIDE_LO + (TIDE_HI - TIDE_LO) * t;
    this.wetLevel = Math.max(this.level, this.wetLevel - dt * WET_SAND_DRY_RATE);
  }

  /** 0 at low tide, 1 at high tide. */
  get normalized(): number {
    return (this.level - TIDE_LO) / (TIDE_HI - TIDE_LO);
  }

  /** 0 at high tide, 0.5 at low tide, wrapping at the next high tide. */
  get cycleFraction(): number {
    return (((this.phase - Math.PI / 2) % TAU) + TAU) % TAU / TAU;
  }

  get rising(): boolean {
    return Math.cos(this.phase) > 0;
  }

  get secondsToHighTide(): number {
    return (1 - this.cycleFraction) * TIDE_PERIOD;
  }

  get secondsToLowTide(): number {
    return (((0.5 - this.cycleFraction) % 1) + 1) % 1 * TIDE_PERIOD;
  }
}
