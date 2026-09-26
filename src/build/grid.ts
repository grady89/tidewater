// Cell model over the terrain, occupancy, and placement rules.
import { HOUSE_FLOOR, PIER_FLOOR, SIZE, TIDE_HI, TIDE_LO, WALKWAY_FLOOR } from "../config";
import { terrainHeight } from "../world/terrain";

export type PieceKind = "house" | "walkway" | "pier";
/** deep: always underwater. flat: the tidal flats, buildable. high: dry land above the tide. */
export type CellClass = "deep" | "flat" | "high";

export interface Cell { i: number; j: number }

export interface Piece {
  id: number;
  kind: PieceKind;
  /** One cell, or two for a pier (shore cell first, seaward cell second). */
  cells: Cell[];
  /** Top of the deck in world Y. */
  floorY: number;
  /** Floor is below the water this frame. Breaks connectivity; nothing is destroyed. */
  cut: boolean;
  /** Connected to a pier through walkways this frame. Piers are always reached unless cut. */
  reached: boolean;
}

/** Cells span i, j in [-HALF, HALF). Cell (i, j) covers x in [i, i+1), z in [j, j+1). */
export const HALF = SIZE / 2;

export const FLOOR_Y: Record<PieceKind, number> = { house: HOUSE_FLOOR, walkway: WALKWAY_FLOOR, pier: PIER_FLOOR };

const DIRS: readonly Cell[] = [{ i: 1, j: 0 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 0, j: -1 }];

export function inBounds(i: number, j: number): boolean {
  return i >= -HALF && i < HALF && j >= -HALF && j < HALF;
}
function index(i: number, j: number): number {
  return (i + HALF) * SIZE + (j + HALF);
}
export function cellCenter(c: Cell): { x: number; z: number } {
  return { x: c.i + 0.5, z: c.j + 0.5 };
}
export function worldToCell(x: number, z: number): Cell {
  return { i: Math.floor(x), j: Math.floor(z) };
}

export class Grid {
  private readonly heights = new Float32Array(SIZE * SIZE);
  private readonly classes: CellClass[] = new Array(SIZE * SIZE);
  private readonly occupancy: (Piece | null)[] = new Array(SIZE * SIZE).fill(null);
  readonly pieces = new Map<number, Piece>();
  private nextId = 1;

  constructor() {
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const h = terrainHeight(i + 0.5, j + 0.5);
      const k = index(i, j);
      this.heights[k] = h;
      this.classes[k] = h < TIDE_LO ? "deep" : h <= TIDE_HI ? "flat" : "high";
    }
  }

  heightAt(c: Cell): number { return this.heights[index(c.i, c.j)]; }
  classAt(c: Cell): CellClass | null { return inBounds(c.i, c.j) ? this.classes[index(c.i, c.j)] : null; }
  pieceAt(c: Cell): Piece | null { return inBounds(c.i, c.j) ? this.occupancy[index(c.i, c.j)] : null; }
  neighbors(c: Cell): Cell[] {
    return DIRS.map(d => ({ i: c.i + d.i, j: c.j + d.j })).filter(n => inBounds(n.i, n.j));
  }

  /** The cells a piece of `kind` anchored at `c` would occupy, or null if that shape can't be formed there. */
  footprint(kind: PieceKind, c: Cell): Cell[] | null {
    if (!inBounds(c.i, c.j)) return null;
    if (kind !== "pier") return [c];
    // A pier sits in deep water against the shore and extends one cell seaward, away from the flat cell it touches.
    if (this.classAt(c) !== "deep") return null;
    for (const d of DIRS) {
      const shore = { i: c.i + d.i, j: c.j + d.j };
      const sea = { i: c.i - d.i, j: c.j - d.j };
      if (this.classAt(shore) === "flat" && this.classAt(sea) === "deep") return [c, sea];
    }
    return null;
  }

  canPlace(kind: PieceKind, cells: Cell[]): boolean {
    const want: CellClass = kind === "pier" ? "deep" : "flat";
    return cells.every(c => this.classAt(c) === want && !this.pieceAt(c));
  }

  place(kind: PieceKind, cells: Cell[]): Piece {
    const piece: Piece = { id: this.nextId++, kind, cells, floorY: FLOOR_Y[kind], cut: false, reached: false };
    for (const c of cells) this.occupancy[index(c.i, c.j)] = piece;
    this.pieces.set(piece.id, piece);
    return piece;
  }

  remove(piece: Piece): void {
    for (const c of piece.cells) this.occupancy[index(c.i, c.j)] = null;
    this.pieces.delete(piece.id);
  }
}
