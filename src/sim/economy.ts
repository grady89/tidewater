// Money and goods. Per-cycle settlement runs at the high-tide peak. High-water producers (boats) work the high
// phase and land on leaving it; low-water producers (oyster beds, clam camps) work the low phase the same way.
// Boats at a deep dock work both. Land production (wood, planks, smoking, boat building) settles once a cycle.
import { SPRING_LO } from "../config";
import {
  BOAT_BASE_FISH, BOAT_COST, BUILDINGS, BuildingKind, CAP_BASE, CLAM_PER_CELL, CLAM_RADIUS, Cost, FOOD_PER_CYCLE,
  FOOD_RESERVE_CYCLES, GoodKind, HAPPY, IMMIGRANTS_PER_CYCLE, IMMIGRATION_HAPPINESS, LEVEL_UP_CYCLES, LEVEL_UP_HAPPINESS,
  LUMBER_TREES_PER_CYCLE, MARKET_SELL_PER_CYCLE, MAX_LEVEL, NET_LOFT_BONUS, NET_LOFT_RADIUS, OYSTER_YIELD,
  POLLUTION_HAPPY_SCALE, PRICE_FISH, PRICE_SHELLFISH, PURCHASABLE_BOATS, SAWMILL_RATE, SHIPYARD_BOAT_COST,
  SHIPYARD_CYCLES, SMOKEHOUSE_RATE, SPRING_LOW_BONUS, TAX_PER_RESIDENT, TIMBER_PER_TREE, WAREHOUSE_CAP,
  WASTE_BACKLOG_PENALTY_MAX, WASTE_BACKLOG_PENALTY_PER_UNIT,
} from "./balance";
import { at } from "./fields";
import { Grid } from "./grid";
import { depleteGround, fishAt, pollutionAt, routeWaste, settleFields } from "./pollution";
import { chooseGround } from "./sea";
import { announceLevel, rebuildCoverage } from "./services";
import { healInjuries, sharkSources } from "./sharks";
import { Building, buildingList, Cell, notify, Phase, SimState } from "./state";
import { fellTrees, regrowTrees } from "./trees";
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

export function freeSlots(b: Building): number {
  return (BUILDINGS[b.kind].slots ?? 0) - b.boats;
}

