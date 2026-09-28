// The trade ship and the tourists it brings. With a harbor, the ship calls every TRADE_EVERY cycles (2 with a
// lighthouse) at that cycle's high water: it buys the island's own goods (sim/goods.ts prices, sliding with volume) and
// surplus fish, delivers the order book (any good the island cannot make, plus planks), swaps the tourists, and
// the view sails it in and out through that high water.
import {
  COMPANY_FULL_PRICE_UNITS, COMPANY_PRICE_FLOOR, COMPANY_PRICE_SLOPE_UNITS, FOOD_PER_CYCLE, FOOD_RESERVE_CYCLES, IMMIGRANTS_PER_CYCLE, INN_CAPACITY,
  ORDER_SIZE, PLANK_ORDER_SIZE, TOURIST_BORED_FACTOR, TOURIST_SPEND, TOURISTS_PER_SHIP, TRADE_EVERY, TRADE_EVERY_LIGHTHOUSE, TRADE_PLANK_PRICE,
} from "./balance";
import { biomeFor, makesOf } from "./biomes";
import { addCapped } from "./economy";
import { GOOD_IDS, GoodId, GOODS } from "./goods";
import { Grid } from "./grid";
import { moveMoney } from "./money";
import { Building, buildingList, notify, population, SimState } from "./state";
import { staffing } from "./workers";

export function harborOf(state: SimState): Building | null {
  return buildingList(state).find(b => b.kind === "harbor" && !b.cut) ?? null;
}

export function hasLighthouse(state: SimState): boolean {
  return buildingList(state).some(b => b.kind === "lighthouse" && b.reached && !b.cut);
}

export function tradeInterval(state: SimState): number {
  return hasLighthouse(state) ? TRADE_EVERY_LIGHTHOUSE : TRADE_EVERY;
}

/** Room for tourists across reached inns: the beds are there without staff; staff make room for a full house. */
export function innCapacity(state: SimState): number {
  let n = 0;
  for (const b of buildingList(state)) if (b.kind === "inn" && b.reached && !b.cut) n += Math.round(INN_CAPACITY * (0.5 + 0.5 * staffing(b)));
  return n;
}

/**
 * What the company's ship carries to this island: every good it sells that the island cannot make, plus planks
 * (the ships' stores every harbor could always order). Registry order.
 */
export function companyCarries(state: SimState): GoodId[] {
  const makes = makesOf(state.world.biome);
  return GOOD_IDS.filter(g => g === "planks" || (GOODS[g].sells > 0 && !makes.includes(g)));
}

/** What the company buys here: the island's own goods with a buying price (never the cargo it delivered). */
export function companyBuys(state: SimState): GoodId[] {
  const makes = makesOf(state.world.biome);
  return GOOD_IDS.filter(g => GOODS[g].buys > 0 && makes.includes(g));
}

/** The company's delivered price per unit. */
export function companySells(good: GoodId): number {
  return good === "planks" ? TRADE_PLANK_PRICE : GOODS[good].sells;
}

/**
 * What the company pays for `units` of a good in one visit: the first COMPANY_FULL_PRICE_UNITS at the registry
 * price, then a price sliding to COMPANY_PRICE_FLOOR of it over COMPANY_PRICE_SLOPE_UNITS more. Fish is surplus,
 * not a luxury: flat price.
 */
export function companyPays(good: GoodId, units: number): number {
  const base = GOODS[good].buys;
  if (good === "fish") return units * base;
  let total = 0;
  for (let n = 0; n < Math.floor(units); n++) total += base * Math.max(COMPANY_PRICE_FLOOR, 1 - Math.max(0, n - COMPANY_FULL_PRICE_UNITS) / COMPANY_PRICE_SLOPE_UNITS);
  // A fractional last unit at the running price.
  const frac = units - Math.floor(units);
  if (frac > 0) total += frac * base * Math.max(COMPANY_PRICE_FLOOR, 1 - Math.max(0, Math.floor(units) - COMPANY_FULL_PRICE_UNITS) / COMPANY_PRICE_SLOPE_UNITS);
  return total;
}

/** Queue `count` units of a good the company carries here. Returns the units of it now pending (0 if it won't carry it). */
export function orderGood(state: SimState, good: GoodId, count: number = ORDER_SIZE): number {
  if (!companyCarries(state).includes(good)) return 0;
  const o = state.trade.orders;
  o[good] = (o[good] ?? 0) + count;
  return o[good]!;
}

