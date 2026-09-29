// Pollution's sources (the sewers' outfalls and cesspits, smokehouses, docks) and what it does: kills oyster beds,
// sours homes, and thins the fish.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import {
  BUILDINGS, DOCK_POLLUTION, FISH_CAP, FISH_DEPLETE_PER_BOAT, FISH_FLOOR, FISH_REGEN, OYSTER_KILL_CYCLES,
  OYSTER_POLLUTION_KILL, POLLUTION_ADVECT, POLLUTION_DECAY, POLLUTION_DIFFUSE, SMOKEHOUSE_POLLUTION,
} from "./balance";
import { at, CELLS, flowFor, stepDrift } from "./fields";
import { cellIndex, Grid } from "./grid";
import { drainSewage } from "./sewers";
import { Building, buildingList, Cell, Emitter, notify, SimState } from "./state";
import { isRising } from "./tide";
import { staffing } from "./workers";

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

/**
 * Settlement: this cycle's pollution sources as per-tick emitters — the sewers' (sim/sewers.ts: outfalls and the
 * cesspits of homes whose waste backs up), then the smokehouses' smoke and the docks' fish waste.
 */
export function routeWaste(state: SimState, grid: Grid): void {
  const buildings = buildingList(state).sort((a, b) => a.id - b.id);
  const emitters: Emitter[] = [];
  drainSewage(state, grid, emitters);
  for (const b of buildings) {
    if (b.kind === "smokehouse" && b.workers > 0) emitters.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: SMOKEHOUSE_POLLUTION * staffing(b) / TICKS_PER_CYCLE });
    const own = BUILDINGS[b.kind].pollution;
    if (own && b.workers > 0 && !b.damaged) emitters.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: own * staffing(b) / TICKS_PER_CYCLE });
    if ((b.kind === "dock" || b.kind === "pier") && b.boats > 0) emitters.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: DOCK_POLLUTION * b.boats / TICKS_PER_CYCLE });
  }
  state.emitters = emitters;
}

/** Every tick: emit, decay, diffuse, and drift with the tide. */
export function tickPollution(state: SimState, grid: Grid, dt: number): void {
  const p = state.fields.pollution;
  // Pollution is a 0..1 fraction (every reader clamps it as one): an emitter fills its cell no further than
  // full, and the drift keeps 1 the ceiling (QA #3).
  for (const e of state.emitters) p[e.k] = Math.min(1, p[e.k] + e.rate * (dt / SIM_TICK));
  stepDrift(p, flowFor(grid), dt, isRising(state.tide), POLLUTION_DECAY, POLLUTION_DIFFUSE, POLLUTION_ADVECT, 1);
}

/** Settlement: fish grounds recover toward a cap that pollution lowers; oyster beds in foul water sicken and die. */
export function settleFields(state: SimState, grid: Grid): void {
  const { fish, pollution, bleach } = state.fields;
  for (let k = 0; k < CELLS; k++) {
    if (!grid.deep[k]) continue;
    const cap = FISH_CAP * Math.max(0, 1 - pollution[k]) * (1 - bleach[k]); // a bleached reef holds fewer fish (Atoll)
    fish[k] += FISH_REGEN * (cap - fish[k]);
    if (fish[k] < FISH_FLOOR) fish[k] = FISH_FLOOR;
  }
  for (const b of buildingList(state)) {
    if (b.kind !== "oysterBed") continue;
    if (at(pollution, b.cells[0]) > OYSTER_POLLUTION_KILL) b.stress++; else b.stress = 0;
    if (b.stress >= OYSTER_KILL_CYCLES) {
      grid.remove(b);
      notify(state, "An oyster bed died in foul water");
    }
  }
}

/** Boats thin the ground they fished. */
export function depleteGround(state: SimState, harbour: Building): void {
  if (!harbour.ground) return;
  const k = cellIndex(harbour.ground.i, harbour.ground.j);
  state.fields.fish[k] = Math.max(FISH_FLOOR, state.fields.fish[k] - FISH_DEPLETE_PER_BOAT * harbour.boats);
}

export function fishAt(state: SimState, c: Cell): number {
  return at(state.fields.fish, c);
}

export function pollutionAt(state: SimState, c: Cell): number {
  return at(state.fields.pollution, c);
}
