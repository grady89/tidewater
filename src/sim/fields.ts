// Grid fields: 64×64 scalar layers over the cells (plain arrays so they serialize with the ledger). Pollution
// decays, diffuses to its four neighbours, and is carried by the tide: shoreward (uphill) while it rises,
// seaward (downhill) while it falls. Every spatial mechanic should reuse these helpers.
import { SIZE } from "../config";
import { cellIndex, Grid, HALF } from "./grid";
import { Cell } from "./state";

export const CELLS = SIZE * SIZE;

export function zeros(): number[] {
  return new Array<number>(CELLS).fill(0);
}

export function filled(v: number): number[] {
  return new Array<number>(CELLS).fill(v);
}

/** Per cell: the neighbour index with the highest terrain (if higher) and the lowest (if lower), else -1. */
export interface Flow { up: Int32Array; down: Int32Array }

export function buildFlow(grid: Grid): Flow {
  const up = new Int32Array(CELLS).fill(-1), down = new Int32Array(CELLS).fill(-1);
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = cellIndex(i, j);
    const h = grid.heights[k];
    let hi = h, lo = h;
    for (const n of grid.neighbors({ i, j })) {
      const nk = cellIndex(n.i, n.j), nh = grid.heights[nk];
      if (nh > hi) { hi = nh; up[k] = nk; }
      if (nh < lo) { lo = nh; down[k] = nk; }
    }
  }
  return { up, down };
}

const NEIGHBOURS: number[][] = [];
for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
  const list: number[] = [];
  if (i > -HALF) list.push(cellIndex(i - 1, j));
  if (i < HALF - 1) list.push(cellIndex(i + 1, j));
  if (j > -HALF) list.push(cellIndex(i, j - 1));
  if (j < HALF - 1) list.push(cellIndex(i, j + 1));
  NEIGHBOURS.push(list);
}

const scratch = new Float64Array(CELLS);

/**
 * One step of a drifting field. `decay` is per second, `diffuse` the fraction exchanged with neighbours per
 * second, `advect` the fraction moved along the flow per second. `rising` picks the flow direction.
 */
export function stepDrift(field: number[], flow: Flow, dt: number, rising: boolean, decay: number, diffuse: number, advect: number): void {
  const keep = Math.exp(-decay * dt);
  const d = Math.min(0.24, diffuse * dt);
  const a = Math.min(0.5, advect * dt);
  const dir = rising ? flow.up : flow.down;
  for (let k = 0; k < CELLS; k++) scratch[k] = 0;
  for (let k = 0; k < CELLS; k++) {
    const v = field[k] * keep;
    if (v <= 1e-6) continue;
    const ns = NEIGHBOURS[k];
    const share = v * d;
    scratch[k] += v - share * ns.length;
    for (const n of ns) scratch[n] += share;
  }
  for (let k = 0; k < CELLS; k++) {
    const t = dir[k];
    if (t < 0) continue;
    const move = scratch[k] * a;
    if (move <= 0) continue;
    scratch[k] -= move;
    scratch[t] += move;
  }
  for (let k = 0; k < CELLS; k++) field[k] = scratch[k] < 1e-7 ? 0 : scratch[k];
}

export function at(field: number[], c: Cell): number {
  return field[cellIndex(c.i, c.j)];
}

export function addAt(field: number[], c: Cell, v: number): void {
  field[cellIndex(c.i, c.j)] += v;
}

/** Terrain-weighted centre of a field's mass: rises when the field drifts shoreward. */
export function meanHeight(field: number[], grid: Grid): number {
  let sum = 0, mass = 0;
  for (let k = 0; k < CELLS; k++) { sum += field[k] * grid.heights[k]; mass += field[k]; }
  return mass > 0 ? sum / mass : 0;
}

export function maxOf(field: number[]): number {
  let m = 0;
  for (let k = 0; k < CELLS; k++) if (field[k] > m) m = field[k];
  return m;
}
