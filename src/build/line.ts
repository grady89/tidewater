// The cells a dragged run covers: the L between two cells, and the route that bends round what the run cannot
// be laid on. Pure lattice code (no Babylon), so the sim tests can cover it.
import { DIRS, inBounds } from "../sim/cells";
import { Cell } from "../sim/state";

export const MAX_LINE = 40;

export type Axis = "i" | "j";

/** The cells from `a` to `b` as an L: first along `first` (default: the longer axis), then the other. Both ends included. */
export function linePath(a: Cell, b: Cell, first?: Axis): Cell[] {
  const out: Cell[] = [];
  const di = b.i - a.i, dj = b.j - a.j;
  const iFirst = first ? first === "i" : Math.abs(di) >= Math.abs(dj);
  let i = a.i, j = a.j;
  out.push({ i, j });
  const stepI = () => { while (i !== b.i) { i += Math.sign(di); out.push({ i, j }); } };
  const stepJ = () => { while (j !== b.j) { j += Math.sign(dj); out.push({ i, j }); } };
  if (iFirst) { stepI(); stepJ(); } else { stepJ(); stepI(); }
  return out.slice(0, MAX_LINE);
}

export interface RouteOptions {
  /** What laying each cell costs (default 1: the shortest route). The L is kept whenever it fits, whatever it costs. */
  cost?: (c: Cell) => number;
  /** What a bend costs on top (default 2): a run round a hill takes the way with the fewest turns, never a staircase. */
  turnCost?: number;
  /** Which way the L goes first (default: the longer axis). */
  axis?: Axis;
  /** Whether the run may step from one cell to the next (a path's rise per cell; default: always). */
  step?: (from: Cell, to: Cell) => boolean;
  /** The footprint the run leaves from when `a` itself cannot take it: a pier — any side of any of its cells. */
  startCells?: readonly Cell[];
  /** The footprint the run arrives at when `b` itself cannot take it: a hut, a market. */
  goalCells?: readonly Cell[];
}

/** A binary min-heap of node ids by cost. */
class Heap {
  private readonly ids: number[] = [];
  private readonly costs: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, cost: number): void {
    const ids = this.ids, costs = this.costs;
    ids.push(id); costs.push(cost);
    let k = ids.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (costs[parent] <= costs[k]) break;
      [ids[parent], ids[k]] = [ids[k], ids[parent]]; [costs[parent], costs[k]] = [costs[k], costs[parent]];
      k = parent;
    }
  }
  pop(): { id: number; cost: number } {
    const ids = this.ids, costs = this.costs;
    const top = { id: ids[0], cost: costs[0] };
    const lastId = ids.pop()!, lastCost = costs.pop()!;
    if (ids.length) {
      ids[0] = lastId; costs[0] = lastCost;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < ids.length && costs[l] < costs[m]) m = l;
        if (r < ids.length && costs[r] < costs[m]) m = r;
        if (m === k) break;
        [ids[m], ids[k]] = [ids[k], ids[m]]; [costs[m], costs[k]] = [costs[k], costs[m]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * The cells from `a` to `b` that a run can actually be laid on: the L when every cell of it fits, otherwise the
 * cheapest route through cells that fit, counting a bend as a cost (a street dragged from the pier to the hut
 * goes round the hill with one turn instead of a staircase of them, and takes the shore over the deep flats
 * when the shore is cheaper). Either end may itself be unbuildable — the pier the drag starts on, the hut it
 * ends on — in which case the route starts beside it and ends beside it, beside any cell of its footprint.
 * Excludes `a`. Null when no route of at most `max` cells exists.
 */
export function routePath(a: Cell, b: Cell, fits: (c: Cell) => boolean, max = MAX_LINE, opts: RouteOptions = {}): Cell[] | null {
  const step = opts.step ?? (() => true);
  const straight = linePath(a, b, opts.axis).slice(1);
  if (straight.length && straight.every(fits) && straight.every((c, k) => (k === 0 ? !fits(a) || step(a, c) : step(straight[k - 1], c)))) return straight;
  const key = (c: Cell) => (c.i + 64) * 256 + (c.j + 64);
  const cost = opts.cost ?? (() => 1);
  const turnCost = opts.turnCost ?? 2;
  const around = (cells: readonly Cell[]): Cell[] => {
    const out: Cell[] = [], seen = new Set<number>();
    for (const c of cells) for (const d of DIRS) {
      const n = { i: c.i + d.i, j: c.j + d.j };
      if (!inBounds(n.i, n.j) || seen.has(key(n)) || !fits(n)) continue;
      seen.add(key(n)); out.push(n);
    }
    return out;
  };
  const goal = new Set<number>((fits(b) ? [b] : around(opts.goalCells ?? [b])).map(key));
  if (!goal.size) return null;
  const starts = fits(a) ? [a] : around(opts.startCells ?? [a]);
  if (!starts.length) return null;
  // Dijkstra over (cell, heading): a node per cell per direction of arrival (4 = none yet), so a bend can be
  // priced; bounded by `max` cells of run.
  const NONE = 4;
  const node = (k: number, heading: number) => k * 5 + heading;
  const prev = new Map<number, number | null>();
  const cellOf = new Map<number, Cell>();
  const best = new Map<number, number>();
  const depth = new Map<number, number>();
  const done = new Set<number>();
  const open = new Heap();
  const push = (id: number, c: Cell, d: number, from: number | null, len: number) => {
    if (best.has(id) && best.get(id)! <= d) return;
    best.set(id, d); prev.set(id, from); cellOf.set(id, c); depth.set(id, len);
    open.push(id, d);
  };
  for (const s of starts) push(node(key(s), NONE), s, fits(a) ? 0 : Math.max(1e-3, cost(s)), null, 1);
  while (open.size) {
    const { id, cost: d } = open.pop();
    if (done.has(id) || best.get(id)! < d) continue;
    done.add(id);
    const c = cellOf.get(id)!;
    const heading = id - Math.floor(id / 5) * 5;
    if (goal.has(key(c))) {
      const out: Cell[] = [];
      for (let at: number | null = id; at !== null; at = prev.get(at) ?? null) out.push(cellOf.get(at)!);
      out.reverse();
      if (out.length && out[0].i === a.i && out[0].j === a.j) out.shift();
      return out;
    }
    const len = depth.get(id)!;
    if (len >= max) continue;
    for (let di = 0; di < DIRS.length; di++) {
      const dir = DIRS[di];
      const m = { i: c.i + dir.i, j: c.j + dir.j };
      if (!inBounds(m.i, m.j) || !fits(m) || !step(c, m)) continue;
      const w = cost(m);
      if (!Number.isFinite(w)) continue;
      const turn = heading !== NONE && heading !== di ? turnCost : 0;
      push(node(key(m), di), m, d + Math.max(1e-3, w) + turn, id, len + 1);
    }
  }
  return null;
}
