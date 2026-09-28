// The cells a dragged run covers: the L between two cells, and the route that bends round what the run cannot
// be laid on. Pure lattice code (no Babylon), so the sim tests can cover it.
import { DIRS, inBounds } from "../sim/cells";
import { Cell } from "../sim/state";

export const MAX_LINE = 40;

/** The cells from `a` to `b` as an L: first along the longer axis, then the other. Both ends included. */
export function linePath(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const di = b.i - a.i, dj = b.j - a.j;
  const iFirst = Math.abs(di) >= Math.abs(dj);
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
  /** The footprint the run leaves from when `a` itself cannot take it: a pier — any side of any of its cells. */
  startCells?: readonly Cell[];
  /** The footprint the run arrives at when `b` itself cannot take it: a hut, a market. */
  goalCells?: readonly Cell[];
}

/**
 * The cells from `a` to `b` that a run can actually be laid on: the L when every cell of it fits, otherwise the
 * cheapest route through cells that fit (a street dragged from the pier to the hut bends round the hill instead
 * of leaving planks on either side of a gap, and takes the shore over the deep flats when the shore is cheaper).
 * Either end may itself be unbuildable — the pier the drag starts on, the hut it ends on — in which case the
 * route starts beside it and ends beside it, beside any cell of its footprint. Excludes `a`. Null when no route
 * of at most `max` cells exists.
 */
export function routePath(a: Cell, b: Cell, fits: (c: Cell) => boolean, max = MAX_LINE, opts: RouteOptions = {}): Cell[] | null {
  const straight = linePath(a, b).slice(1);
  if (straight.length && straight.every(fits)) return straight;
  const key = (c: Cell) => c.i * 1000 + c.j;
  const cost = opts.cost ?? (() => 1);
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
  // Dijkstra over the cells that fit, bounded by `max` cells of run; `open` is kept sorted, dearest first.
  const prev = new Map<number, Cell | null>();
  const best = new Map<number, number>();
  const depth = new Map<number, number>();
  const done = new Set<number>();
  const open: { c: Cell; d: number }[] = [];
  const push = (c: Cell, d: number, from: Cell | null, n: number) => {
    const k = key(c);
    if (best.has(k) && best.get(k)! <= d) return;
    best.set(k, d); prev.set(k, from); depth.set(k, n);
    let at = open.length;
    while (at > 0 && open[at - 1].d < d) at--;
    open.splice(at, 0, { c, d });
  };
  for (const s of starts) push(s, fits(a) ? 0 : Math.max(1e-3, cost(s)), null, 1);
  while (open.length) {
    const { c, d } = open.pop()!;
    const k = key(c);
    if (done.has(k) || best.get(k)! < d) continue;
    done.add(k);
    if (goal.has(k)) {
      const out: Cell[] = [];
      for (let at: Cell | null = c; at; at = prev.get(key(at)) ?? null) out.push(at);
      out.reverse();
      if (out.length && out[0].i === a.i && out[0].j === a.j) out.shift();
      return out;
    }
    const n = depth.get(k)!;
    if (n >= max) continue;
    for (const dir of DIRS) {
      const m = { i: c.i + dir.i, j: c.j + dir.j };
      if (!inBounds(m.i, m.j) || done.has(key(m)) || !fits(m)) continue;
      const w = cost(m);
      if (!Number.isFinite(w)) continue;
      push(m, d + Math.max(1e-3, w), c, n + 1);
    }
  }
  return null;
}
