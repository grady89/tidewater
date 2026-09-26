// One fixed-timestep step of the ledger. Frame rate never enters here.
import { HIGH_WATER_MARK, LOW_WATER_MARK, SIM_TICK, TIDE_PERIOD } from "../config";
import { boatsReturn, boatsSail, settleCycle } from "./economy";
import { Grid } from "./grid";
import { updateNetwork } from "./network";
import { Phase, SimState } from "./state";
import { tickTide } from "./tide";

export function phaseFor(level: number): Phase {
  return level > HIGH_WATER_MARK ? "high" : level < LOW_WATER_MARK ? "low" : "slack";
}

export function tick(state: SimState, grid: Grid, dt = SIM_TICK): void {
  state.time += dt;
  state.tick++;
  tickTide(state.tide, dt);
  updateNetwork(state, grid, state.tide.level);

  const phase = phaseFor(state.tide.level);
  if (phase !== state.phase) {
    const prev = state.phase;
    state.phase = phase;
    if (phase === "high") boatsSail(state);
    if (prev === "high") boatsReturn(state);
  }
  if (state.tide.peaked) settleCycle(state, grid);
}

/** Advance in fixed ticks until `cycles` more high tides have passed (so the peak tick is always included). */
export function advanceCycles(state: SimState, grid: Grid, cycles: number): void {
  const target = state.tide.cycle + cycles;
  const cap = Math.ceil((cycles + 1) * TIDE_PERIOD / SIM_TICK);
  for (let k = 0; k < cap && state.tide.cycle < target; k++) tick(state, grid);
}
