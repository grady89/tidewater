// Fire. Smokehouses, taverns and lantern posts raise a fire-risk field; a staffed fire watch damps it in its
// radius (and rain, in a storm, wipes it). Once a cycle each building rolls for ignition against the effective
// risk on its cell; a burning building spreads to its neighbours tick by tick and, when it burns out, is damaged
// unless the fire watch got there. Damaged buildings produce nothing until the repair fund pays for them.
import { SIM_TICK, TIDE_PERIOD } from "../config";
import {
  BUILDINGS, FIRE_ADVECT_NONE, FIRE_BURN_SECONDS, FIRE_DECAY, FIRE_DIFFUSE, FIRE_IGNITE_CHANCE, FIRE_IGNITE_THRESHOLD,
  FIRE_LANTERN, FIRE_MINE, FIRE_SAVE_COVERAGE, FIRE_SMOKEHOUSE, FIRE_SPREAD_PER_S, FIRE_TAVERN, FIRE_WATCH_CUT, MEND_PER_HAND,
  REPAIR_FRACTION, REPAIR_TIMBER_PER_100,
} from "./balance";
import { at, flowFor, stepDrift } from "./fields";
import { GOODS } from "./goods";
import { cellIndex, Grid } from "./grid";
import { moveMoney } from "./money";
import { rand } from "./rng";
import { Building, buildingList, Cell, Emitter, notify, SimState } from "./state";

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

/** Per-tick risk sources for the cycle. */
export function fireSources(state: SimState): Emitter[] {
  const out: Emitter[] = [];
  for (const b of buildingList(state)) {
    if (b.damaged) continue;
    let rate = 0;
    if (b.kind === "smokehouse" && b.workers > 0) rate = FIRE_SMOKEHOUSE;
    else if (b.kind === "tavern" && b.workers > 0) rate = FIRE_TAVERN;
    else if (b.kind === "ironMine" && b.workers > 0) rate = FIRE_MINE;
    else if (b.lantern) rate = FIRE_LANTERN;
    else if (BUILDINGS[b.kind].fireRisk && b.workers > 0) rate = BUILDINGS[b.kind].fireRisk!;
    if (rate > 0) for (const c of b.cells) out.push({ k: cellIndex(c.i, c.j), rate: rate / b.cells.length / TICKS_PER_CYCLE });
  }
  return out;
}

/** Risk at a cell after the fire watch has had its say. */
export function effectiveRisk(state: SimState, c: Cell): number {
  return at(state.fields.fire, c) * (1 - FIRE_WATCH_CUT * at(state.fields.coverage.firewatch, c));
}

