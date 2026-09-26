// The tide clock. A fixed sinusoidal cycle; the wet-sand band lags behind a retreating tide.
import { TIDE_HI, TIDE_LO, TIDE_PERIOD, WET_SAND_DRY_RATE } from "../config";

export class TideClock {
  /** Phase in radians. Starts at high tide, matching the study. */
  phase = Math.PI * 0.5;
  /** Current water level in world Y. */
  level = TIDE_HI;
  /** Upper edge of the wet-sand band in world Y. Never below `level`; dries slowly as the tide retreats. */
  wetLevel = 0;

  update(dt: number): void {
    this.phase += dt * (2 * Math.PI / TIDE_PERIOD);
    const t = 0.5 + 0.5 * Math.sin(this.phase);
    this.level = TIDE_LO + (TIDE_HI - TIDE_LO) * t;
    this.wetLevel = Math.max(this.level, this.wetLevel - dt * WET_SAND_DRY_RATE);
  }

  /** 0 at low tide, 1 at high tide. */
  get normalized(): number {
    return (this.level - TIDE_LO) / (TIDE_HI - TIDE_LO);
  }
}
