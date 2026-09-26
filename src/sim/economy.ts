// Money and goods. Per-cycle settlement runs at the high-tide peak. High-water producers (boats) work the high
// phase and land on leaving it; low-water producers (oyster beds, clam camps) work the low phase the same way.
// Boats at a deep dock work both.
import { SPRING_LO } from "../config";
import {
  BOAT_BASE_FISH, BOAT_COST, BUILDINGS, BuildingKind, CAP_BASE, CLAM_PER_CELL, CLAM_RADIUS, Cost, FOOD_PER_CYCLE,
  IMMIGRANTS_PER_CYCLE, IMMIGRATION_HAPPINESS, MARKET_SELL_PER_CYCLE, OYSTER_YIELD, PRICE_FISH, PRICE_SHELLFISH,
  PURCHASABLE_BOATS, SPRING_LOW_BONUS, TAX_PER_RESIDENT,
} from "./balance";
import { Grid } from "./grid";
import { chooseGround } from "./sea";
import { Building, buildingList, Cell, notify, Phase, SimState } from "./state";
import { assignWorkers, employed, staffing } from "./workers";

export function canAfford(state: SimState, cost: Cost): boolean {
  const r = state.resources;
  return r.money >= cost.money && r.planks >= (cost.planks ?? 0) && r.timber >= (cost.timber ?? 0);
}

export function pay(state: SimState, cost: Cost): void {
  const r = state.resources;
  r.money -= cost.money;
  r.planks -= cost.planks ?? 0;
  r.timber -= cost.timber ?? 0;
}

export function buildingCost(kind: BuildingKind): Cost {
  return BUILDINGS[kind].cost;
}

/** Validate, pay, and place a building anchored at `anchor`. Null (and nothing paid) when it can't go there. */
export function tryPlace(state: SimState, grid: Grid, kind: BuildingKind, anchor: Cell): Building | null {
  const cells = grid.footprint(kind, anchor);
  if (!cells || !grid.canPlace(kind, cells) || !canAfford(state, BUILDINGS[kind].cost)) return null;
  pay(state, BUILDINGS[kind].cost);
  return grid.place(kind, cells);
}

export function totalBoats(state: SimState): number {
  let n = 0;
  for (const b of buildingList(state)) n += b.boats;
  return n;
}

export function isHarbour(b: Building | null): b is Building {
  return !!b && (BUILDINGS[b.kind].slots ?? 0) > 0;
}

/** Why a boat can't be bought at this pier/dock, or null if it can. */
export function boatPurchaseBlocker(state: SimState, at: Building | null): string | null {
  if (!isHarbour(at)) return "Boats are bought at a pier or dock";
  if (at.boats >= (BUILDINGS[at.kind].slots ?? 0)) return "No free slot";
  if (totalBoats(state) >= PURCHASABLE_BOATS) return "Only the first two boats can be bought; build a shipyard";
  if (state.resources.money < BOAT_COST) return `Costs ${BOAT_COST}$`;
  return null;
}

export function buyBoat(state: SimState, at: Building): boolean {
  if (boatPurchaseBlocker(state, at)) return false;
  state.resources.money -= BOAT_COST;
  at.boats++;
  notify(state, `A fishing boat is tied up at the ${BUILDINGS[at.kind].name.toLowerCase()}`);
  return true;
}

function addCapped(state: SimState, kind: keyof typeof CAP_BASE, amount: number): number {
  const before = state.resources[kind];
  state.resources[kind] = Math.min(CAP_BASE[kind], before + amount);
  return state.resources[kind] - before;
}

/** Can boats moored here work this phase? Piers only at high water; docks whenever the water moves. */
export function sailsIn(b: Building, phase: Phase): boolean {
  if (b.kind === "pier") return phase === "high";
  if (b.kind === "dock") return phase !== "slack";
  return false;
}

/** Shift start: boats leave for their ground, low-water crews walk out. */
export function shiftStart(state: SimState, grid: Grid, phase: Phase): void {
  for (const b of buildingList(state)) {
    if (!b.reached || b.cut) continue;
    if (isHarbour(b) && b.boats > 0 && sailsIn(b, phase) && staffing(b) > 0) {
      b.ground = chooseGround(grid, b);
      b.atSea = b.ground !== null;
    }
  }
}

