// Water-side spatial helpers: deep-water BFS from a harbour, fishing-ground choice, and boat paths. The view
// animates boats along these; the sim only stores the chosen ground.
import { SIZE } from "../config";
import { BOAT_MIN_RANGE, BOAT_RANGE } from "./balance";
import { cellIndex, Grid, HALF } from "./grid";
import { Building, Cell } from "./state";

/** BFS distance over deep cells from the harbour's cells, out to `range`. Unreachable = -1. */
export function seaDistanceField(grid: Grid, from: Building, out: Int32Array = new Int32Array(SIZE * SIZE), range = BOAT_RANGE): Int32Array {
  out.fill(-1);
  const queue: number[] = [];
  for (const c of from.cells) { out[cellIndex(c.i, c.j)] = 0; queue.push(c.i, c.j); }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++], j = queue[head++];
    const d = out[cellIndex(i, j)];
    if (d >= range) continue;
    for (const n of grid.neighbors({ i, j })) {
      const k = cellIndex(n.i, n.j);
      if (out[k] !== -1 || grid.classAt(n) !== "deep" || grid.buildingAt(n)) continue;
      out[k] = d + 1;
      queue.push(n.i, n.j);
    }
  }
  return out;
}

/**
 * The ground boats from `harbour` fish: the richest reachable cell between BOAT_MIN_RANGE and BOAT_RANGE by
 * water (ties: nearest, then lowest index).
 */
export function chooseGround(grid: Grid, harbour: Building, fish: number[], field?: Int32Array): Cell | null {
  const f = seaDistanceField(grid, harbour, field);
  let best: Cell | null = null, bestScore = Infinity;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = cellIndex(i, j);
    const d = f[k];
    if (d < BOAT_MIN_RANGE || d > BOAT_RANGE) continue;
    const score = -fish[k] * 100 + d * 0.01;
    if (score < bestScore) { bestScore = score; best = { i, j }; }
  }
  if (best) return best;
  // Hemmed in: anything reachable at all, furthest first.
  let far = -1;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const d = f[cellIndex(i, j)];
    if (d > far) { far = d; best = { i, j }; }
  }
  return far > 0 ? best : null;
}

/** The trade ship wants a run-in of at least this many cells so it is seen arriving and leaving. */
export const SHIP_APPROACH = 12;

/**
 * The open-sea cell the trade ship comes from: the reachable map-edge deep cell nearest the harbour by water
 * among those at least SHIP_APPROACH out (falling back to the nearest of all).
 */
export function seaEntry(grid: Grid, harbour: Building): Cell | null {
  const f = seaDistanceField(grid, harbour, undefined, SIZE * 2);
  let best: Cell | null = null, bd = Infinity, near: Cell | null = null, nd = Infinity;
  const edge = (i: number, j: number) => {
    const d = f[cellIndex(i, j)];
    if (d < 0) return;
    if (d >= SHIP_APPROACH && d < bd) { bd = d; best = { i, j }; }
    if (d < nd) { nd = d; near = { i, j }; }
  };
  for (let i = -HALF; i < HALF; i++) { edge(i, -HALF); edge(i, HALF - 1); }
  for (let j = -HALF; j < HALF; j++) { edge(-HALF, j); edge(HALF - 1, j); }
  return best ?? near;
}

/** Deep-water path from the harbour to `to` (inclusive), following the BFS field back. */
export function seaPath(grid: Grid, harbour: Building, to: Cell, range = BOAT_RANGE): Cell[] {
  const f = seaDistanceField(grid, harbour, undefined, range);
  if (f[cellIndex(to.i, to.j)] < 0) return [];
  const path: Cell[] = [to];
  let cur = to;
  while (f[cellIndex(cur.i, cur.j)] > 0) {
    const d = f[cellIndex(cur.i, cur.j)];
    const next = grid.neighbors(cur).find(n => f[cellIndex(n.i, n.j)] === d - 1);
    if (!next) break;
    path.push(next);
    cur = next;
  }
  return path.reverse();
}
