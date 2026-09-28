// The Biome interface and the registry, apart from the biome files so those can register themselves without an
// import cycle (index.ts imports every biome file and re-exports this). See index.ts for what a biome is.
import { BUILDING_KINDS, BuildingKind } from "../balance";
import type { GoodId } from "../goods";
import type { HeightFn } from "../heightfield";
import type { IslandStats } from "../island";
import type { Material } from "../materials";
import type { Grid } from "../grid";
import type { Building, SimState } from "../state";
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
  /** Extra validation on top of the base rules: reasons a candidate fails, [] when it is fine. */
  validate(stats: IslandStats): string[];
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
  /** The storm this coast gets: swell multiplier on top of the base storm, boat-loss multiplier, and its name. */
  storm?: { swell: number; loss: number; name: string };
  /** A multiplier on what tourists spend (the turtles' lasting draw). */
  tourism?(state: SimState): number;
  /** A lantern that must stay dark right now (the hatchlings' beach). */
  lanternDimmed?(state: SimState, grid: Grid, b: Building): boolean;
  /** The cell the starting hut looks for its flats from; the island's centre (0, 0) when unset. */
  startNear?: { i: number; j: number };
}

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

