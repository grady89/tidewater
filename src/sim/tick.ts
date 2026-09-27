// One fixed-timestep step of the ledger. Frame rate never enters here.
import { SIM_TICK, TIDE_PERIOD } from "../config";

import { checkAchievements } from "./achievements";
import { biomeFor } from "./biomes";
import { settleCycle, shiftEnd, shiftStart } from "./economy";
import { rollStorm, rollTsunami, tickTsunami } from "./events";
import { tickFire } from "./fire";
import { Grid } from "./grid";
import { updateNetwork } from "./network";
import { tickPollution } from "./pollution";
import { rollIncidents, tickSharks, updateSwimmers } from "./sharks";
import { notify, Phase, SimState } from "./state";
import { isSpringCycle, tickTide } from "./tide";
import { BASE_TIDES, Tides } from "./tides";

export function phaseFor(level: number, tides: Tides = BASE_TIDES): Phase {
  return level > tides.highMark ? "high" : level < tides.lowMark ? "low" : "slack";
}

export function tick(state: SimState, grid: Grid, dt = SIM_TICK): void {
  state.time += dt;
  state.tick++;
  tickTide(state.tide, dt);
  updateNetwork(state, grid, state.tide.level);
  tickTsunami(state, grid, dt);
  tickPollution(state, grid, dt);
  tickSharks(state, grid, dt, state.sharkEmitters);
  tickFire(state, grid, dt, state.storm.active);

  const phase = phaseFor(state.tide.level, grid.tides);
  if (phase !== state.phase) {
    const prev = state.phase;
    state.phase = phase;
    if (prev !== "slack") shiftEnd(state, grid, prev);
    if (prev === "high") { rollIncidents(state, grid); state.swimmers = []; }
    if (phase !== "slack" && !state.storm.active && !state.tsunami.stage) shiftStart(state, grid, phase);
    if (phase === "high" && !state.storm.active) updateSwimmers(state, grid);
  }
  biomeFor(state).tick?.(state, grid, dt);
  if (state.tide.peaked) {
    if (isSpringCycle(state.tide.cycle)) notify(state, "Spring tide: the water runs higher and lower than usual");
    settleCycle(state, grid);
    biomeFor(state).settle?.(state, grid);
    rollStorm(state, grid);
    rollTsunami(state, grid);
  }
  if (state.tick % 20 === 0) checkAchievements(state, grid);
}

/** Advance in fixed ticks until `cycles` more high tides have passed (so the peak tick is always included). */
export function advanceCycles(state: SimState, grid: Grid, cycles: number): void {
  const target = state.tide.cycle + cycles;
  const cap = Math.ceil((cycles + 1) * TIDE_PERIOD / SIM_TICK);
  for (let k = 0; k < cap && state.tide.cycle < target; k++) tick(state, grid);
}
