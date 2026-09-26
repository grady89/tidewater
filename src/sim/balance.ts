// Every tunable number in the economy, and the building catalog. No system may hard-code a value that lives here.
import { RAISED_FLOOR } from "../config";

export type BuildingKind =
  | "hut" | "house"
  | "walkway" | "raisedWalkway"
  | "pier" | "dock"
  | "market" | "oysterBed" | "clamCamp";
export type Category = "Homes" | "Streets" | "Sea" | "Production" | "Services" | "Leisure";
/**
 * flat: terrain TIDE_LO..TIDE_HI. deep: below TIDE_LO. high: above TIDE_HI. flatOrDeep: anywhere under the
 * spring tide. shore: flat cell orthogonally adjacent to a high cell. edge: deep cell adjacent to a flat cell
 * (piers extend one cell seaward from it).
 */
export type PlacementClass = "flat" | "deep" | "high" | "flatOrHigh" | "flatOrDeep" | "shore" | "edge";
export type ResourceKind = "money" | "fish" | "shellfish" | "smoked" | "timber" | "planks";

export interface Cost { money: number; planks?: number; timber?: number }

export interface BuildingDef {
  name: string;
  category: Category;
  w: number;
  d: number;
  cls: PlacementClass;
  /** Extra terrain-height window on top of the class (oyster beds: covered at high, exposed at low). */
  terrain?: { min: number; max: number };
  cost: Cost;
  /** Jobs offered. Piers and docks offer BOAT_CREW per boat instead. */
  workers: number;
  residents: number;
  /** Money per cycle. */
  upkeep: number;
  /** Deck height in world Y; "stilts" = terrain + STILT_LENGTH. */
  floor: number | "stilts";
  /** The network starts at roots (piers, docks), passes through links (walkways, markets) and ends at leaves. */
  network: "link" | "root" | "leaf";
  /** Boat slots (piers, docks). */
  slots?: number;
  desc: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hut: { name: "Hut", category: "Homes", w: 1, d: 1, cls: "flat", cost: { money: 40 }, workers: 0, residents: 2, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "2 residents" },
  house: { name: "House", category: "Homes", w: 1, d: 1, cls: "flat", cost: { money: 80 }, workers: 0, residents: 4, upkeep: 1, floor: 1.0, network: "leaf", desc: "4 residents" },
  walkway: { name: "Walkway", category: "Streets", w: 1, d: 1, cls: "flat", cost: { money: 5 }, workers: 0, residents: 0, upkeep: 0, floor: "stilts", network: "link", desc: "Stilts; floods on low ground" },
  raisedWalkway: { name: "Raised walkway", category: "Streets", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 12 }, workers: 0, residents: 0, upkeep: 0, floor: RAISED_FLOOR, network: "link", desc: "Never floods; crosses shallows" },
  pier: { name: "Pier", category: "Sea", w: 1, d: 2, cls: "edge", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 2, floor: 1.0, network: "root", slots: 2, desc: "2 boats; sail at high water only" },
  dock: { name: "Deep dock", category: "Sea", w: 2, d: 2, cls: "deep", cost: { money: 150, planks: 20 }, workers: 0, residents: 0, upkeep: 4, floor: 1.0, network: "root", slots: 4, desc: "4 boats; sail on every tide" },
  market: { name: "Fish market", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 3, residents: 0, upkeep: 3, floor: 1.0, network: "link", desc: "Sells fish each cycle" },
  oysterBed: { name: "Oyster bed", category: "Production", w: 1, d: 1, cls: "flat", terrain: { min: 0.0, max: 0.45 }, cost: { money: 30 }, workers: 2, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "Shellfish at low water" },
  clamCamp: { name: "Clam camp", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 70 }, workers: 4, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Rakes exposed flats within 6 at low water" },
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

// People
export const TAX_PER_RESIDENT = 1;
export const FOOD_PER_CYCLE = 0.5;
export const IMMIGRANTS_PER_CYCLE = 3;
export const IMMIGRATION_HAPPINESS = 0.5;

// Stockpile caps before warehouses
export const CAP_BASE: Record<Exclude<ResourceKind, "money">, number> = { fish: 100, shellfish: 100, smoked: 60, timber: 80, planks: 60 };