/** Every tick: emit, decay, creep; burn and spread. */
export function tickFire(state: SimState, grid: Grid, dt: number, rain = false, fan = 1): void {
  const f = state.fields.fire;
  if (rain) { f.fill(0); }
  else {
    // Fire risk is not a fraction: a cluster's risk climbs past FIRE_IGNITE_THRESHOLD (1.0) and that is the rule.
    // A dry storm (the Dunes' sandstorm) fans it: every emitter runs `fan` times as hot while it blows.
    for (const e of state.fireEmitters) f[e.k] += e.rate * fan * (dt / SIM_TICK);
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

/**
 * What a repair costs: a fraction of the build price in money, plus timber in proportion, out of the store; timber
 * the store is short of is bought from the company at its price (`bought`, included in `money`), so a coast that
 * grows no timber can still mend what the sea breaks.
 */
export function repairCost(state: SimState, b: Building): { money: number; timber: number; bought: number } {
  const build = BUILDINGS[b.kind].cost.money, rest = repairLeft(b);
  const timber = Math.ceil(build / 100 * REPAIR_TIMBER_PER_100 * rest);
  const have = Math.min(timber, Math.max(0, Math.floor(state.resources.timber)));
  const bought = timber - have;
  return { money: Math.round(build * REPAIR_FRACTION * rest) + bought * GOODS.timber.sells, timber: have, bought };
}

/** A repair's whole work in dollars' worth, as if every plank of its timber were bought in: what free hands must do. */
export function repairWork(b: Building): number {
  const build = BUILDINGS[b.kind].cost.money;
  if (isStreet(b)) return build;
  return Math.round(build * REPAIR_FRACTION) + Math.ceil(build / 100 * REPAIR_TIMBER_PER_100) * GOODS.timber.sells;
}

/** The share of a repair still to do (free hands have done the rest). */
export function repairLeft(b: Building): number {
  return Math.max(0, 1 - (b.mend ?? 0) / repairWork(b));
}

/** The healthy residents with no working job this cycle — the crews of damaged workplaces among them. */
export function freeHands(state: SimState): number {
  let healthy = 0, working = 0;
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) healthy += Math.max(0, b.residents - b.injured);
  for (const a of state.assignments) { const w = state.buildings[a.work]; if (w && !w.damaged) working += a.n; }
  return Math.max(0, healthy - working);
}

/** What is damaged, in the order it is mended: streets, then the landings and workplaces, then the rest, cheapest first. */
export function mendOrder(state: SimState): Building[] {
  const rank = (b: Building) => (isStreet(b) ? 0 : earns(b) ? 1 : 2);
  return buildingList(state).filter(b => b.damaged)
    .sort((x, y) => rank(x) - rank(y) || BUILDINGS[x.kind].cost.money - BUILDINGS[y.kind].cost.money || x.id - y.id);
}

/**
 * Settlement, before the purse: the free hands mend what is damaged, MEND_PER_HAND worth each, in mendOrder — slowly,
 * and for nothing, so a town the sea has wrecked rebuilds itself; the purse (and Repair now) finish what is left.
 */
export function mendByHand(state: SimState): number {
  for (const b of buildingList(state)) if (!b.damaged && b.mend !== undefined) delete b.mend;
  const order = mendOrder(state);
  if (!order.length) return 0;
  let labour = freeHands(state) * MEND_PER_HAND;
  const done: string[] = [];
  let streets = 0;
  for (const b of order) {
    if (labour <= 0) break;
    const give = Math.min(repairWork(b) - (b.mend ?? 0), labour);
    b.mend = (b.mend ?? 0) + give;
    labour -= give;
    if (b.mend < repairWork(b) - 1e-9) continue;
    b.damaged = false;
    delete b.mend;
    if (isStreet(b)) streets++; else done.push(`the ${BUILDINGS[b.kind].name.toLowerCase()}`);
  }
  if (streets) done.unshift(`${streets} walkway${streets > 1 ? "s" : ""}`);
  if (done.length) notify(state, `Free hands mended ${done.length > 3 ? done.slice(0, 3).join(", ") + ` and ${done.length - 3} more` : done.join(", ")}`);
  return done.length;
}

/** What mending costs now: a street piece its base price (no timber), anything else repairCost. */
export function mendCost(state: SimState, b: Building): { money: number; timber: number; bought: number } {
  return isStreet(b) ? { money: Math.ceil(BUILDINGS[b.kind].cost.money * repairLeft(b)), timber: 0, bought: 0 } : repairCost(state, b);
}

/** Why a damaged building can't be mended now (null: it can): the purse. */
export function repairBlocker(state: SimState, b: Building): string | null {
  if (!b.damaged) return "Not damaged";
  const c = mendCost(state, b);
  return state.resources.money < c.money ? `Needs ${c.money}$; the purse holds ${Math.floor(state.resources.money)}$` : null;
}

/** Mend it now out of the purse (the info panel's Repair button), without waiting for a peak; false when it can't be paid for. */
export function repairNow(state: SimState, b: Building): boolean {
  if (repairBlocker(state, b)) return false;
  const c = mendCost(state, b);
  moveMoney(state, -c.money, "repair");
  state.resources.timber -= c.timber;
  b.damaged = false;
  delete b.mend;
  notify(state, `Repaired the ${BUILDINGS[b.kind].name.toLowerCase()} for ${c.money}$`);
  return true;
}

/** What a town needs back first after damage: its landings and the workplaces that make or sell something. */
export function earns(b: Building): boolean {
  const def = BUILDINGS[b.kind];
  return def.network === "root" || (def.workers > 0 && (def.category === "Production" || def.category === "Sea"));
}

/** Settlement: repair what the purse and the woodpile allow, oldest damage first. */
export function repairDamage(state: SimState): number {
  let repaired = 0;
  // Streets first, and cheaply: a damaged walkway or path is rebuilt for its base price (no timber, no stilt
  // surcharge) whenever the purse allows, so a wave doesn't leave the town cut into pieces for cycles.
  let streets = 0, spent = 0;
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    if (!b.damaged || !isStreet(b)) continue;
    const money = mendCost(state, b).money;
    if (state.resources.money < money) continue;
    moveMoney(state, -money, "rebuild");
    b.damaged = false;
    delete b.mend;
    streets++; spent += money; repaired++;
  }
  if (streets) notify(state, `Rebuilt ${streets} walkway${streets > 1 ? "s" : ""} for ${spent}$`);
  // Landings and earners first, cheapest first; everything else waits (the purse saves) until they are all mended.
  const broken = buildingList(state).filter(b => b.damaged).sort((x, y) => BUILDINGS[x.kind].cost.money - BUILDINGS[y.kind].cost.money || x.id - y.id);
  for (const first of [true, false]) {
    for (const b of broken) {
      if (earns(b) !== first || !b.damaged) continue;
      const c = repairCost(state, b);
      if (state.resources.money < c.money) continue;
      moveMoney(state, -c.money, "repair");
      state.resources.timber -= c.timber;
      b.damaged = false;
      delete b.mend;
      repaired++;
      notify(state, `Repaired the ${BUILDINGS[b.kind].name.toLowerCase()} for ${c.money}$${c.timber ? ` and ${c.timber} timber` : ""}${c.bought ? ` (${c.bought} timber bought)` : ""}`);
    }
    if (broken.some(b => b.damaged && earns(b))) break;
  }
  return repaired;
}

/** Street pieces: rebuilt automatically after damage. */
export function isStreet(b: Building): boolean {
  return b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path";
}

/** A building that can do its job: connected, dry, and intact. */
export function active(b: Building): boolean {
  return b.reached && !b.cut && !b.damaged;
}

/** Homes near damage grieve a little (HAPPY.damage). */
export function damageNear(grid: Grid, c: Cell, radius: number): boolean {
  for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
    const b = grid.buildingAt({ i: c.i + di, j: c.j + dj });
    if (b && b.damaged) return true;
  }
  return false;
}
