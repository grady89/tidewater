// Every tunable number in the economy, and the building catalog. No system may hard-code a value that lives here.
import { CLEARANCE, DRY_TERRAIN, RAISED_FLOOR, SPRING_HI } from "../config";
import { GoodId, GOOD_IDS, GOODS } from "./goods";
import { Material } from "./materials";

export type BuildingKind =
  | "hut" | "house" | "tallHouse"
  | "walkway" | "raisedWalkway" | "path"
  | "pier" | "dock" | "shipyard"
  | "market" | "oysterBed" | "clamCamp" | "lumberCamp" | "sawmill" | "smokehouse" | "netLoft" | "warehouse"
  | "outfall" | "treatmentPlant" | "well" | "bathhouse" | "tavern" | "shrine" | "marketSquare"
  | "clinic" | "lifeguard" | "sharkNet"
  | "harbor" | "inn" | "lighthouse" | "fireWatch"
  | "breakwater" | "seaWall"
  | "toolworks"
  | "stockfishRacks" | "whalingStation" | "ironMine" | "iceHouse" | "iceBreakerPier"
  | "divePlatform" | "pearlHouse" | "coconutGrove" | "reefNursery"
  | "ricePaddy" | "crabPots" | "saltPan" | "indigoVats" | "wardenTower" | "crocNet"
  | "taroTerrace" | "cocoaTerrace" | "glassworks" | "sulfurWorks" | "hotSpring"
  | "dateGrove" | "coffeeTerrace" | "spongeDivers" | "greatCistern" | "dredger";

/** Service coverage layers; each building that provides one writes its staffed fraction within `radius`. */
export type ServiceKind = "water" | "leisure" | "night" | "treatment" | "lifeguard" | "firewatch";
export const SERVICE_KINDS: ServiceKind[] = ["water", "leisure", "night", "treatment", "lifeguard", "firewatch"];
export type Category = "Homes" | "Streets" | "Sea" | "Production" | "Services" | "Leisure" | "Land";
export const CATEGORIES: Category[] = ["Homes", "Streets", "Sea", "Production", "Services", "Leisure", "Land"];
/**
 * flat: terrain TIDE_LO..TIDE_HI. deep: below TIDE_LO. high: above TIDE_HI. flatOrDeep: anywhere under the
 * spring tide. shore: flat cell orthogonally adjacent to a high cell. edge: deep cells against the shore (piers
 * and shipyards extend seaward from the anchor). street: the flats and the beach band up to DRY_TERRAIN — wherever
 * a walkway on stilts is the street; paths take over on dry ground above it.
 */
export type PlacementClass = "flat" | "deep" | "high" | "flatOrHigh" | "flatOrDeep" | "shore" | "edge" | "beach" | "highOrEdge" | "street";
export type ResourceKind = "money" | GoodId;
/** A stockpiled good: any id in the goods registry (sim/goods.ts). */
export type GoodKind = GoodId;

export interface Cost { money: number; planks?: number; timber?: number }

