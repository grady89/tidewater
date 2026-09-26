// Waste, outfalls, treatment, and what pollution does: kills oyster beds, sours homes, and thins the fish.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import {
  BUILDINGS, DOCK_POLLUTION, FISH_CAP, FISH_DEPLETE_PER_BOAT, FISH_FLOOR, FISH_REGEN, OYSTER_KILL_CYCLES,
  OYSTER_POLLUTION_KILL, POLLUTION_ADVECT, POLLUTION_DECAY, POLLUTION_DIFFUSE, SMOKEHOUSE_POLLUTION,
  WASTE_BACKLOG_DRAIN, WASTE_PER_RESIDENT,
} from "./balance";
import { at, buildFlow, CELLS, Flow, stepDrift } from "./fields";
import { cellIndex, Grid } from "./grid";
import { Building, buildingList, Cell, notify, SimState } from "./state";
import { isRising } from "./tide";
import { staffing } from "./workers";

const flows = new WeakMap<Grid, Flow>();
function flowFor(grid: Grid): Flow {
  let f = flows.get(grid);
  if (!f) { f = buildFlow(grid); flows.set(grid, f); }
  return f;
}

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

/** Fraction of a home's waste neutralised by treatment plants in range: the treatment coverage layer. */
export function treatedFraction(state: SimState, home: Building): number {
  return at(state.fields.coverage.treatment, home.cells[0]);
}

/**
 * Settlement: route this cycle's waste to the outfalls as per-tick emitters (plus the smokehouses' and docks'
 * own smoke and fish waste). Waste with no outfall backs up and sours the town.
 */
export function routeWaste(state: SimState): void {
  const buildings = buildingList(state).sort((a, b) => a.id - b.id);
  let untreated = 0;
  for (const b of buildings) {
    if (BUILDINGS[b.kind].residents === 0 || b.residents === 0) continue;
    untreated += b.residents * WASTE_PER_RESIDENT * (1 - treatedFraction(state, b));
  }
  const outfalls = buildings.filter(b => b.kind === "outfall");
  const emitters: { k: number; rate: number }[] = [];
  if (outfalls.length) {
    // The outfalls take this cycle's waste plus a share of any backlog, which goes into the sea too.
    const drained = Math.min(state.wasteBacklog, WASTE_BACKLOG_DRAIN);
    state.wasteBacklog -= drained;
    const each = (untreated + drained) / outfalls.length / TICKS_PER_CYCLE;
    for (const o of outfalls) emitters.push({ k: cellIndex(o.cells[0].i, o.cells[0].j), rate: each });
  } else {
    state.wasteBacklog += untreated;
  }
  for (const b of buildings) {
    if (b.kind === "smokehouse" && b.workers > 0) emitters.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: SMOKEHOUSE_POLLUTION * staffing(b) / TICKS_PER_CYCLE });
    if ((b.kind === "dock" || b.kind === "pier") && b.boats > 0) emitters.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: DOCK_POLLUTION * b.boats / TICKS_PER_CYCLE });
  }
  state.emitters = emitters;
}

/** Every tick: emit, decay, diffuse, and drift with the tide. */
export function tickPollution(state: SimState, grid: Grid, dt: number): void {
  const p = state.fields.pollution;
  for (const e of state.emitters) p[e.k] += e.rate * (dt / SIM_TICK);
  stepDrift(p, flowFor(grid), dt, isRising(state.tide), POLLUTION_DECAY, POLLUTION_DIFFUSE, POLLUTION_ADVECT);
}

/** Settlement: fish grounds recover toward a cap that pollution lowers; oyster beds in foul water sicken and die. */
export function settleFields(state: SimState, grid: Grid): void {
  const { fish, pollution } = state.fields;
  for (let k = 0; k < CELLS; k++) {
    if (!grid.deep[k]) continue;
    const cap = FISH_CAP * Math.max(0, 1 - pollution[k]);
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
