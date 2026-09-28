// The Biome interface and the registry, apart from the biome files so those can register themselves without an
// import cycle (index.ts imports every biome file and re-exports this). See index.ts for what a biome is.
import { BUILDING_KINDS, BUILDINGS, BuildingKind, Cost, ServiceKind } from "../balance";
import type { GoodId } from "../goods";
import type { HeightFn } from "../heightfield";
import type { IslandStats } from "../island";
import type { Material } from "../materials";
import type { Grid } from "../grid";
import type { Building, Cell, Phase, SimState } from "../state";
import type { TreeSite } from "../trees";

export type BiomeId = "tidewater" | "delta" | "dunes" | "atoll" | "cinder" | "fjord";
export type Band = "polar" | "temperate" | "tropical";
export const BIOME_IDS: readonly BiomeId[] = ["tidewater", "delta", "dunes", "atoll", "cinder", "fjord"];
export const BIOME_LABEL: Record<BiomeId, string> = { tidewater: "Tidewater", delta: "Delta", dunes: "Dunes", atoll: "Atoll", cinder: "Cinder", fjord: "Fjord" };

/** What a shaper hands back: the heightfield, the material of a cell given its height, and optionally its own tree sites. */
export interface Shape {
  height: HeightFn;
  /** Material of the cell at (i, j) whose centre height is `h`; plain when omitted. */
  material?: (i: number, j: number, h: number) => Material;
  /** Tree sites, when the biome does not want the base placer (dense pines, sparse palms). */
  trees?: (height: HeightFn) => TreeSite[];
}

export interface Biome {
  id: BiomeId;
  label: string;
  /** Faces of the World it may stand on (BIOMES.md §1). */
  bands: readonly Band[];
  /** Multiplier on every tide level (tides.ts). */
  tide: number;
  /** What the boats bring in (fish everywhere but the Delta, whose sampans work crab). */
  catch?: GoodId;
  /** Native foods (two), the luxury it makes, the industrials it makes, and any minor trade good. */
  foods: readonly GoodId[];
  luxury: GoodId;
  industrials: readonly GoodId[];
  minor: readonly GoodId[];
  /** Goods it can never make (for the card; `makesOf` is what the ledger reads). */
  cannotMake: readonly GoodId[];
  /** The foreign luxury that adds happiness here (BIOMES.md §2's ring). */
  favourite: GoodId;
  /** Kinds added to the base catalog, and base kinds taken out of it. */
  unique: readonly BuildingKind[];
  excluded: readonly BuildingKind[];
  /** Terrain for a noise seed. */
  shape(noiseSeed: number): Shape;
  /** Extra validation on top of the base rules: reasons a candidate fails, [] when it is fine. The heightfield comes too when the caller has it. */
  validate(stats: IslandStats, height?: HeightFn): string[];
  /** Base thresholds this biome relaxes or tightens (undefined = the base value). */
  thresholds?: Partial<{ flats: number; region: number; piers: number; harbors: number; treed: number }>;
  /** Called at every settlement after the base settlement (hazards, events, seasons). */
  settle?(state: SimState, grid: Grid): void;
  /** Per-tick hook (ice, ash, bleaching). */
  tick?(state: SimState, grid: Grid, dt: number): void;
  /** Sharks patrol this coast (false: no risk field, no incidents; the Fjord has orcas nobody meets). */
  sharks?: boolean;
  /** Is the sea frozen this cycle? Boats stay in (unless their pier breaks ice) and the ship skips the harbor. */
  frozen?(state: SimState): boolean;
  /** Happiness every home gets this settlement on top of the base formula (the aurora, the night market). */
  happiness?(state: SimState): number;
  /** A line for the tide clock while something seasonal is on (whale season, sea ice). */
  seasonLabel?(state: SimState): string | null;
  /**
   * The storm this coast gets: swell multiplier on top of the base storm, boat-loss multiplier, and its name; whether
   * it rains (a sandstorm does not, so fire risk stays), a multiplier on fire risk while it blows, how much it hides
   * (view fog, 0..1), and a multiplier on the chance of one (the Delta rains more often).
   */
  storm?: { swell: number; loss: number; name: string; rain?: boolean; fire?: number; fog?: number; chance?: number };
  /** A multiplier on what tourists spend (the turtles' lasting draw). */
  tourism?(state: SimState): number;
  /** A lantern that must stay dark right now (the hatchlings' beach). */
  lanternDimmed?(state: SimState, grid: Grid, b: Building): boolean;
  /** The cell the starting hut looks for its flats from; the island's centre (0, 0) when unset. */
  startNear?: { i: number; j: number };

  // ---- hooks the later coasts added (docs/world/decisions.md #1); each is data or a function, never a branch on an id ----

