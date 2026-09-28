// The goods registry: every stockpiled good the World trades, base and biome alike, in one table. A good has a
// role (foods feed residents and drive house levels; luxuries drive level 3; industrials feed buildings; minor
// goods only trade), a base storage cap (every warehouse raises every cap by WAREHOUSE_CAP), and the Trade
// Company's prices: what it pays an island per unit (`buys`, 0 when it does not buy) and what it charges to
// deliver a unit (`sells`, 0 when it does not carry it). Stockpiles are keyed by good id; nothing here is a rule.
export type GoodRole = "food" | "luxury" | "industrial" | "minor";

export type GoodId =
  | "fish" | "shellfish" | "smoked" | "timber" | "planks"
  | "rice" | "coconut" | "dates" | "crab" | "stockfish" | "taro"
  | "pearls" | "cocoa" | "indigo" | "whaleOil" | "coffee"
  | "salt" | "iron" | "glass" | "sulfur"
  | "sponges";

export interface GoodDef {
  id: GoodId;
  name: string;
  role: GoodRole;
  /** Storage before warehouses. */
  cap: number;
  /** What the company pays per unit when it buys from an island; 0 when it never buys. */
  buys: number;
  /** What the company charges per unit delivered; 0 when it never carries the good. */
  sells: number;
}

const def = (id: GoodId, name: string, role: GoodRole, cap: number, buys: number, sells: number): GoodDef => ({ id, name, role, cap, buys, sells });

export const GOODS: Record<GoodId, GoodDef> = {
  // Base goods (Tidewater's), at the prices the trade ship has always used.
  fish: def("fish", "fish", "food", 100, 5, 6),
  shellfish: def("shellfish", "shellfish", "food", 100, 0, 5),
  smoked: def("smoked", "smoked goods", "luxury", 60, 9, 14),
  timber: def("timber", "timber", "industrial", 80, 0, 4),
  planks: def("planks", "planks", "industrial", 60, 0, 3),
  // Foods of the other biomes (BIOMES.md §2).
  rice: def("rice", "rice", "food", 100, 0, 3),
  coconut: def("coconut", "coconut", "food", 100, 0, 3),
  dates: def("dates", "dates", "food", 100, 0, 3),
  crab: def("crab", "crab", "food", 100, 0, 4),
  stockfish: def("stockfish", "stockfish", "food", 100, 7, 6),
  taro: def("taro", "taro", "food", 100, 0, 3),
  // Luxuries: the company buys them (prices fall with volume) and carries them to islands that make none.
  pearls: def("pearls", "pearls", "luxury", 40, 14, 20),
  cocoa: def("cocoa", "cocoa", "luxury", 40, 12, 16),
  indigo: def("indigo", "indigo", "luxury", 40, 12, 16),
  whaleOil: def("whaleOil", "whale oil", "luxury", 40, 12, 16),
  coffee: def("coffee", "coffee", "luxury", 40, 12, 16),
  // Industrials: the company carries them; it does not buy them back.
  salt: def("salt", "salt", "industrial", 60, 0, 3),
  iron: def("iron", "iron", "industrial", 60, 0, 6),
  glass: def("glass", "glass", "industrial", 60, 0, 8),
  sulfur: def("sulfur", "sulfur", "industrial", 60, 0, 4),
  // Minor trade: the company buys, nobody wants it.
  sponges: def("sponges", "sponges", "minor", 40, 6, 0),
};

export const GOOD_IDS: readonly GoodId[] = Object.keys(GOODS) as GoodId[];
export const GOOD_ROLES: readonly GoodRole[] = ["food", "luxury", "industrial", "minor"];

export function goodsOfRole(role: GoodRole): GoodId[] {
  return GOOD_IDS.filter(g => GOODS[g].role === role);
}

export function isGood(id: string): id is GoodId {
  return id in GOODS;
}

/** A stockpile with every good at zero. */
export function emptyStock(): Record<GoodId, number> {
  const out = {} as Record<GoodId, number>;
  for (const g of GOOD_IDS) out[g] = 0;
  return out;
}


/**
 * Which goods the resource bar shows, in registry order: everything the island makes, plus anything it holds.
 * A good it cannot make and has none of stays hidden.
 */
export function shownGoods(stock: Record<GoodId, number>, makes: readonly GoodId[]): GoodId[] {
  return GOOD_IDS.filter(g => makes.includes(g) || stock[g] > 0);
}
