// The cell lattice: 64×64 cells with i, j in [-HALF, HALF); cell (i, j) covers x in [i, i+1), z in [j, j+1).
// Pure helpers with no state, shared by the grid, the island generator and the fields.
import { SIZE } from "../config";
import { Cell } from "./state";

export const HALF = SIZE / 2;

export const DIRS: readonly Cell[] = [{ i: 1, j: 0 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 0, j: -1 }];

export function inBounds(i: number, j: number): boolean {
  return i >= -HALF && i < HALF && j >= -HALF && j < HALF;
}
export function cellIndex(i: number, j: number): number {
  return (i + HALF) * SIZE + (j + HALF);
}
export function cellCenter(c: Cell): { x: number; z: number } {
  return { x: c.i + 0.5, z: c.j + 0.5 };
}
export function worldToCell(x: number, z: number): Cell {
  return { i: Math.floor(x), j: Math.floor(z) };
}
