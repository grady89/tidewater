// Trees are a ledger field: fixed sites on the high ground (deterministic from a seed, so they need no saving) and a
// per-site age in state.trees (1 = grown, 0 = just felled). Lumber camps fell grown trees nearby; felled trees
// regrow over TREE_REGROW_CYCLES. The view scales each tree by its age.
import { LUMBER_RADIUS, TREE_REGROW_CYCLES } from "./balance";
import { terrainHeight } from "./heightfield";
import { Building, Cell, SimState } from "./state";

export interface TreeSite { x: number; z: number; s: number; cell: Cell }

const TREE_SEED = 7;
const TREE_COUNT = 70;

function makeSites(): TreeSite[] {
  let seed = TREE_SEED;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sites: TreeSite[] = [];
  for (let tries = 0; tries < 3000 && sites.length < TREE_COUNT; tries++) {
    const x = (rnd() - 0.5) * 56, z = (rnd() - 0.5) * 56;
    const h = terrainHeight(x, z);
    if (h < 1.3 || h > 5.2) continue;
    const slope = Math.abs(terrainHeight(x + 0.6, z) - terrainHeight(x - 0.6, z)) + Math.abs(terrainHeight(x, z + 0.6) - terrainHeight(x, z - 0.6));
    if (slope > 1.1) continue;
    const s = 0.8 + rnd() * 0.7;
    rnd(); // the cone's yaw in the study; keep the stream aligned for the view
    sites.push({ x, z, s, cell: { i: Math.floor(x), j: Math.floor(z) } });
  }
  return sites;
}

/** The island's tree sites, in a fixed order. */
export const TREE_SITES: readonly TreeSite[] = makeSites();

export function initialTrees(): number[] {
  return TREE_SITES.map(() => 1);
}

/** Every tree site: the island's fixed ones, then any the player planted. Ages in state.trees line up. */
export function treeSites(state: SimState): readonly TreeSite[] {
  return state.extraTrees.length ? [...TREE_SITES, ...state.extraTrees] : TREE_SITES;
}

function near(site: TreeSite, cells: Cell[], radius: number): boolean {
  return cells.some(c => Math.abs(site.cell.i - c.i) <= radius && Math.abs(site.cell.j - c.j) <= radius);
}

/** Grown trees within LUMBER_RADIUS of `cells`. */
export function grownTreesNear(state: SimState, cells: Cell[], radius = LUMBER_RADIUS): number {
  let n = 0;
  treeSites(state).forEach((s, k) => { if (state.trees[k] >= 1 && near(s, cells, radius)) n++; });
  return n;
}

/** Fell up to `count` grown trees around the camp, nearest first. Returns how many fell. */
export function fellTrees(state: SimState, camp: Building, count: number): number {
  const c0 = camp.cells[0];
  const candidates: { k: number; d: number }[] = [];
  treeSites(state).forEach((s, k) => {
    if (state.trees[k] < 1 || !near(s, camp.cells, LUMBER_RADIUS)) return;
    candidates.push({ k, d: Math.hypot(s.cell.i - c0.i, s.cell.j - c0.j) });
  });
  candidates.sort((a, b) => a.d - b.d || a.k - b.k);
  const felled = candidates.slice(0, Math.max(0, Math.floor(count)));
  for (const f of felled) state.trees[f.k] = 0;
  return felled.length;
}

/** Once per cycle: felled trees grow back. */
export function regrowTrees(state: SimState): void {
  for (let k = 0; k < state.trees.length; k++) if (state.trees[k] >= 0 && state.trees[k] < 1) state.trees[k] = Math.min(1, state.trees[k] + 1 / TREE_REGROW_CYCLES);
}
