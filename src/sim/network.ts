// Connectivity: flood-fill from network roots (piers) through links (walkways, markets). Everything else is a leaf
// that is reached when a reached link or root is orthogonally adjacent. Anything whose floor is under water is cut
// and blocks the fill. The ferry is the one edge that isn't a walkway: it joins the mainland harbor to every pier
// or dock on the isle, FERRY_COST cells of walking apart, so the distance field (and with it job assignment)
// crosses the water.
import { SIZE } from "../config";
import { BUILDINGS, FERRY_COST } from "./balance";
import { cellIndex, DIRS, Grid, HALF, inBounds } from "./grid";
import { Building, SimState } from "./state";

export interface NetworkStats {
  houses: number;
  reached: number;
  cut: number;
}

export function updateNetwork(state: SimState, grid: Grid, waterLevel: number): NetworkStats {
  const stats: NetworkStats = { houses: 0, reached: 0, cut: 0 };
  const queue: Building[] = [];
  for (const b of Object.values(state.buildings)) {
    b.cut = b.floorY < waterLevel;
    b.reached = false;
    if (b.cut) stats.cut++;
    if (BUILDINGS[b.kind].residents > 0) stats.houses++;
    if (BUILDINGS[b.kind].network === "root" && !b.cut) { b.reached = true; queue.push(b); }
  }
  // The same flood fill as ever, visiting each cell's neighbours in DIRS order; it runs every tick, so it looks the
  // occupancy up by index instead of building neighbour cells.
  while (queue.length) {
    const b = queue.pop()!;
    for (const c of b.cells) for (const d of DIRS) {
      const i = c.i + d.i, j = c.j + d.j;
      if (!inBounds(i, j)) continue;
      const q = grid.buildingAtIJ(i, j);
      if (!q || q.cut || q.reached) continue;
      q.reached = true;
      if (BUILDINGS[q.kind].network === "link") queue.push(q);
      else if (BUILDINGS[q.kind].residents > 0) stats.reached++;
    }
  }
  return stats;
}

/** The ferry's two ends: the mainland harbor and every pier or dock standing on the isle. Null without both. */
export function ferryTerminals(grid: Grid): { harbor: Building; isle: Building[] } | null {
  const bs = Object.values(grid.state.buildings);
  const harbor = bs.find(b => b.kind === "harbor" && !b.cut && !grid.onIsle(b.cells)) ?? null;
  if (!harbor) return null;
  const isle = bs.filter(b => b.kind !== "harbor" && (BUILDINGS[b.kind].slots ?? 0) > 0 && !b.cut && grid.onIsle(b.cells)).sort((a, b) => a.id - b.id);
  return isle.length ? { harbor, isle } : null;
}

/** Workers whose home and workplace are on different sides of the water: they take the ferry. */
export function crossCommuters(state: SimState, grid: Grid): number {
  let n = 0;
  for (const a of state.assignments) {
    const home = state.buildings[a.home], work = state.buildings[a.work];
    if (home && work && grid.onIsle(home.cells) !== grid.onIsle(work.cells)) n += a.n;
  }
  return n;
}

/**
 * Walk distance (in cells) from a building to every cell, through reached, un-cut links, and across the ferry
 * for FERRY_COST. Cells of the building itself are 0; cells of leaf buildings adjacent to the path get the path
 * length + 1. Unreachable = -1. A bucket queue keeps distances minimal with the one weighted edge.
 */
export function distanceField(grid: Grid, from: Building, out: Int32Array = new Int32Array(SIZE * SIZE)): Int32Array {
  out.fill(-1);
  const ferry = ferryTerminals(grid);
  const across = new Map<number, Building[]>();
  if (ferry) { across.set(ferry.harbor.id, ferry.isle); for (const p of ferry.isle) across.set(p.id, [ferry.harbor]); }
  const fromCells = new Set(from.cells.map(c => cellIndex(c.i, c.j)));
  const buckets: number[][] = [];
  const push = (k: number, d: number) => {
    if (out[k] !== -1 && out[k] <= d) return;
    out[k] = d;
    (buckets[d] ??= []).push(k);
  };
  for (const k of fromCells) push(k, 0);
  for (let d = 0; d < buckets.length; d++) {
    const q = buckets[d];
    if (!q) continue;
    for (const k of q) {
      if (out[k] !== d) continue; // superseded by a shorter way in
      const i = Math.floor(k / SIZE) - HALF, j = (k % SIZE) - HALF;
      const here = grid.buildingAt({ i, j });
      // Only the origin and the network's links and roots carry the walk on; a leaf cell is an end.
      if (here && BUILDINGS[here.kind].network === "leaf" && !fromCells.has(k)) continue;
      const far = here ? across.get(here.id) : undefined;
      if (far) for (const t of far) for (const c of t.cells) push(cellIndex(c.i, c.j), d + FERRY_COST);
      for (const n of grid.neighbors({ i, j })) {
        const b = grid.buildingAt(n);
        if (!b || b.cut || !b.reached) continue;
        push(cellIndex(n.i, n.j), d + 1);
      }
    }
  }
  return out;
}
