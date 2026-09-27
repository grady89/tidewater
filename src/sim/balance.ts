// Every tunable number in the economy, and the building catalog. No system may hard-code a value that lives here.
import { RAISED_FLOOR } from "../config";

export type BuildingKind =
  | "hut" | "house" | "tallHouse"
  | "walkway" | "raisedWalkway" | "path"
  | "pier" | "dock" | "shipyard"
  | "market" | "oysterBed" | "clamCamp" | "lumberCamp" | "sawmill" | "smokehouse" | "netLoft" | "warehouse"
  | "outfall" | "treatmentPlant" | "well" | "bathhouse" | "tavern" | "shrine" | "marketSquare"
  | "clinic" | "lifeguard" | "sharkNet"
  | "harbor" | "inn" | "lighthouse" | "fireWatch"
  | "breakwater" | "seaWall";

/** Service coverage layers; each building that provides one writes its staffed fraction within `radius`. */
export type ServiceKind = "water" | "leisure" | "night" | "treatment" | "lifeguard" | "firewatch";
export const SERVICE_KINDS: ServiceKind[] = ["water", "leisure", "night", "treatment", "lifeguard", "firewatch"];
export type Category = "Homes" | "Streets" | "Sea" | "Production" | "Services" | "Leisure" | "Land";
export const CATEGORIES: Category[] = ["Homes", "Streets", "Sea", "Production", "Services", "Leisure", "Land"];
/**
 * flat: terrain TIDE_LO..TIDE_HI. deep: below TIDE_LO. high: above TIDE_HI. flatOrDeep: anywhere under the
 * spring tide. shore: flat cell orthogonally adjacent to a high cell. edge: deep cells against the shore (piers
 * and shipyards extend seaward from the anchor).
 */
