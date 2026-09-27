// Trees are a ledger field: fixed sites on the high ground (deterministic from a seed, so they need no saving) and a
// per-site age in state.trees (1 = grown, 0 = just felled). Lumber camps fell grown trees nearby; felled trees
// regrow over TREE_REGROW_CYCLES. The view scales each tree by its age.
import { LUMBER_RADIUS, TREE_REGROW_CYCLES } from "./balance";
import { island } from "./island";
import { Building, Cell, SimState } from "./state";

export interface TreeSite { x: number; z: number; s: number; cell: Cell }

/** The original island's tree sites (seed 0), in a fixed order. Other islands: `island(seed).trees`. */
export const TREE_SITES: readonly TreeSite[] = island(0).trees;

export function initialTrees(islandSeed = 0): number[] {
  return island(islandSeed).trees.map(() => 1);
}

/** Every tree site: the island's fixed ones, then any the player planted. Ages in state.trees line up. */
export function treeSites(state: SimState): readonly TreeSite[] {
  const fixed = island(state.world.seed).trees;
  return state.extraTrees.length ? [...fixed, ...state.extraTrees] : fixed;
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
