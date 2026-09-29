// Beaches and sharks. Fish waste from markets and busy docks feeds a shark-risk field over the water; shark nets
// absorb it. Residents near a beach swim at high water in daylight; at the end of that shift each beach rolls for
// an incident against the risk in the water beside it. Injuries keep people off work until a clinic (or time)
// heals them; homes near an incident grieve for a few cycles.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import {
  BUILDINGS, CLINIC_HEAL_PER_CYCLE, INCIDENT_SCALE, INJURY_MEMORY, INJURY_NATURAL_CYCLES, INJURY_RADIUS, LIFEGUARD_CUT,
  NIGHT_RISK, SHARK_ADVECT, SHARK_DECAY, SHARK_DIFFUSE, SHARK_DOCK, SHARK_MARKET, SWIM_FRACTION, SWIM_RADIUS,
} from "./balance";
import { biomeFor } from "./biomes";
import { isDaytime } from "./daylight";
import { at, CELLS, flowFor, stepDrift } from "./fields";
import { cellIndex, Grid, HALF } from "./grid";
import { rand } from "./rng";
import { buildingList, Cell, notify, SimState } from "./state";
import { isRising } from "./tide";
import { levelCapacity } from "./upgrades";
import { staffing } from "./workers";

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

function within(c: Cell, cells: Cell[], radius: number): boolean {
  return cells.some(x => Math.abs(x.i - c.i) <= radius && Math.abs(x.j - c.j) <= radius);
}

/** Per-tick risk sources for the cycle, from the settlement's building list. */
export function sharkSources(state: SimState): { k: number; rate: number }[] {
  const out: { k: number; rate: number }[] = [];
  for (const b of buildingList(state)) {
    if (b.kind === "market" && b.workers > 0) out.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: SHARK_MARKET * staffing(b) / TICKS_PER_CYCLE });
    if ((b.kind === "dock" || b.kind === "pier") && b.boats > 0) out.push({ k: cellIndex(b.cells[0].i, b.cells[0].j), rate: SHARK_DOCK * b.boats / TICKS_PER_CYCLE });
  }
  return out;
}

/** Every tick: emit, drift with the tide, keep to the water, and let the nets swallow what reaches them. */
export function tickSharks(state: SimState, grid: Grid, dt: number, sources: { k: number; rate: number }[]): void {
  if (biomeFor(state).sharks === false) return; // no sharks on this coast: the field stays at zero
  const f = state.fields.shark;
  for (const s of sources) f[s.k] += s.rate * (dt / SIM_TICK);
  stepDrift(f, flowFor(grid), dt, isRising(state.tide), SHARK_DECAY, SHARK_DIFFUSE, SHARK_ADVECT);
  for (let k = 0; k < CELLS; k++) if (!grid.water[k]) f[k] = 0;
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].stopsPredators) f[cellIndex(b.cells[0].i, b.cells[0].j)] = 0;
}

/** Open water beside a beach cell: water with nothing built on it. Nets count as built, so a netted cell is safe. */
export function openWaterBeside(grid: Grid, c: Cell): Cell[] {
  return grid.neighbors(c).filter(n => grid.water[cellIndex(n.i, n.j)] && !grid.buildingAt(n));
}

/** Shift start at high water: who goes swimming, per beach cell that has open water to swim in. */
export function updateSwimmers(state: SimState, grid: Grid): void {
  state.swimmers = [];
  if (!isDaytime(state.time)) return;
  const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0 && b.residents > b.injured);
  if (!homes.length) return;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = cellIndex(i, j);
    if (!grid.beach[k] || openWaterBeside(grid, { i, j }).length === 0) continue;
    let n = 0;
    for (const h of homes) if (within({ i, j }, h.cells, SWIM_RADIUS)) n += (h.residents - h.injured) * SWIM_FRACTION;
    if (n > 0) state.swimmers.push({ k, n });
  }
}

/** Risk in the open water beside a beach cell: the highest of its swimmable neighbours. */
export function beachRisk(state: SimState, grid: Grid, c: Cell): number {
  let r = 0;
  for (const n of openWaterBeside(grid, c)) r = Math.max(r, at(state.fields.shark, n));
  return r;
}

/** Shift end at high water: every beach with swimmers rolls for an incident. */
export function rollIncidents(state: SimState, grid: Grid): number {
  if (biomeFor(state).sharks === false) return 0;
  let incidents = 0;
  const night = isDaytime(state.time) ? 1 : NIGHT_RISK;
  for (const s of state.swimmers) {
    const c = { i: Math.floor(s.k / 64) - HALF, j: (s.k % 64) - HALF };
    const guard = 1 - LIFEGUARD_CUT * at(state.fields.coverage.lifeguard, c);
    const chance = Math.min(0.9, beachRisk(state, grid, c) * s.n * INCIDENT_SCALE * night * guard);
    if (chance <= 0 || rand(state) >= chance) continue;
    incidents++;
    state.incidents++;
    // The unluckiest swimmer comes from the fullest home in reach; the neighbourhood remembers.
    const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0 && b.residents > b.injured && within(c, b.cells, SWIM_RADIUS))
      .sort((x, y) => (y.residents - y.injured) - (x.residents - x.injured) || x.id - y.id);
    if (homes[0]) homes[0].injured++;
    for (const h of buildingList(state)) if (BUILDINGS[h.kind].residents > 0 && within(c, h.cells, INJURY_RADIUS)) h.shock = INJURY_MEMORY;
    notify(state, `A ${biomeFor(state).predator ?? "shark"} took a swimmer off the beach`);
  }
  return incidents;
}

/** Settlement: clinics heal the injured; the rest mend slowly; grief fades. */
export function healInjuries(state: SimState): void {
  const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0).sort((a, b) => a.id - b.id);
  let beds = 0;
  for (const b of buildingList(state)) if (b.kind === "clinic" && b.reached && !b.cut) beds += (levelCapacity(b) ?? CLINIC_HEAL_PER_CYCLE) * staffing(b);
  for (const h of homes) {
    while (beds >= 1 && h.injured > 0) { h.injured--; beds--; }
    if (h.shock > 0) h.shock--;
  }
  // Natural healing: one resident per home every INJURY_NATURAL_CYCLES cycles.
  if (state.tide.cycle % INJURY_NATURAL_CYCLES === 0) for (const h of homes) if (h.injured > 0) h.injured--;
}

export function injuredCount(state: SimState): number {
  let n = 0;
  for (const b of buildingList(state)) n += b.injured;
  return n;
}