export type PlacementClass = "flat" | "deep" | "high" | "flatOrHigh" | "flatOrDeep" | "shore" | "edge" | "beach" | "highOrEdge";
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
  /** Deck height in world Y; "stilts" = terrain + STILT_LENGTH; "ground" = on the terrain, never below 1.0;
   *  "terrain" = on the terrain exactly (paths); a number never sinks below the terrain either. */
  floor: number | "stilts" | "ground" | "terrain";
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
  hut: { name: "Hut", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 40 }, workers: 0, residents: 2, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "2 residents; on the flats or the hill" },
  house: { name: "House", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 80 }, workers: 0, residents: 4, upkeep: 1, floor: 1.0, network: "leaf", desc: "4 residents; on the flats or the hill" },
  tallHouse: { name: "Tall house", category: "Homes", w: 1, d: 1, cls: "flatOrHigh", requires: "sawmill", cost: { money: 140, planks: 10 }, workers: 0, residents: 6, upkeep: 1.5, floor: 1.0, network: "leaf", desc: "6 residents; needs a sawmill" },
  walkway: { name: "Walkway", category: "Streets", w: 1, d: 1, cls: "flat", cost: { money: 5 }, workers: 0, residents: 0, upkeep: 0, floor: "stilts", network: "link", desc: "Stilts; floods on low ground" },
  path: { name: "Path", category: "Streets", w: 1, d: 1, cls: "high", cost: { money: 2 }, workers: 0, residents: 0, upkeep: 0, floor: "terrain", network: "link", desc: "Dirt track over dry land; joins the street to the hill" },
  raisedWalkway: { name: "Raised walkway", category: "Streets", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 12 }, workers: 0, residents: 0, upkeep: 0, floor: RAISED_FLOOR, network: "link", desc: "Never floods; bridges deep water out to a dock" },
  pier: { name: "Pier", category: "Sea", w: 1, d: 2, cls: "edge", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 2, floor: 1.0, network: "root", slots: 2, desc: "2 boats; sail at high water only" },
  dock: { name: "Deep dock", category: "Sea", w: 2, d: 2, cls: "deep", needsLink: true, cost: { money: 150, planks: 20 }, workers: 0, residents: 0, upkeep: 4, floor: 1.0, network: "root", slots: 4, desc: "4 boats; sail on every tide; reach it by pier or raised walkway" },
  shipyard: { name: "Shipyard", category: "Sea", w: 3, d: 2, cls: "edge", cost: { money: 300, planks: 40 }, workers: 5, residents: 0, upkeep: 4, floor: 1.0, network: "leaf", desc: "Builds a boat from planks" },
  market: { name: "Fish market", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 3, residents: 0, upkeep: 3, floor: 1.0, network: "link", desc: "Sells fish each cycle" },
  oysterBed: { name: "Oyster bed", category: "Production", w: 1, d: 1, cls: "flat", terrain: { min: 0.0, max: 0.45 }, cost: { money: 30 }, workers: 2, residents: 0, upkeep: 0.5, floor: "stilts", network: "leaf", desc: "Shellfish at low water" },
  clamCamp: { name: "Clam camp", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 70 }, workers: 4, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "Rakes exposed flats within 6 at low water" },
  lumberCamp: { name: "Lumber camp", category: "Production", w: 2, d: 1, cls: "high", needsWalkway: true, cost: { money: 100 }, workers: 3, residents: 0, upkeep: 1, floor: "ground", network: "leaf", desc: "Fells trees within 7; they regrow" },
  sawmill: { name: "Sawmill", category: "Production", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 180 }, workers: 3, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Timber → planks" },
  smokehouse: { name: "Smokehouse", category: "Production", w: 2, d: 1, cls: "flat", cost: { money: 160 }, workers: 3, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", desc: "Fish → smoked goods; fire risk" },
  netLoft: { name: "Net loft", category: "Production", w: 1, d: 1, cls: "flat", cost: { money: 90 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "+15% catch for boats within 8" },
  warehouse: { name: "Warehouse", category: "Production", w: 2, d: 2, cls: "flat", cost: { money: 120 }, workers: 0, residents: 0, upkeep: 1, floor: 1.0, network: "leaf", desc: "+100 storage for every good" },
  outfall: { name: "Sewage outfall", category: "Services", w: 1, d: 1, cls: "edge", cost: { money: 40 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", desc: "Dumps the town's waste into the sea; the tide carries it" },
  treatmentPlant: { name: "Treatment plant", category: "Services", w: 2, d: 2, cls: "flatOrHigh", cost: { money: 350 }, workers: 4, residents: 0, upkeep: 3, floor: "ground", network: "leaf", service: { kind: "treatment", radius: 12 }, desc: "Neutralises waste from homes within 12" },
  well: { name: "Well", category: "Services", w: 1, d: 1, cls: "flat", cost: { money: 50 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "leaf", service: { kind: "water", radius: 8 }, desc: "Drinking water for homes within 8" },
  bathhouse: { name: "Bathhouse", category: "Leisure", w: 2, d: 1, cls: "shore", cost: { money: 130 }, workers: 0, residents: 0, upkeep: 1.5, floor: 1.0, network: "leaf", service: { kind: "leisure", radius: 8 }, desc: "Leisure for homes within 8; on the shore" },
  tavern: { name: "Tavern", category: "Leisure", w: 2, d: 1, cls: "flat", cost: { money: 150 }, workers: 2, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", service: { kind: "leisure", radius: 10 }, desc: "Leisure within 10; pours smoked goods" },
  shrine: { name: "Shrine", category: "Leisure", w: 1, d: 1, cls: "flat", cost: { money: 60 }, workers: 0, residents: 0, upkeep: 0.25, floor: 1.0, network: "leaf", service: { kind: "leisure", radius: 4 }, desc: "A little calm within 4" },
  marketSquare: { name: "Market square", category: "Leisure", w: 2, d: 2, cls: "flat", touches: "market", cost: { money: 100 }, workers: 0, residents: 0, upkeep: 0.5, floor: 1.0, network: "link", service: { kind: "leisure", radius: 6 }, desc: "Leisure within 6; must touch the fish market" },
  clinic: { name: "Clinic", category: "Services", w: 2, d: 1, cls: "flat", cost: { money: 200 }, workers: 3, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", desc: "Heals the injured so they can work again" },
  lifeguard: { name: "Lifeguard tower", category: "Services", w: 1, d: 1, cls: "beach", cost: { money: 90 }, workers: 1, residents: 0, upkeep: 1, floor: "ground", network: "leaf", service: { kind: "lifeguard", radius: 5 }, desc: "On a beach; shark incidents within 5 drop 80%" },
  sharkNet: { name: "Shark net", category: "Sea", w: 1, d: 1, cls: "flatOrDeep", cost: { money: 20 }, workers: 0, residents: 0, upkeep: 0.1, floor: 1.0, network: "leaf", desc: "Per water cell; shark risk can't cross" },
  harbor: { name: "Harbor", category: "Sea", w: 3, d: 3, cls: "deep", terrain: { min: -99, max: -1.5 }, cost: { money: 600, planks: 60 }, workers: 0, residents: 0, upkeep: 6, floor: 1.0, network: "root", slots: 6, desc: "Trade ship berth; 6 boats; needs water deeper than 1.5" },
  inn: { name: "Inn", category: "Leisure", w: 2, d: 2, cls: "flat", cost: { money: 250, planks: 20 }, workers: 2, residents: 0, upkeep: 2, floor: 1.0, network: "leaf", desc: "Tourists off the trade ship stay and spend" },
  lighthouse: { name: "Lighthouse", category: "Sea", w: 1, d: 1, cls: "highOrEdge", cost: { money: 400 }, workers: 0, residents: 0, upkeep: 2, floor: "ground", network: "leaf", desc: "Boats ride out storms; the trade ship calls every 2 tides" },
  fireWatch: { name: "Fire watch", category: "Services", w: 1, d: 1, cls: "flatOrHigh", cost: { money: 120 }, workers: 2, residents: 0, upkeep: 1.5, floor: "ground", network: "leaf", service: { kind: "firewatch", radius: 8 }, desc: "Damps fire risk and puts out fires within 8" },
  breakwater: { name: "Breakwater", category: "Sea", w: 1, d: 1, cls: "deep", cost: { money: 60, planks: 4 }, workers: 0, residents: 0, upkeep: 0.2, floor: 1.0, network: "leaf", desc: "Per cell; shelters harbours within 6 from storms and blocks the wave" },
  seaWall: { name: "Sea wall", category: "Sea", w: 1, d: 1, cls: "flat", cost: { money: 25, timber: 3 }, workers: 0, residents: 0, upkeep: 0.1, floor: "ground", network: "leaf", desc: "Per cell on the flats; shields what stands behind it from the wave" },
};

// Loans (one at a time): the lump sum, the interest on it, and how many settlements repay it.
export const LOAN_AMOUNT = 300;
export const LOAN_INTEREST = 0.2;
export const LOAN_REPAY_CYCLES = 15;

// Land tools
/** Landfill raises a flat cell to this height: dry at every tide, still below the hill. */
export const LANDFILL_HEIGHT = 0.9;
export const LANDFILL_COST = { money: 45, timber: 4 };
export const PLANT_COST = 3;
/** Timber from clearing a grown tree by hand. */
export const CLEAR_TIMBER = 1;

/** Share of a building's money cost returned when the player removes it (planks and timber are not returned). */
export const REMOVE_REFUND = 0.5;
/** Stilt decks can be built higher than their stilts: LIFT_STEP metres per step, up to LIFT_MAX steps, LIFT_COST $ each. */
export const LIFT_STEP = 0.2;
export const LIFT_MAX = 4;
export const LIFT_COST = 2;

// Storms
export const STORM_FIRST_CYCLE = 6;
export const STORM_CHANCE = 0.12;
export const STORM_LOSS_CHANCE = 0.5;
/** Harbours with a breakwater within this many cells are sheltered. */
export const SHELTER_RADIUS = 6;
export const STORM_WAVE_AMP = 3;

// Tsunami
export const TSUNAMI_FIRST_CYCLE = 20;
export const TSUNAMI_CHANCE = 0.05;
export const TSUNAMI_COOLDOWN = 12;
export const DRAWDOWN_SECONDS = 20;
export const DRAWDOWN_LEVEL = -1.2;
export const WAVE_HEIGHT = 1.4;
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
export const TRADE_PRICE_SMOKED = 9;
export const TRADE_PRICE_FISH = 5;
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
export const CAP_BASE: Record<GoodKind, number> = { fish: 100, shellfish: 100, smoked: 60, timber: 80, planks: 60 };
export const WAREHOUSE_CAP = 100;
