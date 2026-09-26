// Job assignment: residents of reached houses fill jobs at reached workplaces, nearest first over the walkway graph.
import { BOAT_CREW, BUILDINGS } from "./balance";
import { cellIndex, Grid } from "./grid";
import { distanceField } from "./network";
import { Assignment, Building, SimState } from "./state";

/** Jobs a building offers right now. */
export function jobsAt(b: Building): number {
  return (BUILDINGS[b.kind].slots ?? 0) > 0 ? b.boats * BOAT_CREW : BUILDINGS[b.kind].workers;
}

export function assignWorkers(state: SimState, grid: Grid): void {
  const buildings = Object.values(state.buildings).sort((a, b) => a.id - b.id);
  const homes = buildings.filter(b => b.reached && b.residents - b.injured > 0);
  const works = buildings.filter(b => b.reached && jobsAt(b) > 0);
  for (const b of buildings) b.workers = 0;
  state.assignments = [];
  if (!homes.length || !works.length) return;

  // Candidate pairs by walk distance from each workplace to each home's cells.
  const pairs: { home: Building; work: Building; d: number }[] = [];
  const field: Int32Array = distanceField(grid, works[0]);
  for (const work of works) {
    distanceField(grid, work, field);
    for (const home of homes) {
      let best = -1;
      for (const c of home.cells) { const d = field[cellIndex(c.i, c.j)]; if (d >= 0 && (best < 0 || d < best)) best = d; }
      if (best >= 0) pairs.push({ home, work, d: best });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.work.id - b.work.id || a.home.id - b.home.id);

  const free = new Map<number, number>(homes.map(h => [h.id, h.residents - h.injured]));
  const slots = new Map<number, number>(works.map(w => [w.id, jobsAt(w)]));
  const out: Assignment[] = [];
  for (const p of pairs) {
    const n = Math.min(free.get(p.home.id)!, slots.get(p.work.id)!);
    if (n <= 0) continue;
    free.set(p.home.id, free.get(p.home.id)! - n);
    slots.set(p.work.id, slots.get(p.work.id)! - n);
    p.work.workers += n;
    out.push({ home: p.home.id, work: p.work.id, n });
  }
  state.assignments = out;
}

/** Fraction of a workplace's jobs filled, 0..1. */
export function staffing(b: Building): number {
  const jobs = jobsAt(b);
  return jobs > 0 ? Math.min(1, b.workers / jobs) : 1;
}

/** Residents of a house that hold a job. */
export function employed(state: SimState, home: Building): number {
  let n = 0;
  for (const a of state.assignments) if (a.home === home.id) n += a.n;
  return n;
}
