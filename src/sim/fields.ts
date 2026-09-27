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

const flows = new WeakMap<Grid, { version: number; flow: Flow }>();
/** The flow for a grid, built once per terrain: rebuilt after landfill and after a load onto other ground. */
export function flowFor(grid: Grid): Flow {
  const hit = flows.get(grid);
  if (hit && hit.version === grid.terrainVersion) return hit.flow;
  const flow = buildFlow(grid);
  flows.set(grid, { version: grid.terrainVersion, flow });
  return flow;
}

// Each cell's in-bounds neighbours (west, east, south, north — the order the sums are taken in), flattened: the
// indices at NB[4k .. 4k + NB_COUNT[k]).
const NB = new Int32Array(CELLS * 4);
const NB_COUNT = new Uint8Array(CELLS);
for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
  const k = cellIndex(i, j);
  let n = 0;
  if (i > -HALF) NB[k * 4 + n++] = cellIndex(i - 1, j);
  if (i < HALF - 1) NB[k * 4 + n++] = cellIndex(i + 1, j);
  if (j > -HALF) NB[k * 4 + n++] = cellIndex(i, j - 1);
  if (j < HALF - 1) NB[k * 4 + n++] = cellIndex(i, j + 1);
  NB_COUNT[k] = n;
}

const scratch = new Float64Array(CELLS);

/**
 * One step of a drifting field. `decay` is per second, `diffuse` the fraction exchanged with neighbours per
 * second, `advect` the fraction moved along the flow per second. `rising` picks the flow direction.
 * `ceiling` bounds what is written back (1 for a field that is a fraction; the default leaves it unbounded).
 * (The arithmetic and its order are what they always were; the neighbour table is just flat.)
 */
export function stepDrift(field: number[], flow: Flow, dt: number, rising: boolean, decay: number, diffuse: number, advect: number, ceiling = Infinity): void {
  const keep = Math.exp(-decay * dt);
  const d = Math.min(0.24, diffuse * dt);
  const a = Math.min(0.5, advect * dt);
  const dir = rising ? flow.up : flow.down;
  scratch.fill(0);
  for (let k = 0; k < CELLS; k++) {
    const v = field[k] * keep;
    if (v <= 1e-6) continue;
    const count = NB_COUNT[k];
    const share = v * d;
    scratch[k] += v - share * count;
    const base = k * 4;
    for (let q = 0; q < count; q++) scratch[NB[base + q]] += share;
  }
  for (let k = 0; k < CELLS; k++) {
    const t = dir[k];
    if (t < 0) continue;
    const move = scratch[k] * a;
    if (move <= 0) continue;
    scratch[k] -= move;
    scratch[t] += move;
  }
  // Diffusion and drift conserve mass but not a cell's ceiling: several neighbours can drain into the same sink
  // cell and lift a fraction past full, so a field with a ceiling has it applied on the way back (QA #3).
  for (let k = 0; k < CELLS; k++) field[k] = scratch[k] < 1e-7 ? 0 : scratch[k] > ceiling ? ceiling : scratch[k];
}

export function at(field: number[], c: Cell): number {
  return field[cellIndex(c.i, c.j)];
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
