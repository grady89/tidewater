// The sea takes: storms and the tsunami. A storm lasts a cycle: boats stay in, unsheltered boats may be lost,
// rain kills fire risk, and the view darkens the sky and triples the waves. The tsunami is a 20 s drawdown (the
// tide plunges, boats heel on the mud) followed by a wave sweeping in from the deep side that damages every
// unshielded building whose floor is below WAVE_HEIGHT and sinks unsheltered boats. Breakwaters shelter
// harbours and block the wave; sea walls on the flats shield what stands behind them along the wave axis.
import { SIZE } from "../config";
import {
  BUILDINGS, DRAWDOWN_LEVEL, DRAWDOWN_SECONDS, SHELTER_RADIUS, SHIELD_RANGE, STORM_CHANCE, STORM_FIRST_CYCLE, STORM_LOSS_FIRST_CYCLE,
  STORM_LOSS_CHANCE, TSUNAMI_CHANCE, TSUNAMI_COOLDOWN, TSUNAMI_FIRST_CYCLE, TSUNAMI_MIN_POPULATION, FIRST_WAVE_REACH, WAVE_SETTLE_SECONDS,
  WAVE_SPEED,
} from "./balance";
import { biomeFor } from "./biomes";
import { cellIndex, Grid, HALF, inBounds } from "./grid";
import { rand } from "./rng";
import { Building, buildingList, Cell, notify, population, SimState } from "./state";
import { levelAt } from "./tide";
import { hasLighthouse } from "./trade";
import { trimCrew } from "./workers";

/** Is a harbour behind a breakwater? Any breakwater within SHELTER_RADIUS counts. */
export function sheltered(grid: Grid, harbour: Building): boolean {
  for (const c of harbour.cells) for (let di = -SHELTER_RADIUS; di <= SHELTER_RADIUS; di++) for (let dj = -SHELTER_RADIUS; dj <= SHELTER_RADIUS; dj++) {
    if (grid.buildingAt({ i: c.i + di, j: c.j + dj })?.kind === "breakwater") return true;
  }
  return false;
}

/** The side the wave comes from: toward the deepest map-edge cell. */
export function waveDirection(grid: Grid): { x: number; z: number } {
  let best: Cell | null = null, bh = Infinity;
  const consider = (i: number, j: number) => { const h = grid.heights[cellIndex(i, j)]; if (h < bh) { bh = h; best = { i, j }; } };
  for (let i = -HALF; i < HALF; i++) { consider(i, -HALF); consider(i, HALF - 1); }
  for (let j = -HALF; j < HALF; j++) { consider(-HALF, j); consider(HALF - 1, j); }
  const b = best ?? { i: 0, j: HALF - 1 };
  const x = -(b.i + 0.5), z = -(b.j + 0.5);
  const n = Math.hypot(x, z) || 1;
  return { x: x / n, z: z / n };
}

/** Position of a cell centre along the wave axis (from the deep side, increasing landward). */
export function along(dir: { x: number; z: number }, c: Cell): number {
  return (c.i + 0.5) * dir.x + (c.j + 0.5) * dir.z;
}

/** A wall or breakwater in front of the cell (toward the sea, along the wave axis) within SHIELD_RANGE shields it. */
export function shielded(grid: Grid, dir: { x: number; z: number }, c: Cell): boolean {
  for (let s = 1; s <= SHIELD_RANGE; s++) {
    const i = Math.floor(c.i + 0.5 - dir.x * s), j = Math.floor(c.j + 0.5 - dir.z * s);
    if (!inBounds(i, j)) return false;
    const b = grid.buildingAt({ i, j });
    if (b && (b.kind === "seaWall" || b.kind === "breakwater")) return true;
  }
  return false;
}

// ---------- storms ----------

/** Settlement: does a storm blow this cycle? Never two in a row, never before STORM_FIRST_CYCLE. */
export function rollStorm(state: SimState, grid: Grid): void {
  const s = state.storm;
  if (s.active) { s.active = false; }
  const cycle = state.tide.cycle;
  if (cycle < STORM_FIRST_CYCLE || cycle - s.lastCycle < 2) return;
  if (rand(state) < STORM_CHANCE * (biomeFor(state).storm?.chance ?? 1)) startStorm(state, grid);
}

export function startStorm(state: SimState, grid: Grid): void {
  const s = state.storm;
  s.active = true;
  s.lastCycle = state.tide.cycle;
  s.count++;
  const profile = biomeFor(state).storm;
  notify(state, profile ? `A ${profile.name} is coming: the boats stay in` : "A storm is coming: the boats stay in");
  // Boats out of shelter are at the sea's mercy; a lighthouse sees them all home.
  if (hasLighthouse(state)) return;
  // The early town has no breakwater to buy yet and one boat to its name: before STORM_LOSS_FIRST_CYCLE the storm
  // only keeps the boats in (the dice still roll, so the seed's story is unchanged), and it never takes a town's
  // last boat.
  const early = state.tide.cycle < STORM_LOSS_FIRST_CYCLE;
  const lossChance = STORM_LOSS_CHANCE * (profile?.loss ?? 1);
  let fleet = buildingList(state).reduce((n, b) => n + b.boats, 0);
  for (const h of buildingList(state).sort((a, b) => a.id - b.id)) {
    if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0 || sheltered(grid, h)) continue;
    let lost = 0;
    for (let k = 0; k < h.boats; k++) if (rand(state) < lossChance) lost++;
    lost = early ? 0 : Math.min(lost, fleet - 1);
    if (lost > 0) {
      fleet -= lost;
      h.boats -= lost;
      h.atSea = false;
      trimCrew(state, h);
      notify(state, `The storm took ${lost} boat${lost > 1 ? "s" : ""} from the ${BUILDINGS[h.kind].name.toLowerCase()}`);
    }
  }
}