/** Shift end: boats land their catch; shellfish comes in from the flats. */
export function shiftEnd(state: SimState, grid: Grid, phase: Phase): void {
  const springLow = phase === "low" && state.tide.level <= SPRING_LO + 0.05;
  for (const b of buildingList(state)) {
    if (isHarbour(b) && b.atSea) {
      b.atSea = false;
      const fish = b.boats * BOAT_BASE_FISH * staffing(b);
      b.output += addCapped(state, "fish", fish);
      state.last.fishCaught += fish;
      continue;
    }
    if (phase !== "low" || !b.reached || b.cut) continue;
    if (b.kind === "oysterBed") {
      b.output += addCapped(state, "shellfish", OYSTER_YIELD * staffing(b) * (springLow ? SPRING_LOW_BONUS : 1));
    } else if (b.kind === "clamCamp") {
      const cells = grid.exposedFlatsNear(b.cells, CLAM_RADIUS, state.tide.level);
      b.output += addCapped(state, "shellfish", cells * CLAM_PER_CELL * staffing(b) * (springLow ? SPRING_LOW_BONUS : 1));
    }
  }
}

/** The cycle settlement, run once at every high-tide peak. */
export function settleCycle(state: SimState, grid: Grid): void {
  const r = state.resources;
  const stats = { cycle: state.tide.cycle, fishCaught: state.last.fishCaught, fishSold: 0, shellfishSold: 0, income: 0, expenses: 0, immigrants: 0 };
  const buildings = buildingList(state).sort((a, b) => a.id - b.id);

  assignWorkers(state, grid);

  // Residents eat first, pay tax, and judge their lot.
  let pop = 0, happySum = 0, houses = 0;
  for (const b of buildings) {
    if (BUILDINGS[b.kind].residents === 0) continue;
    if (b.residents === 0) { b.happiness = 1; continue; }
    pop += b.residents;
    const need = b.residents * FOOD_PER_CYCLE;
    let ate = Math.min(r.fish, need); r.fish -= ate;
    const more = Math.min(r.shellfish, need - ate); r.shellfish -= more; ate += more;
    const fed = need > 0 ? ate / need : 1;
    const jobs = b.reached ? employed(state, b) / b.residents : 0;
    b.happiness = 0.5 * fed + 0.5 * jobs;
    happySum += b.happiness; houses++;
  }
  state.happiness = houses ? happySum / houses : 1;
  stats.income += pop * TAX_PER_RESIDENT;

  // Sales of what's left; producers' per-cycle output counters reset here.
  for (const b of buildings) {
    if (b.kind !== "market") { if (BUILDINGS[b.kind].residents === 0) b.output = 0; continue; }
    b.output = 0;
    if (!b.reached || b.cut) continue;
    let capacity = MARKET_SELL_PER_CYCLE * staffing(b);
    const fish = Math.min(r.fish, capacity);
    r.fish -= fish; capacity -= fish; stats.income += fish * PRICE_FISH; stats.fishSold += fish;
    const shellfish = Math.min(r.shellfish, capacity);
    r.shellfish -= shellfish; stats.income += shellfish * PRICE_SHELLFISH; stats.shellfishSold += shellfish;
    b.output = fish + shellfish;
  }

  // Upkeep.
  for (const b of buildings) stats.expenses += BUILDINGS[b.kind].upkeep;
  r.money += stats.income - stats.expenses;

  // Immigration: connected housing with room, food on hand, a town worth joining.
  if (r.fish + r.shellfish > 0 && state.happiness >= IMMIGRATION_HAPPINESS) {
    let budget = IMMIGRANTS_PER_CYCLE;
    for (const b of buildings) {
      if (budget <= 0) break;
      const cap = BUILDINGS[b.kind].residents;
      if (cap === 0 || !b.reached || b.cut || b.residents >= cap) continue;
      const n = Math.min(budget, cap - b.residents);
      b.residents += n; budget -= n; stats.immigrants += n;
    }
    if (stats.immigrants > 0) {
      notify(state, `${stats.immigrants} new resident${stats.immigrants > 1 ? "s" : ""} moved in`);
      assignWorkers(state, grid); // newcomers start work this cycle
    }
  }

  state.last = stats;
}