  /** Land production for this coast's own kinds, once a cycle at the settlement: returns the output (the producer adds it). */
  producers?: Partial<Record<BuildingKind, (state: SimState, grid: Grid, b: Building, staffing: number) => number>>;
  /** After the base shift end (catches, shellfish): this coast's low- or high-water work (crab pots, sponge divers, the harvest). */
  shiftEnd?(state: SimState, grid: Grid, phase: Phase, springLow: boolean): void;
  /** A river that swells the peak every `every` cycles from `first` by `rise`; a swell on a spring peak is a king tide, `king` over the spring. Buildings clear the king tide. */
  surge?: Surge;
  /** What takes swimmers here (the shark role): its name for the notifications. */
  predator?: string;
  /** Coverage the ground itself gives (a river's fresh water): painted into the layer at every settlement. */
  coverage?(state: SimState, grid: Grid): { kind: ServiceKind; cells: Cell[]; radius: number; value: number }[];
  /** Service radius overrides (the Dunes' wells reach 3). */
  serviceRadius?: Partial<Record<BuildingKind, number>>;
  /** A service building's strength after the coast has its say (a drought dries the wells): gets the base strength. */
  serviceStrength?(state: SimState, b: Building, strength: number): number;
  /** Build prices this coast changes (basalt sea walls): replaces the catalog's cost for the kind. */
  costs?: Partial<Record<BuildingKind, Cost>>;
  /** Per-home happiness on top of the base formula (a drought on a home without water). */
  homeHappiness?(state: SimState, grid: Grid, home: Building): number;
  /** Share of a harbour's boats that can work (a silted harbor): 1 when unset. */
  harbourFactor?(state: SimState, b: Building): number;
  /** Named moments and hazards the console API can force (`forceBiome(name)`), each advancing or starting it. */
  force?: Record<string, (state: SimState, grid: Grid) => void>;
}

export interface Surge { every: number; first: number; rise: number; king: number }

const REGISTRY = new Map<BiomeId, Biome>();
export function registerBiome(b: Biome): Biome {
  REGISTRY.set(b.id, b);
  return b;
}

export function isBiomeId(id: unknown): id is BiomeId {
  return typeof id === "string" && (BIOME_IDS as readonly string[]).includes(id);
}

/** The biome for an id; Tidewater for anything not (yet) registered, so an uncharted id never breaks a ledger. */
export function biomeOf(id: BiomeId): Biome {
  return REGISTRY.get(id) ?? REGISTRY.get("tidewater")!;
}
export function biomeFor(state: { world: { biome: BiomeId } }): Biome {
  return biomeOf(state.world.biome);
}
/** Which biomes exist as play (registered), in BIOME_IDS order. */
export function chartedBiomes(): BiomeId[] {
  return BIOME_IDS.filter(id => REGISTRY.has(id));
}

/** The goods an island of this biome can make on its own. */
export function makesOf(biome: BiomeId): readonly GoodId[] {
  const b = biomeOf(biome);
  return [...b.foods, b.luxury, ...b.industrials, ...b.minor];
}
/** The luxury an island of this biome makes itself (never "foreign" to it). */
export function luxuryOf(biome: BiomeId): GoodId {
  return biomeOf(biome).luxury;
}
/** The favourite luxury (BIOMES.md §2's ring): in stock, it adds HAPPY.favourite to every home. */
export function favouriteOf(biome: BiomeId): GoodId {
  return biomeOf(biome).favourite;
}
export function tideScaleOf(biome: BiomeId): number {
  return biomeOf(biome).tide;
}
/** What a kind costs to build on this coast: the catalog's price unless the coast sets its own (basalt sea walls). */
export function costOf(kind: BuildingKind, biome: BiomeId = "tidewater"): Cost {
  return biomeOf(biome).costs?.[kind] ?? BUILDINGS[kind].cost;
}
/** What the boats land here. */
export function catchOf(biome: BiomeId): GoodId {
  return biomeOf(biome).catch ?? "fish";
}
/** The coast's river surge, if it has one (the tide clock carries a copy in TideState). */
export function surgeOf(biome: BiomeId): Surge | undefined {
  return biomeOf(biome).surge;
}
/** The catalog of this biome: base ∪ unique − excluded, in catalog order. `baseKinds` are the kinds no biome owns. */
export function catalogOf(biome: BiomeId, all: readonly BuildingKind[], baseKinds: ReadonlySet<BuildingKind>): BuildingKind[] {
  const b = biomeOf(biome);
  return all.filter(k => (baseKinds.has(k) && !b.excluded.includes(k)) || b.unique.includes(k));
}
/** The kinds no biome owns: everything in the catalog that no registered biome lists as unique. */
export function baseKinds(): ReadonlySet<BuildingKind> {
  const owned = new Set<BuildingKind>();
  for (const b of REGISTRY.values()) for (const k of b.unique) owned.add(k);
  return new Set(BUILDING_KINDS.filter(k => !owned.has(k)));
}
const catalogCache = new Map<string, readonly BuildingKind[]>();
/** The catalog an island of this biome builds from (cached per biome and registry size, so a late registration refreshes it). */
export function catalogFor(biome: BiomeId): readonly BuildingKind[] {
  const key = biome + ":" + REGISTRY.size;
  let c = catalogCache.get(key);
  if (!c) { c = catalogOf(biome, BUILDING_KINDS, baseKinds()); catalogCache.set(key, c); }
  return c;
}