export interface BuildingDef {
  name: string;
  category: Category;
  w: number;
  d: number;
  cls: PlacementClass;
  /** Extra terrain-height window on top of the class (oyster beds: covered at high, exposed at low). */
  terrain?: { min: number; max: number };
  /** The steepest ground the piece may stand on: the rise per cell along either axis (paths only). */
  maxRise?: number;
  /** A cell material every footprint cell must have (the biomes' pieces: a dive platform on the lagoon). */
  material?: Material;
  /** A cell of this material must lie beside the footprint (a coffee terrace by an oasis). */
  nearMaterial?: Material;
  /** Pollution a fully staffed one puts into the water each cycle, at its first cell (indigo vats). */
  pollution?: number;
  /** Fire risk a staffed one raises each cycle, spread over its cells (the glassworks). */
  fireRisk?: number;
  /** Predator risk cannot cross its cell (shark nets, croc nets). */
  stopsPredators?: boolean;
  /** Must touch a flat cell that carries a walkway (lumber camps on the hill). */
  needsWalkway?: boolean;
  /** Must touch a pier, dock, harbor or walkway (docks: crew walk in over a pier or a raised walkway). */
  needsLink?: boolean;
  /** At least one of this kind must exist first. */
  requires?: BuildingKind;
  cost: Cost;
  /** Jobs offered. Piers and docks offer BOAT_CREW per boat instead. */
  workers: number;
  residents: number;
  /** Money per cycle. */
  upkeep: number;
  /** Deck height in world Y. "stilts" and "street" size their own stilts (config.ts: STILT_MIN, CLEARANCE) —
   *  stilts clear the spring tide, street the ordinary one — snap up to neighbouring decks and take the lift;
   *  "ground" = on the terrain, never below 1.0; "terrain" = on the terrain exactly (paths); a number is fixed
   *  but never sinks below the terrain. */
  floor: number | "stilts" | "street" | "ground" | "terrain";
  /** The network starts at roots (piers, docks), passes through links (walkways, markets) and ends at leaves. */
  network: "link" | "root" | "leaf";
  /** Boat slots (piers, docks). */
  slots?: number;
  /** Service coverage this building provides, and how far. */
  service?: { kind: ServiceKind; radius: number };
  /** Must touch a building of this kind (market squares hug the fish market). */
  touches?: BuildingKind;
  desc: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hut: { name: "Hut", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 40 }, workers: 0, residents: 2, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "2 residents; on the flats or the hill" },
  house: { name: "House", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 80 }, workers: 0, residents: 4, upkeep: 1, floor: "stilts", network: "leaf", desc: "4 residents; on the flats or the hill" },
  tallHouse: { name: "Tall house", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", requires: "sawmill", cost: { money: 140, planks: 10 }, workers: 0, residents: 6, upkeep: 1.5, floor: "stilts", network: "leaf", desc: "6 residents; needs a sawmill" },
  walkway: { name: "Walkway", category: "Streets", w: 1, d: 1, cls: "street", cost: { money: 5 }, workers: 0, residents: 0, upkeep: 0, floor: "street", network: "link", desc: "Stilts sized to clear the tide; low ground floods at spring tides" },
  path: { name: "Path", category: "Streets", w: 1, d: 1, cls: "high", terrain: { min: DRY_TERRAIN, max: 99 }, maxRise: 0.7, cost: { money: 2 }, workers: 0, residents: 0, upkeep: 0, floor: "terrain", network: "link", desc: "Dirt track over dry land; joins the street to the hill" },
  raisedWalkway: { name: "Raised walkway", category: "Streets", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 12 }, workers: 0, residents: 0, upkeep: 0, floor: RAISED_FLOOR, network: "link", desc: "Spring-proof street at a fixed price; bridges deep water out to a dock" },
  pier: { name: "Pier", category: "Sea", w: 1, d: 2, cls: "edge", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 2, floor: 1.0, network: "root", slots: 2, desc: "2 boats; sail at high water only" },
  dock: { name: "Deep dock", category: "Sea", w: 2, d: 2, cls: "deep", needsLink: true, cost: { money: 150, planks: 20 }, workers: 0, residents: 0, upkeep: 4, floor: 1.0, network: "root", slots: 4, desc: "4 boats; sail on every tide; reach it by pier or raised walkway" },
  shipyard: { name: "Shipyard", category: "Sea", w: 3, d: 2, cls: "edge", cost: { money: 300, planks: 40 }, workers: 5, residents: 0, upkeep: 4, floor: 1.0, network: "leaf", desc: "Builds a boat from planks" },
  market: { name: "Fish market", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 1, residents: 0, upkeep: 3, floor: "stilts", network: "link", desc: "Sells fish each cycle" },
  oysterBed: { name: "Oyster bed", category: "Production", w: 1, d: 1, cls: "flat", terrain: { min: 0.0, max: 0.45 }, cost: { money: 30 }, workers: 2, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "Shellfish at low water" },
  clamCamp: { name: "Clam camp", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 70 }, workers: 4, residents: 0, upkeep: 1, floor: "stilts", network: "leaf", desc: "Rakes exposed flats within 6 at low water" },
  lumberCamp: { name: "Lumber camp", category: "Production", w: 2, d: 1, cls: "high", needsWalkway: true, cost: { money: 100 }, workers: 3, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Fells trees within 7; they regrow" },
  sawmill: { name: "Sawmill", category: "Production", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 180 }, workers: 3, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Timber → planks" },
  smokehouse: { name: "Smokehouse", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 160 }, workers: 3, residents: 0, upkeep: 2, floor: "stilts", network: "leaf", desc: "Fish → smoked goods; fire risk" },
  netLoft: { name: "Net loft", category: "Production", w: 1, d: 1, cls: "flat", cost: { money: 90 }, workers: 0, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "+15% catch for boats within 8" },
  warehouse: { name: "Warehouse", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 0, residents: 0, upkeep: 1, floor: "stilts", network: "leaf", desc: "+100 storage for every good" },
  toolworks: { name: "Toolworks", category: "Production", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 220, planks: 10 }, workers: 3, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Burns a little iron: +20% output for producers within 8" },
  // Fjord (BIOMES.md §3.3)
  stockfishRacks: { name: "Stockfish racks", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 110 }, workers: 2, residents: 0, upkeep: 1, floor: "stilts", network: "leaf", desc: "Fish + salt → stockfish; plain dried fish at half value without salt" },
  whalingStation: { name: "Whaling station", category: "Sea", w: 3, d: 2, cls: "edge", cost: { money: 400, planks: 30 }, workers: 6, residents: 0, upkeep: 4, floor: 1.0, network: "leaf", slots: 1, desc: "Whale oil and meat in whale season; needs a boat" },
  ironMine: { name: "Iron mine", category: "Production", w: 2, d: 2, cls: "high", cost: { money: 260 }, workers: 4, residents: 0, upkeep: 3, floor: "ground", network: "leaf", desc: "Iron from the ridge; fire risk" },
  iceHouse: { name: "Ice house", category: "Production", w: 1, d: 1, cls: "flat", cost: { money: 90 }, workers: 0, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "Keeps fish from spoiling: doubles the fish cap" },
  iceBreakerPier: { name: "Ice-breaker pier", category: "Sea", w: 1, d: 2, cls: "edge", cost: { money: 300, planks: 20 }, workers: 0, residents: 0, upkeep: 4, floor: 1.0, network: "root", slots: 2, desc: "2 boats; keeps sailing through the sea ice" },
  // Atoll (BIOMES.md §3.2)
  divePlatform: { name: "Dive platform", category: "Sea", w: 1, d: 1, cls: "edge", material: "lagoon", needsLink: true, cost: { money: 140 }, workers: 2, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Pearls from the lagoon at low water; a pearl house within 8 grades them" },
  pearlHouse: { name: "Pearl house", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 180 }, workers: 2, residents: 0, upkeep: 1.5, floor: "stilts", network: "leaf", desc: "Grades the divers' pearls for the trade ship" },
  coconutGrove: { name: "Coconut grove", category: "Production", w: 2, d: 1, cls: "flatOrHigh", cost: { money: 90 }, workers: 3, residents: 0, upkeep: 1, floor: "stilts", network: "leaf", desc: "Gathers coconuts from palms within 6" },
  reefNursery: { name: "Reef nursery", category: "Sea", w: 1, d: 1, cls: "deep", material: "lagoon", needsLink: true, cost: { money: 160 }, workers: 1, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Restores fish and coral within 5 while the water stays clean" },
  // Delta (BIOMES.md §3.4)
  ricePaddy: { name: "Rice paddy", category: "Production", w: 2, d: 2, cls: "flat", terrain: { min: 0.0, max: 0.45 }, cost: { money: 100 }, workers: 3, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Flooded at high water, planted at low: rice every two cycles on fresh water (the river's reach or a well's); the whole crop at a spring low" },
  crabPots: { name: "Crab pots", category: "Sea", w: 1, d: 1, cls: "edge", cost: { money: 50 }, workers: 1, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "Crab from the channel at low water; on a channel's edge" },
  saltPan: { name: "Salt pan", category: "Production", w: 2, d: 2, cls: "flatOrHigh", terrain: { min: 0.45, max: 1.4 }, cost: { money: 110 }, workers: 2, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Sun-dried salt on the upper flats and the levee; half as much in a storm" },
  indigoVats: { name: "Indigo vats", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 150 }, workers: 3, residents: 0, upkeep: 1.5, floor: "stilts", network: "leaf", pollution: 3, desc: "Indigo from the wild plants on the open flats within 6; fouls the water — put it downstream" },
  wardenTower: { name: "Warden tower", category: "Services", w: 1, d: 1, cls: "flat", cost: { money: 90 }, workers: 1, residents: 0, upkeep: 1, floor: "stilts", network: "leaf", service: { kind: "lifeguard", radius: 5 }, desc: "Crocodile attacks within 5 drop 80%" },
  // Cinder (BIOMES.md §3.5)
  taroTerrace: { name: "Taro terrace", category: "Production", w: 2, d: 2, cls: "high", material: "fertile", cost: { money: 110 }, workers: 3, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Taro on the fertile band; half as much under ash" },
  cocoaTerrace: { name: "Cocoa terrace", category: "Production", w: 2, d: 2, cls: "high", material: "fertile", cost: { money: 150 }, workers: 3, residents: 0, upkeep: 1.5, floor: "ground", network: "leaf", desc: "Cocoa on the fertile band; half as much under ash" },
  glassworks: { name: "Glassworks", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 240 }, workers: 4, residents: 0, upkeep: 2.5, floor: "stilts", network: "leaf", fireRisk: 5, desc: "Glass from the black sand; burns sulfur, or timber when there is none; fire risk" },
  sulfurWorks: { name: "Sulfur works", category: "Production", w: 1, d: 1, cls: "high", material: "vent", cost: { money: 120 }, workers: 2, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Sulfur from a steam vent" },
  hotSpring: { name: "Hot-spring bathhouse", category: "Leisure", w: 2, d: 1, cls: "flat", material: "spring", cost: { money: 260 }, workers: 2, residents: 0, upkeep: 2, floor: "stilts", network: "leaf", service: { kind: "leisure", radius: 14 }, desc: "The strongest leisure on the World (within 14), on a hot spring; the tourists come for it" },
  // Dunes (BIOMES.md §3.6)
  dateGrove: { name: "Date grove", category: "Production", w: 2, d: 2, cls: "high", material: "oasis", cost: { money: 90 }, workers: 2, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Dates from the palms of an oasis" },
  coffeeTerrace: { name: "Coffee terrace", category: "Production", w: 2, d: 1, cls: "high", nearMaterial: "oasis", cost: { money: 140 }, workers: 3, residents: 0, upkeep: 1.5, floor: "ground", network: "leaf", desc: "Coffee beside an oasis" },
  spongeDivers: { name: "Sponge divers' hut", category: "Production", w: 1, d: 1, cls: "edge", material: "lagoon", cost: { money: 70 }, workers: 2, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Sponges from the lagoon at each low water" },
  greatCistern: { name: "Great cistern", category: "Services", w: 3, d: 3, cls: "flat", cost: { money: 300 }, workers: 2, residents: 0, upkeep: 3, floor: "stilts", network: "leaf", service: { kind: "water", radius: 16 }, desc: "Water for homes within 16 (wells here reach 3); holds half through a drought" },
  dredger: { name: "Dredger", category: "Sea", w: 1, d: 1, cls: "deep", touches: "harbor", cost: { money: 220 }, workers: 2, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", desc: "Beside the harbor: clears the silt a sandstorm leaves" },
  crocNet: { name: "Croc net", category: "Sea", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 20 }, workers: 0, residents: 0, upkeep: 0.1, floor: 1.0, network: "leaf", stopsPredators: true, desc: "Per water cell; crocodiles can't cross" },
  outfall: { name: "Sewage outfall", category: "Services", w: 1, d: 1, cls: "edge", cost: { money: 40 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "Dumps the town's waste into the sea; the tide carries it" },
  treatmentPlant: { name: "Treatment plant", category: "Services", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 350 }, workers: 4, residents: 0, upkeep: 3, floor: "ground", network: "leaf", service: { kind: "treatment", radius: 12 }, desc: "Neutralises waste from homes within 12" },
  well: { name: "Well", category: "Services", w: 1, d: 1, cls: "flat", cost: { money: 50 }, workers: 0, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", service: { kind: "water", radius: 8 }, desc: "Drinking water for homes within 8" },
  bathhouse: { name: "Bathhouse", category: "Leisure", w: 2, d: 1, cls: "shore", cost: { money: 130 }, workers: 0, residents: 0, upkeep: 1.5, floor: "stilts", network: "leaf", service: { kind: "leisure", radius: 8 }, desc: "Leisure for homes within 8; on the shore" },
  tavern: { name: "Tavern", category: "Leisure", w: 2, d: 1, cls: "flat", cost: { money: 150 }, workers: 2, residents: 0, upkeep: 2, floor: "stilts", network: "leaf", service: { kind: "leisure", radius: 10 }, desc: "Leisure within 10; pours smoked goods" },
  shrine: { name: "Shrine", category: "Leisure", w: 1, d: 1, cls: "flat", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 0.25, floor: "stilts", network: "leaf", service: { kind: "leisure", radius: 4 }, desc: "A little calm within 4" },
  marketSquare: { name: "Market square", category: "Leisure", w: 2, d: 2, cls: "flat", touches: "market", cost: { money: 100 }, workers: 0, residents: 0, upkeep: 0.5, floor: "stilts", network: "link", service: { kind: "leisure", radius: 6 }, desc: "Leisure within 6; must touch the fish market" },
  clinic: { name: "Clinic", category: "Services", w: 2, d: 1, cls: "flat", cost: { money: 200 }, workers: 3, residents: 0, upkeep: 2, floor: "stilts", network: "leaf", desc: "Heals the injured so they can work again" },
  lifeguard: { name: "Lifeguard tower", category: "Services", w: 1, d: 1, cls: "beach", cost: { money: 90 }, workers: 1, residents: 0, upkeep: 1, floor: "ground", network: "leaf", service: { kind: "lifeguard", radius: 5 }, desc: "On a beach; shark incidents within 5 drop 80%" },
  sharkNet: { name: "Shark net", category: "Sea", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 20 }, workers: 0, residents: 0, upkeep: 0.1, floor: 1.0, network: "leaf", stopsPredators: true, desc: "Per water cell; shark risk can't cross" },
  harbor: { name: "Harbor", category: "Sea", w: 3, d: 3, cls: "deep", terrain: { min: -99, max: -1.5 }, cost: { money: 600, planks: 60 }, workers: 0, residents: 0, upkeep: 6, floor: 1.0, network: "root", slots: 6, desc: "Trade ship berth; 6 boats; needs water deeper than 1.5" },
  inn: { name: "Inn", category: "Leisure", w: 2, d: 2, cls: "flat", cost: { money: 250, planks: 20 }, workers: 2, residents: 0, upkeep: 2, floor: "stilts", network: "leaf", desc: "Tourists off the trade ship stay and spend" },
  lighthouse: { name: "Lighthouse", category: "Sea", w: 1, d: 1, cls: "highOrEdge", cost: { money: 400 }, workers: 0, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Boats ride out storms; the trade ship calls every 2 tides" },
  fireWatch: { name: "Fire watch", category: "Services", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 120 }, workers: 2, residents: 0, upkeep: 1.5, floor: "ground", network: "leaf", service: { kind: "firewatch", radius: 8 }, desc: "Damps fire risk and puts out fires within 8" },
  breakwater: { name: "Breakwater", category: "Sea", w: 1, d: 1, cls: "deep", cost: { money: 60, planks: 4 }, workers: 0, residents: 0, upkeep: 0.2, floor: 1.0, network: "leaf", desc: "Per cell; shelters harbours within 6 from storms and blocks the wave" },
  seaWall: { name: "Sea wall", category: "Sea", w: 1, d: 1, cls: "shore", cost: { money: 25, timber: 3 }, workers: 0, residents: 0, upkeep: 0.1, floor: "ground", network: "leaf", desc: "Per cell on the shore (flats against the hill); shields what stands behind it from the wave" },
};

/** The ferry crossing between the harbor and the isle's piers, as walking distance for job assignment. */
export const FERRY_COST = 10;

// A seeded island must offer a playable start (island.ts); candidates that don't are rerolled.
export const ISLAND_MIN_FLATS = 400;
export const ISLAND_MIN_REGION = 250;
export const ISLAND_MIN_PIER_SITES = 3;
export const ISLAND_MIN_HARBOR_SITES = 1;
export const ISLAND_MIN_TREED = 60;
export const ISLAND_MAX_REROLLS = 32;

// Loans (one at a time): the lump sum, the interest on it, and how many settlements repay it.
export const LOAN_AMOUNT = 300;
export const LOAN_INTEREST = 0.2;
export const LOAN_REPAY_CYCLES = 15;
/** Settlements before the first instalment: time to get the money earning. */
export const LOAN_GRACE_CYCLES = 3;

// Land tools
/** Landfill raises a flat cell to this height: dry at every tide, still below the hill. */
export const LANDFILL_HEIGHT = 0.9;
export const LANDFILL_COST = { money: 45, timber: 4 };
export const PLANT_COST = 3;
/** Timber from clearing a grown tree by hand. */
export const CLEAR_TIMBER = 1;
/** What clearing a tree on a cell of this material does instead: its timber, and pollution let into the water (mangroves). */
export const CLEAR_BY_MATERIAL: Partial<Record<Material, { timber: number; pollution: number }>> = {
  // A mangrove gives no timber that mills (BIOMES.md §2) and stirs the mud: a burst of pollution on its cell.
  mangrove: { timber: 0, pollution: 0.4 },
};

/** Share of a building's money cost returned when the player removes it (planks and timber are not returned). */
export const REMOVE_REFUND = 0.5;
/** Stilts cost money per unit of length (floor − terrain) on top of a piece's base price: low ground is dear. */
export const STILT_COST_PER_UNIT = 6;
/** Auto-sized decks can be lifted above their safe height (never below): LIFT_STEP metres a step, up to LIFT_MAX
 *  steps; the extra stilt length is priced like any other. */
export const LIFT_STEP = 0.2;
export const LIFT_MAX = 4;

// Storms
export const STORM_FIRST_CYCLE = 6;
export const STORM_CHANCE = 0.12;
export const STORM_LOSS_CHANCE = 0.5;
/** Storms take no boats before this cycle: the early town has no breakwater to buy yet, and one boat to its name. */
export const STORM_LOSS_FIRST_CYCLE = 20;
/** Harbours with a breakwater within this many cells are sheltered. */
export const SHELTER_RADIUS = 6;
export const STORM_WAVE_AMP = 3;

// Tsunami
export const TSUNAMI_FIRST_CYCLE = 20;
export const TSUNAMI_CHANCE = 0.05;
export const TSUNAMI_COOLDOWN = 12;
export const DRAWDOWN_SECONDS = 20;
export const DRAWDOWN_LEVEL = -1.2;
/** The wave takes every unshielded deck that isn't at least WAVE_MARGIN above the safe building height. */
export const WAVE_MARGIN = 0.45;
export const WAVE_HEIGHT = SPRING_HI + CLEARANCE + WAVE_MARGIN;
export const WAVE_SPEED = 10;
export const WAVE_WIDTH = 3;
export const WAVE_SETTLE_SECONDS = 6;
/** A wall or breakwater this far along the wave axis in front of a cell shields it. */
export const SHIELD_RANGE = 12;

// Fire (risk field units per cell; steady state ≈ emission / (120 × (decay + 4 × diffuse)) per cell: a lone
// smokehouse settles near 0.8, two side by side pass 1, three reach ~1.5)
export const FIRE_SMOKEHOUSE = 6;
export const FIRE_TAVERN = 3;
export const FIRE_LANTERN = 0.3;
export const FIRE_DECAY = 0.01;
export const FIRE_DIFFUSE = 0.005;
/** Fire risk doesn't move with the tide. */
export const FIRE_ADVECT_NONE = 0;
/** A staffed fire watch cuts effective risk by this much within its radius. */
export const FIRE_WATCH_CUT = 0.97;
/** No ignition below this effective risk. */
export const FIRE_IGNITE_THRESHOLD = 1.0;
/** Ignition chance per cycle per unit of effective risk above the threshold. */
export const FIRE_IGNITE_CHANCE = 0.05;
export const FIRE_BURN_SECONDS = 24;
/** Chance per second that a burning building lights each orthogonal neighbour (~30 % over a full burn). */
export const FIRE_SPREAD_PER_S = 0.015;
/** Fire-watch coverage at or above this saves a burning building from damage. */
export const FIRE_SAVE_COVERAGE = 0.5;

// Repair (shared with storms and the tsunami)
export const REPAIR_FRACTION = 0.5;
export const REPAIR_TIMBER_PER_100 = 5;

// Trade and tourism
export const TRADE_EVERY = 3;
export const TRADE_EVERY_LIGHTHOUSE = 2;
export const TRADE_PLANK_PRICE = 3;
export const PLANK_ORDER_SIZE = 20;
export const TOURISTS_PER_SHIP = 4;
export const INN_CAPACITY = 6;
export const TOURIST_SPEND = 6;
/** Tourism spend without a tavern, bathhouse or beach to spend it at. */
export const TOURIST_BORED_FACTOR = 0.4;

// Beaches and sharks
/** Sand above the tide line up to this height counts as beach when it touches water. */
export const BEACH_MAX_HEIGHT = 0.95;
export const SWIM_RADIUS = 10;
/** Share of nearby residents on the beach at high water in daytime. */
export const SWIM_FRACTION = 0.3;
export const SHARK_MARKET = 8;
export const SHARK_DOCK = 4;
/** Per second. Low, so the plume reaches a few cells (e-folding ≈ sqrt(diffuse/decay) ≈ 5 cells). */
export const SHARK_DECAY = 0.003;
export const SHARK_DIFFUSE = 0.08;
export const SHARK_ADVECT = 0.03;
/** Incident chance per high-water shift at a beach = risk × swimmers × this (× 2 at night, × 0.2 under a lifeguard). */
export const INCIDENT_SCALE = 0.25;
export const NIGHT_RISK = 2;
export const LIFEGUARD_CUT = 0.8;
/** Cycles an injury keeps a resident off work without a clinic. */
export const INJURY_NATURAL_CYCLES = 6;
export const CLINIC_HEAL_PER_CYCLE = 2;
/** Cycles a nearby incident weighs on homes within INJURY_RADIUS. */
export const INJURY_MEMORY = 3;
export const INJURY_RADIUS = 6;

/** Lantern posts go on a walkway cell rather than taking one. */
export const LANTERN_COST = 8;
export const LANTERN_RADIUS = 3;
export const TAVERN_SMOKED_PER_CYCLE = 2;
/** Tavern coverage without smoked goods to pour. */
export const TAVERN_DRY_FACTOR = 0.5;

export const BUILDING_KINDS = Object.keys(BUILDINGS) as BuildingKind[];

export const STARTING_MONEY = 650;
export const STARTING_FISH = 10;

// Boats
export const BOAT_COST = 80;
export const BOAT_CREW = 2;
export const BOAT_BASE_FISH = 6;
/** How far (cells, by water) a boat will go from its harbour to fish. */
export const BOAT_RANGE = 14;
/** Grounds this close to the harbour are skipped when something further is reachable. */
export const BOAT_MIN_RANGE = 7;
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

/**
 * Happiness per home, clamped to 0..1. Weights sum to 1 when everything is provided; a fed, employed home with no
 * services sits at 0.7 (above the immigration bar), a fed but idle one at 0.4 (below it); penalties come off the top.
 */
export const HAPPY = {
  base: 0.10,
  fed: 0.30,
  jobs: 0.30,
  water: 0.10,
  leisure: 0.12,
  night: 0.08,
  pollution: 0.5,
  injury: 0.2,
  damage: 0.15,
  /** The biome's favourite luxury in stock (BIOMES.md §2). */
  favourite: 0.05,
};
/** Homes above this for LEVEL_UP_CYCLES cycles in a row grow a level (1..3): +1 resident per level, a nicer roof. */
export const LEVEL_UP_HAPPINESS = 0.8;
export const LEVEL_UP_CYCLES = 3;
export const MAX_LEVEL = 3;

// Pollution (field units per cell; a small town's outfall cell settles around 1, its neighbours around 0.4)
export const WASTE_PER_RESIDENT = 2;
export const SMOKEHOUSE_POLLUTION = 4;
export const DOCK_POLLUTION = 1.5;
/** Per second. */
export const POLLUTION_DECAY = 0.006;
/** Fraction handed to each neighbour per second. */
export const POLLUTION_DIFFUSE = 0.03;
/** Fraction carried along the tide's flow per second. */
export const POLLUTION_ADVECT = 0.05;
export const OYSTER_POLLUTION_KILL = 0.25;
export const OYSTER_KILL_CYCLES = 2;
export const TREATMENT_RADIUS = 12;
/** Pollution at home that costs a full happiness point. */
export const POLLUTION_HAPPY_SCALE = 8;
/** Waste with nowhere to go piles up cycle after cycle; each unit costs this much happiness, up to the cap. */
export const WASTE_BACKLOG_PENALTY_PER_UNIT = 0.003;
export const WASTE_BACKLOG_PENALTY_MAX = 0.3;
/** How fast an outfall works off a backlog, in units per cycle on top of the current waste. */
export const WASTE_BACKLOG_DRAIN = 30;

// Fish density (deep cells, 0..FISH_CAP)
export const FISH_CAP = 1;
export const FISH_REGEN = 0.15;
export const FISH_DEPLETE_PER_BOAT = 0.12;
export const FISH_FLOOR = 0.05;

// Stockpile caps before warehouses
export const CAP_BASE: Record<GoodKind, number> = Object.fromEntries(GOOD_IDS.map(g => [g, GOODS[g].cap])) as Record<GoodKind, number>;
export const WAREHOUSE_CAP = 100;

// Food variety and luxuries (BIOMES.md §2; sim/food.ts)
/** Distinct food kinds in stock a home needs to hold each level (index = level). */
export const LEVEL_FOODS: readonly number[] = [0, 1, 2, 3];
/** Foreign luxury a level-3 resident uses per cycle. */
export const LUXURY_PER_RESIDENT = 0.02;
/** Market price of each food (fish and shellfish keep PRICE_FISH / PRICE_SHELLFISH). */
export const FOOD_PRICE: Record<string, number> = { fish: PRICE_FISH, shellfish: PRICE_SHELLFISH, rice: 3, coconut: 3, dates: 3, crab: 4, stockfish: 6, taro: 3 };

// Toolworks (BIOMES.md §2: iron)
export const TOOLWORKS_RADIUS = 8;
export const TOOLWORKS_BONUS = 0.20;
/** Iron a fully staffed toolworks uses per cycle. */
export const TOOLWORKS_IRON_PER_CYCLE = 0.5;

// The Trade Company as carrier (BIOMES.md §4; sim/trade.ts)
/** Units of a good the company buys at full price in one visit; beyond that the price slides. */
export const COMPANY_FULL_PRICE_UNITS = 60;
/** Units over which the price slides from full down to COMPANY_PRICE_FLOOR. */
export const COMPANY_PRICE_SLOPE_UNITS = 120;
export const COMPANY_PRICE_FLOOR = 0.5;
/** Units per click of an order button. */
export const ORDER_SIZE = PLANK_ORDER_SIZE;

// Fjord (BIOMES.md §3.3)
/** Fish a fully staffed rack dries per cycle, and the salt each unit takes. */
export const STOCKFISH_RATE = 6;
export const SALT_PER_STOCKFISH = 0.2;
/** Without salt the racks make plain dried fish: this fraction of the stockfish. */
export const STOCKFISH_UNSALTED = 0.6;
/** Whale season: every WHALE_SEASON_EVERY cycles, for WHALE_SEASON_LENGTH cycles, from WHALE_SEASON_FIRST. */
export const WHALE_SEASON_EVERY = 10;
export const WHALE_SEASON_LENGTH = 3;
export const WHALE_SEASON_FIRST = 4;
/** A fully staffed, boated station's whale oil and meat (fish) per season cycle. */
export const WHALE_OIL_PER_CYCLE = 6;
export const WHALE_MEAT_PER_CYCLE = 10;
export const IRON_PER_CYCLE = 3;
export const FIRE_MINE = 4;
/** The ice house doubles the fish cap. */
export const ICE_HOUSE_CAP_FACTOR = 2;
/** Sea ice: every ICE_EVERY-th cycle from ICE_FIRST the harbor freezes for one cycle. */
export const ICE_EVERY = 6;
export const ICE_FIRST = 6;
/** After a storm, a building on the slope under trees is buried with this chance. */
export const AVALANCHE_CHANCE = 0.5;
export const AVALANCHE_MIN_HEIGHT = 2.0;
export const AVALANCHE_RADIUS = 3;
export const AVALANCHE_RISE = 1.0;
/** Happiness on a clear night under the aurora (Fjord). */
export const HAPPY_AURORA = 0.03;

// Atoll (BIOMES.md §3.2)
/** Pearls a fully staffed dive platform brings up per low-water shift, when a pearl house within PEARL_RADIUS grades them. */
export const PEARLS_PER_SHIFT = 1.2;
export const PEARL_RADIUS = 8;
/** Coconuts a fully staffed grove gathers per grown palm within COCONUT_RADIUS, per cycle. */
export const COCONUT_PER_TREE = 1.0;
export const COCONUT_RADIUS = 6;
/** Bleaching: lagoon cells whose pollution is above BLEACH_POLLUTION whiten by BLEACH_RATE a cycle and recover by BLEACH_RECOVER. */
export const BLEACH_POLLUTION = 0.25;
export const BLEACH_RATE = 0.2;
export const BLEACH_RECOVER = 0.05;
/** A staffed nursery in clean water recovers NURSERY_RECOVER a cycle within NURSERY_RADIUS. */
export const NURSERY_RADIUS = 5;
export const NURSERY_RECOVER = 0.15;
export const NURSERY_POLLUTION_MAX = 0.3;
/** Turtle hatching: lanterns this close to a beach cell go dark; each hatching adds HATCHING_BONUS to tourism, to a cap. */
export const HATCHING_LANTERN_RADIUS = 4;
export const HATCHING_BONUS = 0.1;
export const HATCHING_BONUS_MAX = 0.5;

// Delta (BIOMES.md §3.4)
/** A paddy grows a crop over RICE_CYCLES staffed settlements on fresh water, then yields RICE_PER_HARVEST × staffing. */
export const RICE_CYCLES = 2;
export const RICE_PER_HARVEST = 14;
/** At a spring low every standing crop comes in at once, this much the richer. */
export const HARVEST_BONUS = 1.25;
/** The river's stem waters the flats this far either side (the water coverage layer). */
export const FRESH_RIVER_RADIUS = 3;
export const CRAB_POT_PER_SHIFT = 3;
export const SALT_PER_CYCLE = 4;
export const SALT_STORM_FACTOR = 0.5;
/** Indigo per open flat cell (the wild indigo) within INDIGO_RADIUS of the vats, per cycle at full staff. */
export const INDIGO_PER_CELL = 0.02;
export const INDIGO_RADIUS = 6;
/** Fever season: every FEVER_EVERY cycles from FEVER_FIRST, FEVER_SHARE of every home out of a clinic's reach falls sick. */
export const FEVER_EVERY = 8;
export const FEVER_FIRST = 8;
export const FEVER_SHARE = 0.25;
export const FEVER_CLINIC_RADIUS = 10;

// Cinder (BIOMES.md §3.5)
export const TARO_PER_CYCLE = 6;
export const COCOA_PER_CYCLE = 2.5;
export const SULFUR_PER_CYCLE = 3;
/** Glass a fully staffed works makes a cycle, and what each unit burns: sulfur, or timber when there is none. */
export const GLASS_PER_CYCLE = 3;
export const GLASS_SULFUR = 0.5;
export const GLASS_TIMBER = 1;
/** Tourists spend this much more while a staffed hot-spring bathhouse stands. */
export const HOT_SPRING_TOURISM = 1.5;
/** The eruption: rolled at a settlement from ERUPTION_FIRST, ERUPTION_CHANCE a cycle, ERUPTION_COOLDOWN apart; TREMOR_CYCLES of warning. */
export const ERUPTION_FIRST = 12;
export const ERUPTION_CHANCE = 0.08;
export const ERUPTION_COOLDOWN = 16;
export const TREMOR_CYCLES = 2;
/** Under the ash (the cycle after an eruption): every home loses this much happiness, the terraces make half. */
export const ASH_HAPPY = 0.15;
export const ASH_TERRACE_FACTOR = 0.5;
/** New land from a lava flow cools this many cycles before anything may stand on it. */
export const LAVA_COOL_CYCLES = 3;

// Dunes (BIOMES.md §3.6)
export const DATES_PER_CYCLE = 5;
export const COFFEE_PER_CYCLE = 2.5;
/** Sponges a fully crewed divers' hut brings up each low water. */
export const SPONGES_PER_SHIFT = 1.5;
/** A well's reach on the Dunes (the great cistern is the water building); an oasis waters this far around it. */
export const WELL_RADIUS_DUNES = 3;
export const OASIS_RADIUS = 3;
/** Drought every DROUGHT_EVERY cycles from DROUGHT_FIRST: wells dry, the great cistern holds this share; homes without water lose DROUGHT_HAPPY. */
export const DROUGHT_EVERY = 10;
export const DROUGHT_FIRST = 10;
export const DROUGHT_CISTERN = 0.5;
export const DROUGHT_HAPPY = 0.3;
/** A sandstorm silts the harbours: their boats bring in SILT_FACTOR of the catch until dredged, or SILT_CYCLES of tides scour it. */
export const SILT_CYCLES = 4;
export const SILT_FACTOR = 0.5;
/** Tourists spend this much more the cycle of a night market. */
export const NIGHT_MARKET_TOURISM = 2;

// Sea lanes (BIOMES.md §4; sim/lanes.ts, behind LANES_ENABLED)
export const CARGO_SHIPS_PER_HARBOR = 1;
export const CARGO_HOLD = 20;
/** Non-food goods keep this fraction of their cap before any sails; an island wants a good it cannot make up to this fraction of its cap. */
export const LANE_RESERVE_FRACTION = 0.3;
export const LANE_WANT_FRACTION = 0.5;

/** Classes whose pieces turn to face the street (R in the ghost); streets and everything in the water don't. */
export const ROTATABLE_CLASSES: ReadonlySet<PlacementClass> = new Set<PlacementClass>(["flat", "high", "flatOrHigh", "shore", "beach"]);
/** One-cell runs laid by a drag: never turned — a turned walkway wears its rails across the walk. */
export const LINE_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(["walkway", "raisedWalkway", "path", "breakwater", "sharkNet", "seaWall", "crocNet"]);
export function mayTurn(kind: BuildingKind): boolean {
  return ROTATABLE_CLASSES.has(BUILDINGS[kind].cls) && !LINE_KINDS.has(kind);
}
/** The steepest ground a path may take (BUILDINGS.path.maxRise): 0.7 m of rise per cell, a hard climb, no scramble. */
export const PATH_MAX_RISE = 0.7;
/** The tallest stair between a deck and a path (either way up): adjacent street pieces further apart than this cannot be laid. */
export const STREET_STEP_MAX = 1.5;
