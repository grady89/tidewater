// The ledger. Everything the game knows is in one plain JSON-serializable object; the view only reads it.
import { TIDE_HI } from "../config";

export type PieceKind = "house" | "walkway" | "pier";

export interface Cell { i: number; j: number }

export interface Piece {
  id: number;
  kind: PieceKind;
  /** One cell, or two for a pier (shore cell first, seaward cell second). */
  cells: Cell[];
  /** Top of the deck in world Y. */
  floorY: number;
  /** Floor is below the water this tick. Breaks connectivity; nothing is destroyed. */
  cut: boolean;
  /** Connected to a pier through walkways this tick. Piers are always reached unless cut. */
  reached: boolean;
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

export interface Score {
  cycle: number;
  reached: number;
  houses: number;
}

export interface SimState {
  version: 1;
  seed: number;
  /** RNG stream state (see rng.ts). */
  rng: number;
  /** Game seconds elapsed. */
  time: number;
  tick: number;
  tide: TideState;
  pieces: Record<number, Piece>;
  nextPieceId: number;
  score: Score | null;
}

export function createState(seed = 1): SimState {
  return {
    version: 1,
    seed,
    rng: seed | 0,
    time: 0,
    tick: 0,
    tide: { phase: Math.PI * 0.5, level: TIDE_HI, wetLevel: 0, cycle: 0, peaked: false, override: null },
    pieces: {},
    nextPieceId: 1,
    score: null,
  };
}

export function pieceList(state: SimState): Piece[] {
  return Object.values(state.pieces);
}
