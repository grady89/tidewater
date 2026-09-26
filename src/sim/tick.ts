// One fixed-timestep step of the ledger. Frame rate never enters here.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import { Grid } from "./grid";
import { updateNetwork } from "./network";
import { SimState } from "./state";
import { tickTide } from "./tide";

export function tick(state: SimState, grid: Grid, dt = SIM_TICK): void {
  state.time += dt;
  state.tick++;
  tickTide(state.tide, dt);
  const stats = updateNetwork(state, grid, state.tide.level);
  if (state.tide.peaked) state.score = { cycle: state.tide.cycle, reached: stats.reached, houses: stats.houses };
}

/** Advance in fixed ticks until `cycles` more high tides have passed (so the peak tick is always included). */
export function advanceCycles(state: SimState, grid: Grid, cycles: number): void {
  const target = state.tide.cycle + cycles;
  const cap = Math.ceil((cycles + 1) * TIDE_PERIOD / SIM_TICK);
  for (let k = 0; k < cap && state.tide.cycle < target; k++) tick(state, grid);
}
