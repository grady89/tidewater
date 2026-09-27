// The trade ship and the tourists it brings. With a harbor, the ship calls every TRADE_EVERY cycles (2 with a
// lighthouse) at that cycle's high water: it buys smoked goods and surplus fish above the market price, delivers
// any plank order, swaps the tourists, and the view sails it in and out through that high water.
import {
  FOOD_PER_CYCLE, FOOD_RESERVE_CYCLES, IMMIGRANTS_PER_CYCLE, INN_CAPACITY, PLANK_ORDER_SIZE, TOURIST_BORED_FACTOR,
  TOURIST_SPEND, TOURISTS_PER_SHIP, TRADE_EVERY, TRADE_EVERY_LIGHTHOUSE, TRADE_PLANK_PRICE, TRADE_PRICE_FISH,
  TRADE_PRICE_SMOKED,
} from "./balance";
import { addCapped } from "./economy";
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

/** Queue planks for the next ship. Returns the order size now pending. */
export function orderPlanks(state: SimState, count = PLANK_ORDER_SIZE): number {
  state.trade.plankOrder += count;
  return state.trade.plankOrder;
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
    tourism = state.tourists * TOURIST_SPEND * (attractions(state, grid) ? 1 : TOURIST_BORED_FACTOR);
    moveMoney(state, tourism, "tourism");
  }

  if (state.tide.cycle >= t.nextVisit) {
    t.shipCycle = state.tide.cycle;
    t.visits++;
    // Buy smoked goods and any fish beyond the town's reserve.
    const smoked = r.smoked;
    r.smoked = 0; trade += smoked * TRADE_PRICE_SMOKED;
    const reserve = (population(state) + IMMIGRANTS_PER_CYCLE) * FOOD_PER_CYCLE * FOOD_RESERVE_CYCLES;
    const fish = Math.max(0, r.fish - reserve);
    r.fish -= fish; trade += fish * TRADE_PRICE_FISH;
    // Deliver planks that were ordered, as many as the purse allows.
    if (t.plankOrder > 0) {
      const affordable = Math.min(t.plankOrder, Math.floor((r.money + trade) / TRADE_PLANK_PRICE));
      const delivered = addCapped(state, "planks", affordable);
      trade -= delivered * TRADE_PLANK_PRICE;
      t.plankOrder = Math.max(0, t.plankOrder - delivered);
      if (delivered > 0) notify(state, `The trade ship unloaded ${delivered} planks`);
    }
    moveMoney(state, trade, "trade");
    // Tourists: the last party sails, a new one lands if there is room.
    const room = innCapacity(state);
    const arriving = Math.min(room, TOURISTS_PER_SHIP);
    state.tourists = arriving;
    const parts = [`The trade ship called`];
    if (smoked > 0 || fish > 0) parts.push(`bought ${Math.round(smoked)} smoked goods and ${Math.round(fish)} fish`);
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

