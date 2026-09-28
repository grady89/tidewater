// The ledger. Everything the game knows is in one plain JSON-serializable object; the view only reads it.
import { TIDE_HI } from "../config";
import { BuildingKind, FISH_CAP, ResourceKind, SERVICE_KINDS, ServiceKind, STARTING_FISH, STARTING_MONEY } from "./balance";
import { filled, zeros } from "./fields";
import { emptyStock, GoodId } from "./goods";
import { BiomeId, tideScaleOf } from "./biomes";
import { initialTrees, TreeSite } from "./trees";

export function emptyCoverage(): Record<ServiceKind, number[]> {
  const out = {} as Record<ServiceKind, number[]>;
  for (const k of SERVICE_KINDS) out[k] = zeros();
  return out;
}

export type { BuildingKind } from "./balance";

export interface Cell { i: number; j: number }

export type Phase = "high" | "slack" | "low";

export interface Building {
  id: number;
  kind: BuildingKind;
  /** Footprint cells. Piers: shore cell first, seaward cell second. */
  cells: Cell[];
  /** Top of the deck in world Y. */
  floorY: number;
  /** Quarter turns from the default facing (door toward −z): 0–3. Odd turns swap a footprint's width and depth. */
  rot: number;
  /** Floor is below the water this tick. Breaks connectivity; nothing is destroyed. */
  cut: boolean;
  /** Linked to the network (a pier or market) through walkways this tick. */
  reached: boolean;
  /** Jobs filled this cycle. */
  workers: number;
  residents: number;
  /** Boats moored here (piers). */
  boats: number;
  /** Boats currently out fishing (piers, docks). */
  atSea: boolean;
  /** Deep cell the boats fish this trip (piers, docks). */
  ground: Cell | null;
  /** Resource produced or sold last cycle, for the info panel. */
  output: number;
  /** Fed and employed fraction last cycle, 0..1 (houses). */
  happiness: number;
  /** Work accumulated toward the next boat (shipyards), in staffed cycles. */
  progress: number;
  /** Consecutive cycles in foul water (oyster beds). */
  stress: number;
  /** Homes grow from 1 to MAX_LEVEL. */
  level: number;
  /** Consecutive happy cycles toward the next level (homes). */
  streak: number;
  /** A lantern post stands on this walkway. */
  lantern: boolean;
  /** Residents hurt and off work (homes). */
  injured: number;
  /** Cycles left of grief after an incident nearby (homes). */
  shock: number;
  /** Seconds of fire left; 0 when not burning. */
  fire: number;
  /** Burnt, storm-struck or wave-struck: produces nothing until repaired. */
  damaged: boolean;
}

export interface Swimmers { k: number; n: number }

export interface Emitter { k: number; rate: number }

export interface Fields {
  /** Pollution per cell. */
  pollution: number[];
  /** Fish density per deep cell, 0..FISH_CAP. */
  fish: number[];
  /** Service coverage 0..1 per cell, one layer per ServiceKind; rebuilt at every settlement. */
  coverage: Record<ServiceKind, number[]>;
  /** Shark risk per water cell. */
  shark: number[];
  /** Fire risk per cell. */
  fire: number[];
  /** Coral bleaching per lagoon cell, 0..1 (the Atoll); zero everywhere else. */
  bleach: number[];
}

export interface TideState {
  /** Phase in radians. Starts at high tide. */
  phase: number;
  /** Water level in world Y. */
  level: number;
  /** Upper edge of the wet-sand band. Never below `level`; dries slowly as the tide retreats. */
  wetLevel: number;
  /** High tides passed since the start. */
  cycle: number;
  /** True only on the tick in which the tide peaks. */
  peaked: boolean;
  /** Debug/test hook: when set, the water is held at this level while the clock keeps running. */
  override: number | null;
  /** The biome's multiplier on every level (tides.ts); 1 for Tidewater. */
  scale: number;
}

export interface Assignment { home: number; work: number; n: number }

export interface CycleStats {
  cycle: number;
  fishCaught: number;
  fishSold: number;
  shellfishSold: number;
  income: number;
  expenses: number;
  immigrants: number;
  /** Money from tourists this cycle. */
  tourism: number;
  /** Money from the trade ship this cycle (net of plank purchases). */
  trade: number;
}

export interface StormState {
  /** A storm blows through the current cycle. */
  active: boolean;
  /** Cycle of the last storm, so two never follow each other. */
  lastCycle: number;
  /** Storms weathered. */
  count: number;
}

export type TsunamiStage = "drawdown" | "wave" | "settle";

export interface TsunamiState {
  stage: TsunamiStage | null;
  /** Seconds into the stage. */
  t: number;
  /** Unit vector the wave travels along (from the deep side toward land). */
  dir: { x: number; z: number };
  /** The wave front's position along `dir`, in world units from the map centre. */
  front: number;
  /** Cycle of the last tsunami. */
  lastCycle: number;
  /** Cycle at whose settlement the next tsunami starts (the sea is uneasy until then); -1 = none pending. */
  due: number;
  /** Buildings already struck by this wave. */
  struck: number[];
  count: number;
}