/** Queue planks for the next ship (the original order button). Returns the planks now pending. */
export function orderPlanks(state: SimState, count = PLANK_ORDER_SIZE): number {
  return orderGood(state, "planks", count);
}

/** Units of a good on order. */
export function onOrder(state: SimState, good: GoodId): number {
  return state.trade.orders[good] ?? 0;
}

/** Is there somewhere for a tourist to spend? */
function attractions(state: SimState, grid: Grid): boolean {
  if (buildingList(state).some(b => (b.kind === "tavern" || b.kind === "bathhouse") && b.reached && !b.cut)) return true;
  for (let k = 0; k < grid.beach.length; k++) if (grid.beach[k]) return true;
  return false;
}

/**
 * Settlement: schedule the first visit when a harbor appears, run the visit on its cycle, and collect what the
 * tourists spend. Returns the money moved for the cycle stats.
 */
export function settleTrade(state: SimState, grid: Grid): { trade: number; tourism: number } {
  const t = state.trade;
  const harbor = harborOf(state);
  const r = state.resources;
  let trade = 0, tourism = 0;

  if (!harbor) {
    t.nextVisit = -1;
    if (state.tourists > 0) { state.tourists = 0; notify(state, "Without a harbor the tourists have gone"); }
    return { trade, tourism };
  }
  if (t.nextVisit < 0) t.nextVisit = state.tide.cycle + 1;

  // Tourists spend every cycle they're here.
  if (state.tourists > 0) {
    tourism = state.tourists * TOURIST_SPEND * (attractions(state, grid) ? 1 : TOURIST_BORED_FACTOR) * (biomeFor(state).tourism?.(state) ?? 1);
    moveMoney(state, tourism, "tourism");
  }

  // A frozen harbor (the Fjord's ice cycles) turns the ship back for a cycle.
  if (state.tide.cycle >= t.nextVisit && biomeFor(state).frozen?.(state)) {
    t.nextVisit = state.tide.cycle + 1;
    notify(state, "The trade ship turned back from the ice");
  }
  if (state.tide.cycle >= t.nextVisit) {
    t.shipCycle = state.tide.cycle;
    t.visits++;
    // Buy the island's own goods (smoked goods here; a Fjord's stockfish and whale oil) and any fish beyond the
    // town's reserve. Prices slide with the volume of one visit (companyPays).
    const bought: string[] = [];
    const reserve = (population(state) + IMMIGRANTS_PER_CYCLE) * FOOD_PER_CYCLE * FOOD_RESERVE_CYCLES;
    for (const good of companyBuys(state)) {
      const units = good === "fish" ? Math.max(0, r[good] - reserve) : r[good];
      if (units <= 0) continue;
      r[good] -= units; trade += companyPays(good, units);
      bought.push(`${Math.round(units)} ${GOODS[good].name}`);
    }
    // Deliver what was ordered, good by good in registry order, as much as the purse allows.
    for (const good of GOOD_IDS) {
      const pending = t.orders[good] ?? 0;
      if (pending <= 0) continue;
      const price = companySells(good);
      const affordable = Math.min(pending, Math.floor((r.money + trade) / price));
      const delivered = addCapped(state, good, affordable);
      trade -= delivered * price;
      const left = Math.max(0, pending - delivered);
      if (left > 0) t.orders[good] = left; else delete t.orders[good];
      if (delivered > 0) notify(state, `The trade ship unloaded ${delivered} ${GOODS[good].name}`);
    }
    moveMoney(state, trade, "trade");
    // Tourists: the last party sails, a new one lands if there is room.
    const room = innCapacity(state);
    const arriving = Math.min(room, TOURISTS_PER_SHIP);
    state.tourists = arriving;
    const parts = [`The trade ship called`];
    if (bought.length) parts.push(`bought ${bought.join(" and ")}`);
    if (arriving > 0) parts.push(`${arriving} tourists stepped ashore`);
    notify(state, parts.join(" · "));
    t.nextVisit = state.tide.cycle + tradeInterval(state);
  }
  return { trade, tourism };
}

/** Cycles until the ship, for the tide clock; -1 without a harbor. */
export function cyclesToShip(state: SimState): number {
  return state.trade.nextVisit < 0 ? -1 : Math.max(0, state.trade.nextVisit - state.tide.cycle);
}

