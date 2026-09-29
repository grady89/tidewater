// Money and goods. Per-cycle settlement runs at the high-tide peak. High-water producers (boats) work the high
// phase and land on leaving it; low-water producers (oyster beds, clam camps) work the low phase the same way.
// Boats at a deep dock work both. Land production (wood, planks, smoking, boat building) settles once a cycle.
import {
  BOAT_BASE_FISH, BOAT_COST, BUILDINGS, BuildingKind, CAP_BASE, CLAM_PER_CELL, CLAM_RADIUS, Cost, FOOD_PER_CYCLE,
  FOOD_RESERVE_CYCLES, GoodKind, HAPPY, IMMIGRANTS_PER_CYCLE, IMMIGRATION_HAPPINESS, LEVEL_UP_CYCLES, LEVEL_UP_HAPPINESS,
  LUMBER_TREES_PER_CYCLE, MARKET_SELL_PER_CYCLE, MAX_LEVEL, NET_LOFT_BONUS, NET_LOFT_RADIUS, OYSTER_YIELD,
  POLLUTION_HAPPY_SCALE, FOOD_PRICE, PURCHASABLE_BOATS, SAWMILL_RATE, SHIPYARD_BOAT_COST,
  SHIPYARD_CYCLES, SMOKEHOUSE_RATE, SPRING_LOW_BONUS, TAX_PER_RESIDENT, TIMBER_PER_TREE, TOOLWORKS_BONUS, TOOLWORKS_IRON_PER_CYCLE, TOOLWORKS_RADIUS, WAREHOUSE_CAP,
  COCONUT_PER_TREE, COCONUT_RADIUS, PEARL_RADIUS, PEARLS_PER_SHIFT, ICE_HOUSE_CAP_FACTOR, IRON_PER_CYCLE, SALT_PER_STOCKFISH, STOCKFISH_RATE, STOCKFISH_UNSALTED, WHALE_MEAT_PER_CYCLE, WHALE_OIL_PER_CYCLE,
  mayTurn } from "./balance";
import { at } from "./fields";
import { active, damageNear, fireSources, repairDamage, rollIgnitions } from "./fire";
import { biomeFor, BiomeId, costOf } from "./biomes";
import { whaleSeason } from "./biomes/fjord";
import { consumeLuxury, eat, favouriteInStock, foodsInStock, foodTotal, levelAllowed } from "./food";
import { goodsOfRole } from "./goods";
import { CARGO_SHIP_COST, CARGO_SHIP_IRON, CARGO_SHIPS_MAX, REMOVE_REFUND, STILT_COST_PER_UNIT } from "./balance";
import { LANES_ENABLED } from "../config";
import { repayLoan } from "./loan";
import { Grid } from "./grid";
import { moveMoney } from "./money";
import { depleteGround, fishAt, pollutionAt, routeWaste, settleFields } from "./pollution";
import { chooseGround } from "./sea";
import { announceLevel, rebuildCoverage, servesPeople } from "./services";
import { backedUpShares } from "./sewers";
import { levelCapacity, upkeepOf } from "./upgrades";
import { healInjuries, sharkSources } from "./sharks";
import { settleTrade } from "./trade";
import { Building, buildingList, Cell, notify, Phase, population, SimState } from "./state";
import { fellTrees, grownTreesNear, regrowTrees } from "./trees";
import { isSpringCycle } from "./tide";
import { assignWorkers, employed, staffing } from "./workers";

export function canAfford(state: SimState, cost: Cost): boolean {
  const r = state.resources;
  return r.money >= cost.money && r.planks >= (cost.planks ?? 0) && r.timber >= (cost.timber ?? 0);
}

export function pay(state: SimState, cost: Cost, why = "build"): void {
  const r = state.resources;
  moveMoney(state, -cost.money, why);
  r.planks -= cost.planks ?? 0;
  r.timber -= cost.timber ?? 0;
}

/** Does this kind size (and price) its own stilts? */
export function autoStilts(kind: BuildingKind): boolean {
  const f = BUILDINGS[kind].floor;
  return f === "stilts" || f === "street";
}

/** What a placement costs on a coast: its price there plus STILT_COST_PER_UNIT per unit of stilt length (auto-sized kinds). */
export function placeCost(kind: BuildingKind, stilt = 0, biome: BiomeId = "tidewater"): Cost {
  const c = costOf(kind, biome);
  if (!autoStilts(kind) || stilt <= 0) return c;
  return { ...c, money: Math.round(c.money + STILT_COST_PER_UNIT * stilt) };
}