export interface TradeState {
  /** Cycle whose high water the ship next calls on; -1 until a harbor exists. */
  nextVisit: number;
  /** Cycle of the current or last visit; the view shows the ship through that high water. */
  shipCycle: number;
  /** The order book: units of each good queued for the next ship, delivered and paid on arrival. */
  orders: Partial<Record<GoodId, number>>;
  /** Visits so far. */
  visits: number;
}

export interface SimState {
  version: 3;
  seed: number;
  /** The island: the seed the player asked for (0 = the original island) and the biome; island.ts turns them into ground. */
  world: { seed: number; biome: BiomeId };
  /** RNG stream state (see rng.ts). */
  rng: number;
  /** Game seconds elapsed. */
  time: number;
  tick: number;
  tide: TideState;
  phase: Phase;
  resources: Record<ResourceKind, number>;
  buildings: Record<number, Building>;
  nextId: number;
  assignments: Assignment[];
  /** Age of every tree site, 0..1 (see trees.ts); −1 = cleared by the player. Planted sites follow the fixed ones. */
  trees: number[];
  /** Tree sites the player planted, appended after the fixed sites. */
  extraTrees: TreeSite[];
  /** Cells raised to dry ground by landfill (cell indices). */
  landfill: number[];
  /** The outstanding loan: what is still owed, the instalment per settlement, how many loans ever taken. */
  loan: { owed: number; perCycle: number; taken: number; /** The cycle the instalments start (absent in older saves: at once). */ holdUntil?: number };
  fields: Fields;
  /** Pollution sources for the current cycle: per-tick rates at cells (rebuilt at every settlement). */
  emitters: Emitter[];
  /** Shark-risk sources for the current cycle, likewise. */
  sharkEmitters: Emitter[];
  /** Fire-risk sources for the current cycle, likewise. */
  fireEmitters: Emitter[];
  /** Fires started so far, and buildings burnt out. */
  fires: number;
  burnt: number;
  /** Waste with no outfall to go to, last cycle. */
  wasteBacklog: number;
  /** Who is in the water this shift, per beach cell. */
  swimmers: Swimmers[];
  /** Shark incidents so far. */
  incidents: number;
  /** Achievement ids in the order they were earned. */
  achievements: string[];
  trade: TradeState;
  /** Tourists in town (they come and go with the ship). */
  tourists: number;
  storm: StormState;
  tsunami: TsunamiState;
  /** Town happiness 0..1, averaged over occupied houses (1 when empty). */
  happiness: number;
  /** Last completed cycle's ledger, for the HUD. */
  last: CycleStats;
  /** Newest last; capped. */
  log: string[];
  /** The biome's own counters (whale season, sea ice, …): a flat bag of numbers so every biome saves the same way. */
  biomeState: Record<string, number>;
}

export function createState(seed = 1, islandSeed = 0, biome: BiomeId = "tidewater"): SimState {
  return {
    version: 3,
    seed,
    world: { seed: islandSeed | 0, biome },
    rng: seed | 0,
    time: 0,
    tick: 0,
    tide: { phase: Math.PI * 0.5, level: TIDE_HI * tideScaleOf(biome), wetLevel: 0, cycle: 0, peaked: false, override: null, scale: tideScaleOf(biome) },
    phase: "high",
    resources: { money: STARTING_MONEY, ...emptyStock(), fish: STARTING_FISH },
    buildings: {},
    nextId: 1,
    assignments: [],
    trees: initialTrees(islandSeed, biome),
    extraTrees: [],
    landfill: [],
    loan: { owed: 0, perCycle: 0, taken: 0 },
    fields: { pollution: zeros(), fish: filled(FISH_CAP), coverage: emptyCoverage(), shark: zeros(), fire: zeros(), bleach: zeros() },
    emitters: [],
    sharkEmitters: [],
    fireEmitters: [],
    fires: 0,
    burnt: 0,
    wasteBacklog: 0,
    swimmers: [],
    incidents: 0,
    achievements: [],
    trade: { nextVisit: -1, shipCycle: -1, orders: {}, visits: 0 },
    tourists: 0,
    storm: { active: false, lastCycle: -99, count: 0 },
    tsunami: { stage: null, t: 0, dir: { x: 0, z: 1 }, front: 0, lastCycle: -99, due: -1, struck: [], count: 0 },
    happiness: 1,
    last: { cycle: 0, fishCaught: 0, fishSold: 0, shellfishSold: 0, income: 0, expenses: 0, immigrants: 0, tourism: 0, trade: 0 },
    log: [],
    biomeState: {},
  };
}

export function buildingList(state: SimState): Building[] {
  return Object.values(state.buildings);
}

export function population(state: SimState): number {
  let n = 0;
  for (const b of Object.values(state.buildings)) n += b.residents;
  return n;
}

let notifyListener: ((msg: string, state: SimState) => void) | null = null;
/** Hear every notification as it is logged (the playtest log). Not state; null in the plain game. */
export function onNotify(fn: ((msg: string, state: SimState) => void) | null): void {
  notifyListener = fn;
}

export function notify(state: SimState, msg: string): void {
  state.log.push(msg);
  if (state.log.length > 40) state.log.shift();
  if (notifyListener) notifyListener(msg, state);
}