// ---------- tsunami ----------

/**
 * Settlement: rare, only after TSUNAMI_FIRST_CYCLE and TSUNAMI_COOLDOWN since the last, only to a town of
 * TSUNAMI_MIN_POPULATION — and never unannounced.
 * The roll that comes up sets the wave for the *next* settlement and says "the sea is uneasy", so the player has
 * one tide to lift decks, raise walls or move boats behind the breakwater.
 */
export function rollTsunami(state: SimState, grid: Grid): void {
  const t = state.tsunami;
  if (t.stage) return;
  const cycle = state.tide.cycle;
  if (t.due >= 0) {
    if (cycle >= t.due) { t.due = -1; startTsunami(state, grid); }
    return;
  }
  if (cycle < TSUNAMI_FIRST_CYCLE || cycle - t.lastCycle < TSUNAMI_COOLDOWN || population(state) < TSUNAMI_MIN_POPULATION) return;
  if (rand(state) < TSUNAMI_CHANCE) warnTsunami(state, grid);
}

/** Book the wave for the next settlement, and say what can be done in the tide before it. */
export function warnTsunami(state: SimState, grid?: Grid): void {
  state.tsunami.due = state.tide.cycle + 1;
  const height = grid ? ` ${grid.tides.waveHeight.toFixed(1)} m` : "";
  notify(state, `The sea is uneasy: a wave comes at the next high tide. Decks lifted over${height || " the wave"} (the ] key as you build), anything behind a sea wall or breakwater, and boats in a breakwater's lee come through${state.tsunami.count === 0 ? "; a first wave spends itself on the seafront" : ""}`);
}

/** Is a wave booked but not yet started? */
export function tsunamiDue(state: SimState): boolean {
  return state.tsunami.due >= 0 && !state.tsunami.stage;
}

export function startTsunami(state: SimState, grid: Grid): void {
  const t = state.tsunami;
  if (t.stage) return;
  t.stage = "drawdown";
  t.t = 0;
  t.dir = waveDirection(grid);
  t.front = -SIZE;
  t.lastCycle = state.tide.cycle;
  t.struck = [];
  t.hit = 0;
  // The first wave a town sees reaches only the seafront: FIRST_WAVE_REACH cells past the first building it meets.
  const fronts = buildingList(state).map(b => Math.min(...b.cells.map(c => along(t.dir, c))));
  t.reach = t.count === 0 && fronts.length ? Math.min(...fronts) + FIRST_WAVE_REACH : undefined;
  t.count++;
  notify(state, "The sea is pulling back");
}

/** Per tick: run the drawdown, sweep the wave, strike what it passes, and let the tide return. */
export function tickTsunami(state: SimState, grid: Grid, dt: number): void {
  const t = state.tsunami;
  if (!t.stage) return;
  t.t += dt;
  const natural = levelAt(state.tide);
  if (t.stage === "drawdown") {
    const k = Math.min(1, t.t / DRAWDOWN_SECONDS);
    state.tide.override = natural + (DRAWDOWN_LEVEL - natural) * k;
    if (k >= 1) { t.stage = "wave"; t.t = 0; t.front = -SIZE; notify(state, "A wave is coming in"); }
    return;
  }
  if (t.stage === "wave") {
    state.tide.override = DRAWDOWN_LEVEL;
    t.front += WAVE_SPEED * dt;
    strike(state, grid);
    if (t.front > SIZE) {
      t.stage = "settle"; t.t = 0;
      if (t.hit) notify(state, `The wave damaged ${t.hit} building${t.hit > 1 ? "s" : ""}. Free hands mend them a little every tide, for nothing; the purse mends them at the high tides once it can, and a damaged building's panel has Repair now`);
    }
    return;
  }
  // settle: the water comes back to where the clock says it should be.
  const k = Math.min(1, t.t / WAVE_SETTLE_SECONDS);
  state.tide.override = DRAWDOWN_LEVEL + (natural - DRAWDOWN_LEVEL) * k;
  if (k >= 1) { state.tide.override = null; t.stage = null; t.t = 0; }
}

/** Everything the front has passed this tick and not struck yet takes the wave. */
function strike(state: SimState, grid: Grid): void {
  const t = state.tsunami;
  const struck = new Set(t.struck);
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    if (struck.has(b.id)) continue;
    const pos = Math.min(...b.cells.map(c => along(t.dir, c)));
    if (pos > t.front) continue;
    struck.add(b.id);
    if (t.reach !== undefined && pos > t.reach) continue; // a first wave, spent before it got here
    if ((BUILDINGS[b.kind].slots ?? 0) > 0 && b.boats > 0 && !sheltered(grid, b)) {
      notify(state, `The wave took ${b.boats} boat${b.boats > 1 ? "s" : ""} from the ${BUILDINGS[b.kind].name.toLowerCase()}`);
      b.boats = 0; b.atSea = false;
      trimCrew(state, b);
    }
    if (b.kind === "seaWall" || b.kind === "breakwater") continue;
    if (b.floorY >= grid.tides.waveHeight || b.damaged) continue;
    if (b.cells.some(c => shielded(grid, t.dir, c))) continue;
    b.damaged = true;
    b.fire = 0;
    t.hit = (t.hit ?? 0) + 1;
  }
  t.struck = [...struck];
}

