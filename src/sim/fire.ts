// Fire. Smokehouses, taverns and lantern posts raise a fire-risk field; a staffed fire watch damps it in its
// radius (and rain, in a storm, wipes it). Once a cycle each building rolls for ignition against the effective
// risk on its cell; a burning building spreads to its neighbours tick by tick and, when it burns out, is damaged
// unless the fire watch got there. Damaged buildings produce nothing until the repair fund pays for them.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import {
  BUILDINGS, FIRE_ADVECT_NONE, FIRE_BURN_SECONDS, FIRE_DECAY, FIRE_DIFFUSE, FIRE_IGNITE_CHANCE, FIRE_IGNITE_THRESHOLD,
  FIRE_LANTERN, FIRE_SAVE_COVERAGE, FIRE_SMOKEHOUSE, FIRE_SPREAD_PER_S, FIRE_TAVERN, FIRE_WATCH_CUT, REPAIR_FRACTION,
  REPAIR_TIMBER_PER_100,
} from "./balance";
import { at, buildFlow, Flow, stepDrift } from "./fields";
import { cellIndex, Grid } from "./grid";
import { rand } from "./rng";
import { Building, buildingList, Cell, Emitter, notify, SimState } from "./state";

const flows = new WeakMap<Grid, Flow>();
function flowFor(grid: Grid): Flow {
  let f = flows.get(grid);
  if (!f) { f = buildFlow(grid); flows.set(grid, f); }
  return f;
}

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

/** Per-tick risk sources for the cycle. */
export function fireSources(state: SimState): Emitter[] {
  const out: Emitter[] = [];
  for (const b of buildingList(state)) {
    if (b.damaged) continue;
    let rate = 0;
    if (b.kind === "smokehouse" && b.workers > 0) rate = FIRE_SMOKEHOUSE;
    else if (b.kind === "tavern" && b.workers > 0) rate = FIRE_TAVERN;
    else if (b.lantern) rate = FIRE_LANTERN;
    if (rate > 0) for (const c of b.cells) out.push({ k: cellIndex(c.i, c.j), rate: rate / b.cells.length / TICKS_PER_CYCLE });
  }
  return out;
}

/** Risk at a cell after the fire watch has had its say. */
export function effectiveRisk(state: SimState, c: Cell): number {
  return at(state.fields.fire, c) * (1 - FIRE_WATCH_CUT * at(state.fields.coverage.firewatch, c));
}

/** Every tick: emit, decay, creep; burn and spread. */
export function tickFire(state: SimState, grid: Grid, dt: number, rain = false): void {
  const f = state.fields.fire;
  if (rain) { f.fill(0); }
  else {
    for (const e of state.fireEmitters) f[e.k] += e.rate * (dt / SIM_TICK);
    stepDrift(f, flowFor(grid), dt, false, FIRE_DECAY, FIRE_DIFFUSE, FIRE_ADVECT_NONE);
  }
  const burning = buildingList(state).filter(b => b.fire > 0).sort((a, b) => a.id - b.id);
  for (const b of burning) {
    b.fire -= dt;
    // Spread to whatever stands next door.
    for (const c of b.cells) for (const n of grid.neighbors(c)) {
      const q = grid.buildingAt(n);
      if (!q || q === b || q.fire > 0 || q.damaged) continue;
      const guard = 1 - FIRE_WATCH_CUT * at(state.fields.coverage.firewatch, n);
      if (rand(state) < FIRE_SPREAD_PER_S * dt * guard) ignite(state, q, "spread");
    }
    if (b.fire <= 0) {
      b.fire = 0;
      const saved = at(state.fields.coverage.firewatch, b.cells[0]) >= FIRE_SAVE_COVERAGE;
      if (saved) notify(state, `The fire watch saved the ${BUILDINGS[b.kind].name.toLowerCase()}`);
      else { b.damaged = true; state.burnt++; notify(state, `The ${BUILDINGS[b.kind].name.toLowerCase()} burnt out`); }
    }
  }
}

export function ignite(state: SimState, b: Building, how: "risk" | "spread" | "storm" = "risk"): void {
  if (b.fire > 0 || b.damaged) return;
  b.fire = FIRE_BURN_SECONDS;
  state.fires++;
  if (how !== "spread") notify(state, `Fire! The ${BUILDINGS[b.kind].name.toLowerCase()} is burning`);
}

/** Settlement: roll ignition for every standing building against the effective risk on its cells. */
export function rollIgnitions(state: SimState): void {
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    if (b.fire > 0 || b.damaged) continue;
    let risk = 0;
    for (const c of b.cells) risk = Math.max(risk, effectiveRisk(state, c));
    if (risk <= FIRE_IGNITE_THRESHOLD) continue;
    const chance = Math.min(0.5, (risk - FIRE_IGNITE_THRESHOLD) * FIRE_IGNITE_CHANCE + FIRE_IGNITE_CHANCE);
    if (rand(state) < chance) ignite(state, b);
  }
}

/** What a repair costs: a fraction of the build price in money, plus timber in proportion. */
export function repairCost(b: Building): { money: number; timber: number } {
  const build = BUILDINGS[b.kind].cost.money;
  return { money: Math.round(build * REPAIR_FRACTION), timber: Math.ceil(build / 100 * REPAIR_TIMBER_PER_100) };
}

/** Settlement: repair what the purse and the woodpile allow, oldest damage first. */
export function repairDamage(state: SimState): number {
  let repaired = 0;
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    if (!b.damaged) continue;
    const c = repairCost(b);
    if (state.resources.money < c.money || state.resources.timber < c.timber) continue;
    state.resources.money -= c.money;
    state.resources.timber -= c.timber;
    b.damaged = false;
    repaired++;
    notify(state, `Repaired the ${BUILDINGS[b.kind].name.toLowerCase()} for ${c.money}$ and ${c.timber} timber`);
  }
  return repaired;
}

/** A building that can do its job: connected, dry, and intact. */
export function active(b: Building): boolean {
  return b.reached && !b.cut && !b.damaged;
}

export function damagedCount(state: SimState): number {
  let n = 0;
  for (const b of buildingList(state)) if (b.damaged) n++;
  return n;
}

/** Homes near damage grieve a little (HAPPY.damage). */
export function damageNear(grid: Grid, c: Cell, radius: number): boolean {
  for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
    const b = grid.buildingAt({ i: c.i + di, j: c.j + dj });
    if (b && b.damaged) return true;
  }
  return false;
}
