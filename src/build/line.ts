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

/**
 * The cells from `a` to `b` that a run can actually be laid on: the L when every cell of it fits, otherwise the
 * shortest route through cells that fit (a street dragged from the pier to the hut bends round the hill instead
 * of leaving planks on either side of a gap). Either end may itself be unbuildable — the pier the drag starts on,
 * the hut it ends on — in which case the route starts beside it and ends beside it. Excludes `a`. Null when no
 * route of at most `max` cells exists.
 */
export function routePath(a: Cell, b: Cell, fits: (c: Cell) => boolean, max = MAX_LINE): Cell[] | null {
  const straight = linePath(a, b).slice(1);
  if (straight.every(fits)) return straight;
  const key = (c: Cell) => c.i * 1000 + c.j;
  const goal = new Set<number>();
  if (fits(b)) goal.add(key(b));
  else for (const d of DIRS) { const n = { i: b.i + d.i, j: b.j + d.j }; if (inBounds(n.i, n.j) && fits(n)) goal.add(key(n)); }
  if (!goal.size) return null;
  const prev = new Map<number, Cell | null>();
  const queue: Cell[] = [];
  const seed = (c: Cell, from: Cell | null) => { const k = key(c); if (prev.has(k)) return; prev.set(k, from); queue.push(c); };
  if (fits(a)) seed(a, null);
  else for (const d of DIRS) { const n = { i: a.i + d.i, j: a.j + d.j }; if (inBounds(n.i, n.j) && fits(n)) seed(n, null); }
  const depth = new Map<number, number>();
  for (const c of queue) depth.set(key(c), 1);
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const k = key(c);
    if (goal.has(k)) {
      const out: Cell[] = [];
      for (let at: Cell | null = c; at; at = prev.get(key(at)) ?? null) out.push(at);
      return out.reverse();
    }
    const dd = depth.get(k)!;
    if (dd >= max) continue;
    for (const d of DIRS) {
      const n = { i: c.i + d.i, j: c.j + d.j };
      if (!inBounds(n.i, n.j) || prev.has(key(n)) || !fits(n)) continue;
      prev.set(key(n), c); depth.set(key(n), dd + 1); queue.push(n);
    }
  }
  return null;
}
