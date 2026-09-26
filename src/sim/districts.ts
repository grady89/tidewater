// Districts: a cluster of buildings that touch (orthogonally, through any building) is a district once it has
// DISTRICT_MIN members. Districts are derived from the ledger on demand and store nothing: the name comes from
// the cluster's oldest building (lowest id), so it stays put while that building stands and survives a save.
import { BUILDINGS } from "./balance";
import { Grid } from "./grid";
import { Building, SimState } from "./state";
import { jobsAt } from "./workers";

export const DISTRICT_MIN = 3;

const FIRST = ["Herring", "Salt", "Gull", "Oyster", "Kelp", "Tern", "Cockle", "Driftwood", "Heron", "Mussel", "Lantern", "Eider"];
const SECOND = ["Quay", "Row", "Reach", "Stilts", "Flats", "Landing", "Walk", "Shoal"];

export interface District {
  name: string;
  /** Member building ids, ascending. */
  ids: number[];
  buildings: number;
  residents: number;
  capacity: number;
  workers: number;
  jobs: number;
  boats: number;
  /** Mean happiness of the lived-in homes, 0 with none. */
  happiness: number;
}

/** The name a cluster anchored on building `anchorId` gets. */
export function districtName(anchorId: number): string {
  const h = (Math.imul(anchorId + 1, 2654435761) >>> 0) % (FIRST.length * SECOND.length);
  return `${FIRST[h % FIRST.length]} ${SECOND[Math.floor(h / FIRST.length)]}`;
}

/** Every building that touches `b`, transitively. */
function cluster(grid: Grid, b: Building): Building[] {
  const seen = new Set<number>([b.id]);
  const out: Building[] = [b];
  const queue = [b];
  while (queue.length) {
    const q = queue.pop()!;
    for (const c of q.cells) for (const n of grid.neighbors(c)) {
      const r = grid.buildingAt(n);
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      queue.push(r);
    }
  }
  return out;
}

function describe(grid: Grid, members: Building[]): District {
  const ids = members.map(m => m.id).sort((a, b) => a - b);
  const d: District = { name: districtName(ids[0]), ids, buildings: members.length, residents: 0, capacity: 0, workers: 0, jobs: 0, boats: 0, happiness: 0 };
  let homes = 0;
  for (const m of members) {
    const def = BUILDINGS[m.kind];
    if (def.residents > 0) {
      d.residents += m.residents;
      d.capacity += grid.capacityOf(m);
      if (m.residents > 0) { homes++; d.happiness += m.happiness; }
    }
    d.workers += m.workers;
    d.jobs += jobsAt(m);
    d.boats += m.boats;
  }
  if (homes) d.happiness /= homes;
  return d;
}

/** The district `b` belongs to, or null when its cluster is too small to be one. */
export function districtOf(grid: Grid, b: Building): District | null {
  const members = cluster(grid, b);
  return members.length >= DISTRICT_MIN ? describe(grid, members) : null;
}

/** Every district in the town, ordered by its anchor id. */
export function districts(state: SimState, grid: Grid): District[] {
  const seen = new Set<number>();
  const out: District[] = [];
  for (const b of Object.values(state.buildings).sort((a, c) => a.id - c.id)) {
    if (seen.has(b.id)) continue;
    const members = cluster(grid, b);
    for (const m of members) seen.add(m.id);
    if (members.length >= DISTRICT_MIN) out.push(describe(grid, members));
  }
  return out;
}
