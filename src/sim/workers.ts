// Job assignment: residents keep the jobs they hold; the free hands of reached houses fill the open jobs at reached
// workplaces, nearest first over the walkway graph.
import { BOAT_CREW, BUILDINGS } from "./balance";
import { cellIndex, Grid } from "./grid";
import { distanceField } from "./network";
import { Building, SimState } from "./state";

/** Jobs a building offers right now. */
export function jobsAt(b: Building): number {
  const def = BUILDINGS[b.kind];
  // Piers and docks offer crew per boat; a kind with hands of its own and a berth (the whaling station) offers both.
  return (def.slots ?? 0) > 0 ? b.boats * BOAT_CREW + def.workers : def.workers;
}

/**
 * Jobs are kept. A resident who has a job stays in it, however near a new workplace opens: the ledger's assignments
 * carry over from one settlement to the next, trimmed only where a home now has fewer people, or a workplace fewer
 * jobs, than they name (the longest walk goes first). An injured resident, or one whose way the tide has cut, keeps
 * the job without working it this cycle (the longest walk idles first). A job the street no longer joins at all,
 * with nothing cut by the tide, is lost. Then the free hands (healthy residents with no job) fill the open jobs,
 * nearest first over the walkway graph, so a new workplace hires only people nobody else employs.
 */
export function assignWorkers(state: SimState, grid: Grid): void {
  const buildings = Object.values(state.buildings).sort((a, b) => a.id - b.id);
  for (const b of buildings) b.workers = 0;
  const fields = new Map<number, Int32Array>();
  /** Walk distance from a home to a workplace over the street this cycle, or -1 when it can't be walked. */
  const walk = (home: Building, work: Building): number => {
    if (!home.reached || !work.reached || home.cut || work.cut) return -1;
    let f = fields.get(work.id);
    if (!f) { f = distanceField(grid, work); fields.set(work.id, f); }
    let best = -1;
    for (const c of home.cells) { const d = f[cellIndex(c.i, c.j)]; if (d >= 0 && (best < 0 || d < best)) best = d; }
    return best;
  };
  const tideCut = buildings.some(b => b.cut);

  // 1. The jobs people hold.
  interface Job { home: Building; work: Building; held: number; n: number; d: number }
  const jobs: Job[] = [];
  for (const a of state.assignments) {
    const home = state.buildings[a.home], work = state.buildings[a.work];
    if (!home || !work || BUILDINGS[home.kind].residents === 0 || jobsAt(work) === 0) continue;
    const d = walk(home, work);
    if (d < 0 && !tideCut) continue;
    const had = jobs.find(j => j.home === home && j.work === work);
    if (had) had.held += a.held ?? a.n;
    else jobs.push({ home, work, held: a.held ?? a.n, n: 0, d: d < 0 ? Infinity : d });
  }
  const longestFirst = (x: Job, y: Job) => y.d - x.d || y.home.id - x.home.id || y.work.id - x.work.id;
  const trim = (of: (j: Job) => Building, room: (b: Building) => number) => {
    const total = new Map<number, number>();
    for (const j of jobs) total.set(of(j).id, (total.get(of(j).id) ?? 0) + j.held);
    for (const j of [...jobs].sort(longestFirst)) {
      const over = total.get(of(j).id)! - room(of(j));
      if (over <= 0) continue;
      const drop = Math.min(over, j.held);
      j.held -= drop;
      total.set(of(j).id, total.get(of(j).id)! - drop);
    }
  };
  trim(j => j.home, h => h.residents);
  trim(j => j.work, w => jobsAt(w));

  // 2. Who works them this cycle: a home's healthy residents, on the jobs the street reaches now, nearest first.
  const healthy = new Map<number, number>();
  for (const b of buildings) if (BUILDINGS[b.kind].residents > 0) healthy.set(b.id, b.reached && !b.cut ? Math.max(0, b.residents - b.injured) : 0);
  for (const j of [...jobs].sort((x, y) => -longestFirst(x, y))) {
    if (j.d === Infinity || j.held === 0) continue;
    j.n = Math.min(j.held, healthy.get(j.home.id)!);
    healthy.set(j.home.id, healthy.get(j.home.id)! - j.n);
  }

  // 3. The free hands fill the open jobs, nearest first.
  const heldAt = new Map<number, number>(), filledAt = new Map<number, number>();
  for (const j of jobs) { heldAt.set(j.home.id, (heldAt.get(j.home.id) ?? 0) + j.held); filledAt.set(j.work.id, (filledAt.get(j.work.id) ?? 0) + j.held); }
  const free = new Map<number, number>();
  for (const h of buildings) {
    if (BUILDINGS[h.kind].residents === 0 || !h.reached || h.cut) continue;
    const n = Math.min(healthy.get(h.id)!, Math.max(0, h.residents - h.injured - (heldAt.get(h.id) ?? 0)));
    if (n > 0) free.set(h.id, n);
  }
  const open = buildings.filter(w => w.reached && !w.cut && jobsAt(w) > (filledAt.get(w.id) ?? 0));
  if (free.size && open.length) {
    const pairs: { home: Building; work: Building; d: number }[] = [];
    for (const work of open) for (const id of free.keys()) {
      const home = state.buildings[id];
      const d = walk(home, work);
      if (d >= 0) pairs.push({ home, work, d });
    }
    pairs.sort((a, b) => a.d - b.d || a.work.id - b.work.id || a.home.id - b.home.id);
    for (const p of pairs) {
      const n = Math.min(free.get(p.home.id) ?? 0, jobsAt(p.work) - (filledAt.get(p.work.id) ?? 0));
      if (n <= 0) continue;
      free.set(p.home.id, free.get(p.home.id)! - n);
      filledAt.set(p.work.id, (filledAt.get(p.work.id) ?? 0) + n);
      const had = jobs.find(j => j.home === p.home && j.work === p.work);
      if (had) { had.held += n; had.n += n; } else jobs.push({ home: p.home, work: p.work, held: n, n, d: p.d });
    }
  }

  state.assignments = [];
  for (const j of jobs) {
    if (j.held <= 0) continue;
    j.work.workers += j.n;
    state.assignments.push(j.held > j.n ? { home: j.home.id, work: j.work.id, n: j.n, held: j.held } : { home: j.home.id, work: j.work.id, n: j.n });
  }
}

/**
 * A workplace lost jobs between settlements (a storm or the wave took its boats): the crew it can no longer employ
 * lose those jobs, newest assignment first, so the ledger never shows more workers or jobs held than there are jobs.
 * They are free hands at the next settlement.
 */
export function trimCrew(state: SimState, b: Building): void {
  const jobs = jobsAt(b);
  let held = 0;
  for (const a of state.assignments) if (a.work === b.id) held += a.held ?? a.n;
  let excess = held - jobs;
  for (let k = state.assignments.length - 1; k >= 0 && excess > 0; k--) {
    const a = state.assignments[k];
    if (a.work !== b.id) continue;
    const had = a.held ?? a.n;
    const drop = Math.min(had, excess);
    excess -= drop;
    const left = had - drop;
    if (left === 0) { state.assignments.splice(k, 1); continue; }
    a.n = Math.min(a.n, left);
    if (left > a.n) a.held = left; else delete a.held;
  }
  b.workers = 0;
  for (const a of state.assignments) if (a.work === b.id) b.workers += a.n;
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