/**
 * Validate, pay, and place a building anchored at `anchor`. Null (and nothing paid) when it can't go there.
 * `rot` is the player's quarter turn; null lets the door face the street (Grid.facing).
 */
export function tryPlace(state: SimState, grid: Grid, kind: BuildingKind, anchor: Cell, lift = 0, rot: number | null = null): Building | null {
  const cells = grid.footprint(kind, anchor, rot ?? 0);
  if (!cells || !grid.canPlace(kind, cells)) return null;
  const floor = grid.floorFor(kind, cells, autoStilts(kind) ? lift : 0);
  const cost = placeCost(kind, grid.stiltLength(kind, cells, floor), state.world.biome);
  if (!canAfford(state, cost)) return null;
  pay(state, cost);
  const firstHarbor = kind === "harbor" && !grid.isleOpen();
  const b = grid.place(kind, cells, autoStilts(kind) ? lift : 0, rot ?? (mayTurn(kind) ? grid.facing(cells) : 0));
  if (rot !== null && mayTurn(kind)) b.turned = true; // the player's turn: streets laid later leave it be
  if (firstHarbor) notify(state, "The ferry runs: the isle across the water is open to build on");
  return b;
}

/** Remove a building and refund part of its price, as city builders do, so a bad start can be undone. */
export function removeBuilding(state: SimState, grid: Grid, b: Building): number {
  const refund = Math.round(costOf(b.kind, state.world.biome).money * REMOVE_REFUND);
  grid.remove(b);
  moveMoney(state, refund, "refund");
  return refund;
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
  moveMoney(state, -BOAT_COST, "boat");
  at.boats++;
  notify(state, `A fishing boat is tied up at the ${BUILDINGS[at.kind].name.toLowerCase()}`);
  return true;
}

/** Storage cap for a good: the base plus every warehouse; an ice house (Fjord) doubles the fish. */
export function capFor(state: SimState, good: GoodKind): number {
  let n = 0, ice = false;
  for (const b of buildingList(state)) { if (b.kind === "warehouse") n++; if (b.kind === "iceHouse" && active(b)) ice = true; }
  const cap = CAP_BASE[good] + n * WAREHOUSE_CAP;
  return good === "fish" && ice ? cap * ICE_HOUSE_CAP_FACTOR : cap;
}

/** Add up to the cap and return what fit. A stock already over its cap (grants, a lost warehouse) is left alone. */
export function addCapped(state: SimState, good: GoodKind, amount: number): number {
  const before = state.resources[good];
  state.resources[good] = Math.max(before, Math.min(capFor(state, good), before + amount));
  return state.resources[good] - before;
}

