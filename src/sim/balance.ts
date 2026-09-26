// Every tunable number in the economy, and the building catalog. No system may hard-code a value that lives here.
import { RAISED_FLOOR } from "../config";

export type BuildingKind =
  | "hut" | "house" | "tallHouse"
  | "walkway" | "raisedWalkway"
  | "pier" | "dock" | "shipyard"
  | "market" | "oysterBed" | "clamCamp" | "lumberCamp" | "sawmill" | "smokehouse" | "netLoft" | "warehouse";
export type Category = "Homes" | "Streets" | "Sea" | "Production" | "Services" | "Leisure";
export const CATEGORIES: Category[] = ["Homes", "Streets", "Sea", "Production", "Services", "Leisure"];
/**
 * flat: terrain TIDE_LO..TIDE_HI. deep: below TIDE_LO. high: above TIDE_HI. flatOrDeep: anywhere under the
 * spring tide. shore: flat cell orthogonally adjacent to a high cell. edge: deep cells against the shore (piers
 * and shipyards extend seaward from the anchor).
 */
export type PlacementClass = "flat" | "deep" | "high" | "flatOrHigh" | "flatOrDeep" | "shore" | "edge";
export type ResourceKind = "money" | "fish" | "shellfish" | "smoked" | "timber" | "planks";
export type GoodKind = Exclude<ResourceKind, "money">;

export interface Cost { money: number; planks?: number; timber?: number }

export interface BuildingDef {
  name: string;
  category: Category;
  w: number;
  d: number;
  cls: PlacementClass;
  /** Extra terrain-height window on top of the class (oyster beds: covered at high, exposed at low). */
  terrain?: { min: number; max: number };
  /** Must touch a flat cell that carries a walkway (lumber camps on the hill). */
  needsWalkway?: boolean;
  /** At least one of this kind must exist first. */
  requires?: BuildingKind;
  cost: Cost;
  /** Jobs offered. Piers and docks offer BOAT_CREW per boat instead. */
  workers: number;
  residents: number;
  /** Money per cycle. */
  upkeep: number;
  /** Deck height in world Y; "stilts" = terrain + STILT_LENGTH; "ground" = on the terrain, never below 1.0. */
  floor: number | "stilts" | "ground";
  /** The network starts at roots (piers, docks), passes through links (walkways, markets) and ends at leaves. */
  network: "link" | "root" | "leaf";
  /** Boat slots (piers, docks). */
  slots?: number;
  desc: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hut: { name: "Hut", category: "Homes", w: 1, d: 1, cls: "flat", cost: { money: 40 }, workers: 0, residents: 2, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "2 residents" },
  house: { name: "House", category: "Homes", w: 1, d: 1, cls: "flat", cost: { money: 80 }, workers: 0, residents: 4, upkeep: 1, floor: 1.0, network: "leaf", desc: "4 residents" },
  tallHouse: { name: "Tall house", category: "Homes", w: 1, d: 1, cls: "flat", requires: "sawmill", cost: { money: 140, planks: 10 }, workers: 0, residents: 6, upkeep: 1.5, floor: 1.0, network: "leaf", desc: "6 residents; needs a sawmill" },
  walkway: { name: "Walkway", category: "Streets", w: 1, d: 1, cls: "flat", cost: { money: 5 }, workers: 0, residents: 0, upkeep: 0, floor: "stilts", network: "link", desc: "Stilts; floods on low ground" },
  raisedWalkway: { name: "Raised walkway", category: "Streets", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 12 }, workers: 0, residents: 0, upkeep: 0, floor: RAISED_FLOOR, network: "link", desc: "Never floods; crosses shallows" },
  pier: { name: "Pier", category: "Sea", w: 1, d: 2, cls: "edge", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 2, floor: 1.0, network: "root", slots: 2, desc: "2 boats; sail at high water only" },
  dock: { name: "Deep dock", category: "Sea", w: 2, d: 2, cls: "deep", cost: { money: 150, planks: 20 }, workers: 0, residents: 0, upkeep: 4, floor: 1.0, network: "root", slots: 4, desc: "4 boats; sail on every tide" },
  shipyard: { name: "Shipyard", category: "Sea", w: 3, d: 2, cls: "edge", cost: { money: 300, planks: 40 }, workers: 5, residents: 0, upkeep: 4, floor: 1.0, network: "leaf", desc: "Builds a boat from planks" },
  market: { name: "Fish market", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 3, residents: 0, upkeep: 3, floor: 1.0, network: "link", desc: "Sells fish each cycle" },
  oysterBed: { name: "Oyster bed", category: "Production", w: 1, d: 1, cls: "flat", terrain: { min: 0.0, max: 0.45 }, cost: { money: 30 }, workers: 2, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "Shellfish at low water" },
  clamCamp: { name: "Clam camp", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 70 }, workers: 4, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Rakes exposed flats within 6 at low water" },
  lumberCamp: { name: "Lumber camp", category: "Production", w: 2, d: 1, cls: "high", needsWalkway: true, cost: { money: 100 }, workers: 3, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Fells trees within 7; they regrow" },
  sawmill: { name: "Sawmill", category: "Production", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 180 }, workers: 3, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Timber → planks" },
  smokehouse: { name: "Smokehouse", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 160 }, workers: 3, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", desc: "Fish → smoked goods; fire risk" },
  netLoft: { name: "Net loft", category: "Production", w: 1, d: 1, cls: "flat", cost: { money: 90 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "+15% catch for boats within 8" },
  warehouse: { name: "Warehouse", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 0, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "+100 storage for every good" },
};

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];

export const STARTING_MONEY = 500;
export const STARTING_FISH = 10;

// Boats
export const BOAT_COST = 80;
export const BOAT_CREW = 2;
export const BOAT_BASE_FISH = 6;
/** How far (cells, by water) a boat will go from its harbour to fish. */
export const BOAT_RANGE = 14;
/** Grounds this close to the harbour are skipped when something further is reachable. */
export const BOAT_MIN_RANGE = 5;
/** The first boats are bought; after this many the shipyard is the only source. */
export const PURCHASABLE_BOATS = 2;

// Market
export const PRICE_FISH = 4;
export const PRICE_SHELLFISH = 3;
export const MARKET_SELL_PER_CYCLE = 30;

// Low-water producers
export const OYSTER_YIELD = 4;
export const CLAM_RADIUS = 6;
export const CLAM_PER_CELL = 0.15;
export const SPRING_LOW_BONUS = 2;

// Wood and the yard
export const LUMBER_RADIUS = 7;
export const LUMBER_TREES_PER_CYCLE = 4;
export const TIMBER_PER_TREE = 5;
export const TREE_REGROW_CYCLES = 6;
export const SAWMILL_RATE = 12;
export const SMOKEHOUSE_RATE = 8;
export const SHIPYARD_CYCLES = 2;
export const SHIPYARD_BOAT_COST: Cost = { money: 40, planks: 30 };
export const NET_LOFT_RADIUS = 8;
export const NET_LOFT_BONUS = 0.15;

// People
export const TAX_PER_RESIDENT = 1;
export const FOOD_PER_CYCLE = 0.5;
/** Markets keep this many cycles of the town's food before selling the rest. */
export const FOOD_RESERVE_CYCLES = 2;
export const IMMIGRANTS_PER_CYCLE = 4;
export const IMMIGRATION_HAPPINESS = 0.5;

// Stockpile caps before warehouses
export const CAP_BASE: Record<GoodKind, number> = { fish: 100, shellfish: 100, smoked: 60, timber: 80, planks: 60 };
export const WAREHOUSE_CAP = 100;
