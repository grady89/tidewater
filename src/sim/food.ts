// Food variety and the luxury rule (BIOMES.md §2). Any food feeds; residents eat across every food kind in stock in
// proportion to what there is. A home needs 2 distinct food kinds in stock to reach level 2, 3 kinds plus any one
// foreign luxury (one this biome does not make) for level 3; the biome's favourite luxury adds happiness on top.
import { LEVEL_FOODS, LUXURY_PER_RESIDENT } from "./balance";
import { favouriteOf, makesOf } from "./biomes";
import { GoodId, goodsOfRole } from "./goods";
import { SimState } from "./state";

const FOODS = goodsOfRole("food");
const LUXURIES = goodsOfRole("luxury");

/** Food kinds with any stock, in registry order. */
export function foodsInStock(state: SimState): GoodId[] {
  return FOODS.filter(g => state.resources[g] > 0);
}

/** Every food in the stockpile, summed. */
export function foodTotal(state: SimState): number {
  let n = 0;
  for (const g of FOODS) n += state.resources[g];
  return n;
}

/** Take `need` units of food across every kind in stock, in proportion to stock. Returns what was eaten. */
export function eat(state: SimState, need: number): number {
  const r = state.resources;
  const total = foodTotal(state);
  if (total <= 0 || need <= 0) return 0;
  if (total <= need) { for (const g of FOODS) r[g] = 0; return total; }
  let ate = 0;
  for (const g of FOODS) {
    if (r[g] <= 0) continue;
    const bite = need * r[g] / total;
    r[g] -= bite; ate += bite;
  }
  return ate;
}

/** Luxuries this biome does not make, with any stock. */
export function foreignLuxuriesInStock(state: SimState): GoodId[] {
  const makes = makesOf(state.world.biome);
  return LUXURIES.filter(g => !makes.includes(g) && state.resources[g] > 0);
}

export function favouriteInStock(state: SimState): boolean {
  return state.resources[favouriteOf(state.world.biome)] > 0;
}

/** Can a home rise to `level` on this cycle's stock? Level 2 wants two foods, level 3 three and a foreign luxury. */
export function levelAllowed(state: SimState, level: number, variety = foodsInStock(state).length): boolean {
  if (variety < (LEVEL_FOODS[level] ?? 0)) return false;
  if (level >= 3 && foreignLuxuriesInStock(state).length === 0) return false;
  return true;
}

/** Level-3 residents use a little of the foreign luxury every cycle, the first kind in stock first. */
export function consumeLuxury(state: SimState, residents: number): number {
  let need = residents * LUXURY_PER_RESIDENT;
  let used = 0;
  for (const g of foreignLuxuriesInStock(state)) {
    if (need <= 0) break;
    const take = Math.min(state.resources[g], need);
    state.resources[g] -= take; need -= take; used += take;
  }
  return used;
}