/** Why a boat can't be bought at this pier/dock, or null if it can. */
export function boatPurchaseBlocker(state: SimState, at: Building | null): string | null {
  if (!isHarbour(at)) return "Boats are bought at a pier or dock";
  if (freeSlots(at) <= 0) return "No free slot";
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

/** Storage cap for a good: the base plus every warehouse. */
export function capFor(state: SimState, good: GoodKind): number {
  let n = 0;
  for (const b of buildingList(state)) if (b.kind === "warehouse") n++;
  return CAP_BASE[good] + n * WAREHOUSE_CAP;
}

export function addCapped(state: SimState, good: GoodKind, amount: number): number {
  const before = state.resources[good];
  state.resources[good] = Math.min(capFor(state, good), before + amount);
  return state.resources[good] - before;
}

/** Can boats moored here work this phase? Piers only at high water; docks whenever the water moves. */
export function sailsIn(b: Building, phase: Phase): boolean {
  if (b.kind === "pier") return phase === "high";
  if (b.kind === "dock") return phase !== "slack";
  return false;
}

/** Catch multiplier from a reached net loft within range of the harbour. */
export function netLoftBonus(state: SimState, harbour: Building): number {
  for (const b of buildingList(state)) {
    if (b.kind !== "netLoft" || !b.reached || b.cut) continue;
    const c = b.cells[0];
    if (harbour.cells.some(h => Math.abs(h.i - c.i) <= NET_LOFT_RADIUS && Math.abs(h.j - c.j) <= NET_LOFT_RADIUS)) return 1 + NET_LOFT_BONUS;
  }
  return 1;
}

/** Shift start: boats leave for the richest ground in range, low-water crews walk out. */
export function shiftStart(state: SimState, grid: Grid, phase: Phase): void {
  for (const b of buildingList(state)) {
    if (!b.reached || b.cut) continue;
    if (isHarbour(b) && b.boats > 0 && sailsIn(b, phase) && staffing(b) > 0) {
      b.ground = chooseGround(grid, b, state.fields.fish);
      b.atSea = b.ground !== null;
    }
  }
}

/** Shift end: boats land a catch scaled by the ground's fish density and thin it; shellfish comes in from the flats. */
export function shiftEnd(state: SimState, grid: Grid, phase: Phase): void {
  const springLow = phase === "low" && state.tide.level <= SPRING_LO + 0.05;
  for (const b of buildingList(state)) {
    if (isHarbour(b) && b.atSea) {
      b.atSea = false;
      const density = b.ground ? fishAt(state, b.ground) : 0;
      const fish = b.boats * BOAT_BASE_FISH * staffing(b) * netLoftBonus(state, b) * density;
      depleteGround(state, b);
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

/** Land production, once a cycle: wood, planks, smoked goods, and boats from the yard. */
function produce(state: SimState, grid: Grid, buildings: Building[]): void {
  const r = state.resources;
  for (const b of buildings) {
    if (!b.reached || b.cut || staffing(b) === 0) continue;
    const s = staffing(b);
    switch (b.kind) {
      case "lumberCamp": {
        const felled = fellTrees(state, b, LUMBER_TREES_PER_CYCLE * s);
        b.output = addCapped(state, "timber", felled * TIMBER_PER_TREE);
        break;
      }
      case "sawmill": {
        const timber = Math.min(r.timber, SAWMILL_RATE * s);
        r.timber -= timber;
        b.output = addCapped(state, "planks", timber);
        break;
      }
      case "smokehouse": {
        const fish = Math.min(r.fish, SMOKEHOUSE_RATE * s);
        r.fish -= fish;
        b.output = addCapped(state, "smoked", fish);
        break;
      }
      case "shipyard": {
        const berth = buildings.filter(h => isHarbour(h) && freeSlots(h) > 0)
          .sort((x, y) => dist(x, b) - dist(y, b) || x.id - y.id)[0];
        if (!berth || !canAfford(state, SHIPYARD_BOAT_COST)) { b.output = 0; break; }
        b.progress += s;
        if (b.progress >= SHIPYARD_CYCLES) {
          b.progress = 0;
          pay(state, SHIPYARD_BOAT_COST);
          berth.boats++;
          b.output = 1;
          notify(state, `The shipyard launched a boat for the ${BUILDINGS[berth.kind].name.toLowerCase()}`);
        }
        break;
      }
    }
  }
  void grid;
}

function dist(a: Building, b: Building): number {
  return Math.hypot(a.cells[0].i - b.cells[0].i, a.cells[0].j - b.cells[0].j);
}

/** The happiness formula (balance.HAPPY). Injury and damage terms arrive with M8 and M10. */
export function homeHappiness(state: SimState, home: Building, fed: number, jobs: number): number {
  const c = home.cells[0];
  const cov = state.fields.coverage;
  const foul = Math.min(1, pollutionAt(state, c) / POLLUTION_HAPPY_SCALE);
  const backlog = Math.min(WASTE_BACKLOG_PENALTY_MAX, state.wasteBacklog * WASTE_BACKLOG_PENALTY_PER_UNIT);
  const injury = home.shock > 0 || home.injured > 0 ? HAPPY.injury : 0;
  const h = HAPPY.base + HAPPY.fed * fed + HAPPY.jobs * jobs + HAPPY.water * at(cov.water, c) + HAPPY.leisure * at(cov.leisure, c)
    + HAPPY.night * at(cov.night, c) - HAPPY.pollution * foul - backlog - injury;
  return Math.max(0, Math.min(1, h));
}

/** The cycle settlement, run once at every high-tide peak. */
export function settleCycle(state: SimState, grid: Grid): void {
  const r = state.resources;
  const stats = { cycle: state.tide.cycle, fishCaught: state.last.fishCaught, fishSold: 0, shellfishSold: 0, income: 0, expenses: 0, immigrants: 0 };
  const buildings = buildingList(state).sort((a, b) => a.id - b.id);

  assignWorkers(state, grid);
  rebuildCoverage(state);

  // Residents eat first, pay tax, and judge their lot.
  let pop = 0, happySum = 0, houses = 0;
  for (const b of buildings) {
    if (BUILDINGS[b.kind].residents === 0) continue;
    if (b.residents === 0) { b.happiness = 1; b.streak = 0; continue; }
    pop += b.residents;
    const need = b.residents * FOOD_PER_CYCLE;
    let ate = Math.min(r.fish, need); r.fish -= ate;
    const more = Math.min(r.shellfish, need - ate); r.shellfish -= more; ate += more;
    const fed = need > 0 ? ate / need : 1;
    const jobs = b.reached ? employed(state, b) / Math.max(1, b.residents - b.injured) : 0;
    b.happiness = homeHappiness(state, b, fed, jobs);
    happySum += b.happiness; houses++;
    // Growth: a run of good cycles adds a storey.
    if (b.happiness >= LEVEL_UP_HAPPINESS) b.streak++; else b.streak = 0;
    if (b.streak >= LEVEL_UP_CYCLES && b.level < MAX_LEVEL) { b.level++; b.streak = 0; announceLevel(state, b); }
  }
  state.happiness = houses ? happySum / houses : 1;
  stats.income += pop * TAX_PER_RESIDENT;

  // Sales of what's left beyond the town's food reserve; producers' per-cycle output counters reset here.
  const reserve = (pop + IMMIGRANTS_PER_CYCLE) * FOOD_PER_CYCLE * FOOD_RESERVE_CYCLES;
  for (const b of buildings) {
    if (b.kind !== "market") { if (BUILDINGS[b.kind].residents === 0) b.output = 0; continue; }
    b.output = 0;
    if (!b.reached || b.cut) continue;
    let capacity = MARKET_SELL_PER_CYCLE * staffing(b);
    const fish = Math.max(0, Math.min(r.fish - reserve, capacity));
    r.fish -= fish; capacity -= fish; stats.income += fish * PRICE_FISH; stats.fishSold += fish;
    const shellReserve = Math.max(0, reserve - r.fish);
    const shellfish = Math.max(0, Math.min(r.shellfish - shellReserve, capacity));
    r.shellfish -= shellfish; stats.income += shellfish * PRICE_SHELLFISH; stats.shellfishSold += shellfish;
    b.output = fish + shellfish;
  }

  produce(state, grid, buildings);
  regrowTrees(state);
  settleFields(state, grid);
  routeWaste(state);
  state.sharkEmitters = sharkSources(state);
  healInjuries(state);

  // Upkeep.
  for (const b of buildings) stats.expenses += BUILDINGS[b.kind].upkeep;
  r.money += stats.income - stats.expenses;

  // Immigration: connected housing with room, food on hand, a town worth joining.
  if (r.fish + r.shellfish > 0 && state.happiness >= IMMIGRATION_HAPPINESS) {
    let budget = IMMIGRANTS_PER_CYCLE;
    for (const b of buildings) {
      if (budget <= 0) break;
      const cap = grid.capacityOf(b);
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
