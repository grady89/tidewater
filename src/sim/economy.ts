// Money and goods. Per-cycle settlement runs at the high-tide peak; boats sail on entering high water and land
// their catch on leaving it.
import {
  BOAT_BASE_FISH, BOAT_COST, BUILDINGS, BuildingKind, CAP_BASE, Cost, FOOD_PER_CYCLE, IMMIGRANTS_PER_CYCLE,
  IMMIGRATION_HAPPINESS, MARKET_SELL_PER_CYCLE, PIER_SLOTS, PRICE_FISH, PRICE_SHELLFISH, PURCHASABLE_BOATS,
  TAX_PER_RESIDENT,
} from "./balance";
import { Grid } from "./grid";
import { Building, buildingList, Cell, notify, SimState } from "./state";
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

/** Why a boat can't be bought at this pier, or null if it can. */
export function boatPurchaseBlocker(state: SimState, pier: Building | null): string | null {
  if (!pier || pier.kind !== "pier") return "Boats are bought at a pier";
  if (pier.boats >= PIER_SLOTS) return "Pier is full";
  if (totalBoats(state) >= PURCHASABLE_BOATS) return "Only the first two boats can be bought; build a shipyard";
  if (state.resources.money < BOAT_COST) return `Costs ${BOAT_COST}$`;
  return null;
}

export function buyBoat(state: SimState, pier: Building): boolean {
  if (boatPurchaseBlocker(state, pier)) return false;
  state.resources.money -= BOAT_COST;
  pier.boats++;
  notify(state, "A fishing boat is tied up at the pier");
  return true;
}

function addCapped(state: SimState, kind: keyof typeof CAP_BASE, amount: number): number {
  const before = state.resources[kind];
  state.resources[kind] = Math.min(CAP_BASE[kind], before + amount);
  return state.resources[kind] - before;
}

/** Boats leave every reached pier that has crew. */
export function boatsSail(state: SimState): void {
  for (const b of buildingList(state)) {
    if (b.kind !== "pier" || !b.reached || b.cut || b.boats === 0) continue;
    if (staffing(b) > 0) b.atSea = true;
  }
}

/** Boats come home and land their catch. */
export function boatsReturn(state: SimState): void {
  let caught = 0;
  for (const b of buildingList(state)) {
    if (b.kind !== "pier" || !b.atSea) continue;
    b.atSea = false;
    const fish = b.boats * BOAT_BASE_FISH * staffing(b);
    b.output = addCapped(state, "fish", fish);
    caught += b.output;
  }
  state.last.fishCaught += caught;
}

/** The cycle settlement, run once at every high-tide peak. */
export function settleCycle(state: SimState, grid: Grid): void {
  const r = state.resources;
  const stats = { cycle: state.tide.cycle, fishCaught: state.last.fishCaught, fishSold: 0, income: 0, expenses: 0, immigrants: 0 };
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

  // Sales of what's left.
  for (const b of buildings) {
    if (b.kind !== "market") continue;
    b.output = 0;
    if (!b.reached || b.cut) continue;
    let capacity = MARKET_SELL_PER_CYCLE * staffing(b);
    const fish = Math.min(r.fish, capacity);
    r.fish -= fish; capacity -= fish; stats.income += fish * PRICE_FISH; stats.fishSold += fish;
    const shellfish = Math.min(r.shellfish, capacity);
    r.shellfish -= shellfish; stats.income += shellfish * PRICE_SHELLFISH;
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
