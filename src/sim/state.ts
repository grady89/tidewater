// The ledger. Everything the game knows is in one plain JSON-serializable object; the view only reads it.
import { TIDE_HI } from "../config";
import { BuildingKind, FISH_CAP, ResourceKind, STARTING_FISH, STARTING_MONEY } from "./balance";
import { filled, zeros } from "./fields";
import { initialTrees } from "./trees";

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
}

export interface Emitter { k: number; rate: number }

export interface Fields {
  /** Pollution per cell. */
  pollution: number[];
  /** Fish density per deep cell, 0..FISH_CAP. */
  fish: number[];
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
}

export interface SimState {
  version: 2;
  seed: number;
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
  /** Age of every tree site, 0..1 (see trees.ts). */
  trees: number[];
  fields: Fields;
  /** Pollution sources for the current cycle: per-tick rates at cells (rebuilt at every settlement). */
  emitters: Emitter[];
  /** Waste with no outfall to go to, last cycle. */
  wasteBacklog: number;
  /** Town happiness 0..1, averaged over occupied houses (1 when empty). */
  happiness: number;
  /** Last completed cycle's ledger, for the HUD. */
  last: CycleStats;
  /** Newest last; capped. */
  log: string[];
}

export function createState(seed = 1): SimState {
  return {
    version: 2,
    seed,
    rng: seed | 0,
    time: 0,
    tick: 0,
    tide: { phase: Math.PI * 0.5, level: TIDE_HI, wetLevel: 0, cycle: 0, peaked: false, override: null },
    phase: "high",
    resources: { money: STARTING_MONEY, fish: STARTING_FISH, shellfish: 0, smoked: 0, timber: 0, planks: 0 },
    buildings: {},
    nextId: 1,
    assignments: [],
    trees: initialTrees(),
    fields: { pollution: zeros(), fish: filled(FISH_CAP) },
    emitters: [],
    wasteBacklog: 0,
    happiness: 1,
    last: { cycle: 0, fishCaught: 0, fishSold: 0, shellfishSold: 0, income: 0, expenses: 0, immigrants: 0 },
    log: [],
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

export function notify(state: SimState, msg: string): void {
  state.log.push(msg);
  if (state.log.length > 40) state.log.shift();
}