/** Can boats moored here work this phase? Piers only at high water; docks whenever the water moves. */
export function sailsIn(b: Building, phase: Phase): boolean {
  if (b.kind === "pier" || b.kind === "iceBreakerPier") return phase === "high";
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

/** Output multiplier from a running toolworks (staffed, with iron this cycle) within TOOLWORKS_RADIUS of the building. */
export function toolBonus(state: SimState, at: Building): number {
  for (const b of buildingList(state)) {
    if (b.kind !== "toolworks" || b.output <= 0 || !active(b)) continue;
    const c = b.cells[0];
    if (at.cells.some(h => Math.abs(h.i - c.i) <= TOOLWORKS_RADIUS && Math.abs(h.j - c.j) <= TOOLWORKS_RADIUS)) return 1 + TOOLWORKS_BONUS;
  }
  return 1;
}

/** Shift start: boats leave for the richest ground in range, low-water crews walk out. */
export function shiftStart(state: SimState, grid: Grid, phase: Phase): void {
  // A frozen sea (the Fjord's ice cycles) keeps every boat in except those at an ice-breaker pier.
  const frozen = biomeFor(state).frozen?.(state) ?? false;
  for (const b of buildingList(state)) {
    if (!active(b)) continue;
    if (frozen && b.kind !== "iceBreakerPier") continue;
    if (isHarbour(b) && b.boats > 0 && sailsIn(b, phase) && staffing(b) > 0) {
      b.ground = chooseGround(grid, b, state.fields.fish);
      b.atSea = b.ground !== null;
    }
  }
}

/** Shift end: boats land a catch scaled by the ground's fish density and thin it; shellfish comes in from the flats. */
export function shiftEnd(state: SimState, grid: Grid, phase: Phase): void {
  // The low before a spring peak is a spring low. (This read the water level, which at the end of a low has risen
  // back to the low-water mark, so the spring-low bonus never paid: docs/world/decisions.md #3.)
  const springLow = phase === "low" && isSpringCycle(state.tide.cycle + 1);
  for (const b of buildingList(state)) {
    if (isHarbour(b) && b.atSea) {
      b.atSea = false;
      const density = b.ground ? fishAt(state, b.ground) : 0;
      const fish = b.boats * BOAT_BASE_FISH * staffing(b) * netLoftBonus(state, b) * toolBonus(state, b) * density * (biomeFor(state).harbourFactor?.(state, b) ?? 1);
      depleteGround(state, b);
      b.output += addCapped(state, biomeFor(state).catch ?? "fish", fish);
      state.last.fishCaught += fish;
      continue;
    }
    if (phase !== "low" || !active(b)) continue;
    if (b.kind === "oysterBed") {
      b.output += addCapped(state, "shellfish", OYSTER_YIELD * staffing(b) * toolBonus(state, b) * (springLow ? SPRING_LOW_BONUS : 1));
    } else if (b.kind === "clamCamp") {
      const cells = grid.exposedFlatsNear(b.cells, CLAM_RADIUS, state.tide.level);
      b.output += addCapped(state, "shellfish", cells * CLAM_PER_CELL * staffing(b) * toolBonus(state, b) * (springLow ? SPRING_LOW_BONUS : 1));
    } else if (b.kind === "divePlatform") {
      // Atoll: the divers work the low water; a pearl house within reach grades what they bring up.
      const graded = buildingList(state).some(p => p.kind === "pearlHouse" && active(p) && p.workers > 0 && p.cells.some(c => b.cells.some(d => Math.abs(c.i - d.i) <= PEARL_RADIUS && Math.abs(c.j - d.j) <= PEARL_RADIUS)));
      if (graded) b.output += addCapped(state, "pearls", PEARLS_PER_SHIFT * staffing(b) * toolBonus(state, b) * (springLow ? SPRING_LOW_BONUS : 1));
    }
  }
  biomeFor(state).shiftEnd?.(state, grid, phase, springLow);
}

/** Land production, once a cycle: wood, planks, smoked goods, and boats from the yard. */
function produce(state: SimState, grid: Grid, buildings: Building[]): void {
  const r = state.resources;
  // Toolworks first: they burn their iron now and every producer below reads the bonus off them (toolBonus).
  for (const b of buildings) {
    if (b.kind !== "toolworks") continue;
    b.output = 0;
    if (!active(b) || staffing(b) === 0) continue;
    const iron = Math.min(r.iron, TOOLWORKS_IRON_PER_CYCLE * staffing(b));
    r.iron -= iron;
    b.output = iron;
  }
  const producers = biomeFor(state).producers;
  for (const b of buildings) {
    if (!active(b) || staffing(b) === 0) continue;
    const s = staffing(b);
    const own = producers?.[b.kind];
    if (own) { b.output = own(state, grid, b, s); continue; }
    switch (b.kind) {
      case "lumberCamp": {
        const felled = fellTrees(state, b, LUMBER_TREES_PER_CYCLE * s);
        b.output = addCapped(state, "timber", felled * TIMBER_PER_TREE * toolBonus(state, b));
        break;
      }
      case "sawmill": {
        const timber = Math.min(r.timber, SAWMILL_RATE * s);
        r.timber -= timber;
        b.output = addCapped(state, "planks", timber * toolBonus(state, b));
        break;
      }
      case "smokehouse": {
        const fish = Math.min(r.fish, SMOKEHOUSE_RATE * s);
        r.fish -= fish;
        b.output = addCapped(state, "smoked", fish * toolBonus(state, b));
        break;
      }
      // Fjord (BIOMES.md §3.3)
      case "stockfishRacks": {
        const fish = Math.min(r.fish, STOCKFISH_RATE * s);
        const saltNeed = fish * SALT_PER_STOCKFISH;
        const salt = Math.min(r.salt, saltNeed);
        const salted = saltNeed > 0 ? salt / saltNeed : 0;
        r.fish -= fish; r.salt -= salt;
        b.output = addCapped(state, "stockfish", fish * (STOCKFISH_UNSALTED + (1 - STOCKFISH_UNSALTED) * salted) * toolBonus(state, b));
        break;
      }
      case "whalingStation": {
        if (!whaleSeason(state.tide.cycle) || b.boats === 0) { b.output = 0; break; }
        b.output = addCapped(state, "whaleOil", WHALE_OIL_PER_CYCLE * s * toolBonus(state, b));
        addCapped(state, "fish", WHALE_MEAT_PER_CYCLE * s);
        break;
      }
      case "ironMine": {
        b.output = addCapped(state, "iron", IRON_PER_CYCLE * s * toolBonus(state, b));
        break;
      }
      // Atoll (BIOMES.md §3.2)
      case "coconutGrove": {
        const palms = grownTreesNear(state, b.cells, COCONUT_RADIUS);
        b.output = addCapped(state, "coconut", palms * COCONUT_PER_TREE * s * toolBonus(state, b));
        break;
      }
      case "shipyard": {
        const berth = buildings.filter(h => isHarbour(h) && freeSlots(h) > 0)
          .sort((x, y) => dist(x, b) - dist(y, b) || x.id - y.id)[0];
        // Every berth full: with the lanes open, a harbor and iron in stock, it builds a cargo ship instead.
        if (!berth && LANES_ENABLED && buildings.some(h => h.kind === "harbor") && (state.cargoShips ?? 0) < CARGO_SHIPS_MAX
          && canAfford(state, CARGO_SHIP_COST) && state.resources.iron >= CARGO_SHIP_IRON) {
          b.progress += s;
          b.output = 0;
          if (b.progress >= SHIPYARD_CYCLES) {
            b.progress = 0;
            pay(state, CARGO_SHIP_COST, "shipyard");
            state.resources.iron -= CARGO_SHIP_IRON;
            state.cargoShips = (state.cargoShips ?? 0) + 1;
            b.output = 1;
            notify(state, "The shipyard launched a cargo ship for the lanes");
          }
          break;
        }
        if (!berth || !canAfford(state, SHIPYARD_BOAT_COST)) { b.output = 0; break; }
        b.progress += s;
        if (b.progress >= SHIPYARD_CYCLES) {
          b.progress = 0;
          pay(state, SHIPYARD_BOAT_COST, "shipyard");
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

/** The happiness formula (balance.HAPPY). `backedUp` is the share of the home's waste its sewer can't take (sim/sewers.ts). */
export function homeHappiness(state: SimState, home: Building, fed: number, jobs: number, grid: Grid, backedUp = 0): number {
  const c = home.cells[0];
  const cov = state.fields.coverage;
  const foul = Math.min(1, pollutionAt(state, c) / POLLUTION_HAPPY_SCALE);
  const cesspit = HAPPY.cesspit * backedUp;
  const injury = home.shock > 0 || home.injured > 0 ? HAPPY.injury : 0;
  const damage = home.damaged || damageNear(grid, c, DAMAGE_GRIEF_RADIUS) ? HAPPY.damage : 0;
  const favourite = favouriteInStock(state) ? HAPPY.favourite : 0;
  const biome = (biomeFor(state).happiness?.(state) ?? 0) + (biomeFor(state).homeHappiness?.(state, grid, home) ?? 0);
  const h = HAPPY.base + HAPPY.fed * fed + HAPPY.jobs * jobs + HAPPY.water * at(cov.water, c) + HAPPY.leisure * at(cov.leisure, c)
    + HAPPY.night * at(cov.night, c) + favourite + biome - HAPPY.pollution * foul - cesspit - injury - damage;
  return Math.max(0, Math.min(1, h));
}
const DAMAGE_GRIEF_RADIUS = 3;
const FOODS = goodsOfRole("food");

/** The cycle settlement, run once at every high-tide peak. quiet (the World ledger, sim/lanes.ts) skips the hazards: no ignitions. */
export function settleCycle(state: SimState, grid: Grid, opts: { quiet?: boolean } = {}): void {
  const r = state.resources;
  const stats = { cycle: state.tide.cycle, fishCaught: state.last.fishCaught, fishSold: 0, shellfishSold: 0, income: 0, expenses: 0, immigrants: 0, tourism: 0, trade: 0 };
  const buildings = buildingList(state).sort((a, b) => a.id - b.id);

  assignWorkers(state, grid);
  rebuildCoverage(state, grid);

  // Residents eat first (across every food kind in stock), pay tax, and judge their lot. The variety on the
  // table at the start of the meal is what the house levels read.
  const variety = foodsInStock(state).length;
  const backed = backedUpShares(state, grid);
  let pop = 0, happySum = 0, houses = 0, level3 = 0;
  for (const b of buildings) {
    if (BUILDINGS[b.kind].residents === 0) continue;
    if (b.residents === 0) { b.happiness = 1; b.streak = 0; continue; }
    pop += b.residents;
    const need = b.residents * FOOD_PER_CYCLE;
    const ate = eat(state, need);
    const fed = need > 0 ? ate / need : 1;
    const jobs = b.reached ? employed(state, b) / Math.max(1, b.residents - b.injured) : 0;
    b.happiness = homeHappiness(state, b, fed, jobs, grid, backed.get(b.id) ?? 0);
    happySum += b.happiness; houses++;
    // Growth: a run of good cycles adds a storey, once the table is varied enough for it (sim/food.ts).
    if (b.happiness >= LEVEL_UP_HAPPINESS) b.streak++; else b.streak = 0;
    if (b.streak >= LEVEL_UP_CYCLES && b.level < MAX_LEVEL && levelAllowed(state, b.level + 1, variety)) { b.level++; b.streak = 0; announceLevel(state, b); }
    if (b.level >= 3) level3 += b.residents;
  }
  consumeLuxury(state, level3);
  state.happiness = houses ? happySum / houses : 1;
  stats.income += pop * TAX_PER_RESIDENT;

  // Sales of food left beyond the town's reserve, kind by kind in registry order (the reserve is kept out of the
  // first kinds first); producers' per-cycle output counters reset here.
  const reserve = (pop + IMMIGRANTS_PER_CYCLE) * FOOD_PER_CYCLE * FOOD_RESERVE_CYCLES;
  for (const b of buildings) {
    if (b.kind !== "market") { if (BUILDINGS[b.kind].residents === 0 && !servesPeople(b.kind)) b.output = 0; continue; }
    b.output = 0;
    if (!active(b)) continue;
    let capacity = (levelCapacity(b) ?? MARKET_SELL_PER_CYCLE) * staffing(b);
    let keep = reserve;
    for (const g of FOODS) {
      const sold = Math.max(0, Math.min(r[g] - keep, capacity));
      r[g] -= sold; capacity -= sold; stats.income += sold * (FOOD_PRICE[g] ?? 0);
      if (g === "fish") stats.fishSold += sold; else stats.shellfishSold += sold;
      keep = Math.max(0, keep - r[g]);
      b.output += sold;
    }
  }
  // The commonest "why is nothing selling": every market is off the network or unstaffed at the peak. (A market
  // itself can't be under water — its stilts clear every tide — but the street to it can, at a spring peak.)
  const markets = buildings.filter(b => b.kind === "market");
  if (markets.length && !markets.some(b => active(b) && b.workers > 0) && r.fish > reserve) {
    notify(state, markets.some(b => !b.reached) ? "The market has no walkway to a pier: nothing sold"
      : population(state) === 0 ? "No one lives here yet to work the market: homes on the street fill at the next peak"
      : "The market has no workers: nothing sold");
  }

  produce(state, grid, buildings);
  regrowTrees(state);
  settleFields(state, grid);
  routeWaste(state, grid);
  state.sharkEmitters = sharkSources(state);
  state.fireEmitters = fireSources(state);
  if (!opts.quiet) rollIgnitions(state);
  repairDamage(state);
  healInjuries(state);

  // Upkeep, then the loan out of what is left of the cycle's earnings (never out of the purse).
  let upkeep = 0;
  for (const b of buildings) upkeep += upkeepOf(b);
  stats.expenses += upkeep;
  stats.expenses += repayLoan(state, stats.income - upkeep);
  moveMoney(state, stats.income - stats.expenses, "settlement");

  // The trade ship and the tourists (they move money themselves; the stats just record it).
  const moved = settleTrade(state, grid);
  stats.trade = moved.trade;
  stats.tourism = moved.tourism;
  stats.income += moved.tourism + Math.max(0, moved.trade);

  // Immigration: connected housing with room, food on hand, a town worth joining.
  if (foodTotal(state) > 0 && state.happiness >= IMMIGRATION_HAPPINESS) {
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
