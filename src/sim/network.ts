// Connectivity: flood-fill from network roots (piers) through links (walkways, markets). Everything else is a leaf
// that is reached when a reached link or root is orthogonally adjacent. Anything whose floor is under water is cut
// and blocks the fill.
import { SIZE } from "../config";
import { BUILDINGS } from "./balance";
import { cellIndex, Grid } from "./grid";
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
  while (queue.length) {
    const b = queue.pop()!;
    for (const c of b.cells) for (const n of grid.neighbors(c)) {
      const q = grid.buildingAt(n);
      if (!q || q.cut || q.reached) continue;
      q.reached = true;
      if (BUILDINGS[q.kind].network === "link") queue.push(q);
      else if (BUILDINGS[q.kind].residents > 0) stats.reached++;
    }
  }
  return stats;
}

/**
 * Walk distance (in cells) from a building to every cell, through reached, un-cut links. Cells of the building
 * itself are 0; cells of leaf buildings adjacent to the path get the path length + 1. Unreachable = -1.
 */
export function distanceField(grid: Grid, from: Building, out: Int32Array = new Int32Array(SIZE * SIZE)): Int32Array {
  out.fill(-1);
  const queue: number[] = [];
  for (const c of from.cells) { out[cellIndex(c.i, c.j)] = 0; queue.push(c.i, c.j); }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++], j = queue[head++];
    const d = out[cellIndex(i, j)];
    for (const n of grid.neighbors({ i, j })) {
      const k = cellIndex(n.i, n.j);
      if (out[k] !== -1) continue;
      const q = grid.buildingAt(n);
      if (!q || q.cut || !q.reached) continue;
      out[k] = d + 1;
      if (BUILDINGS[q.kind].network !== "leaf") queue.push(n.i, n.j);
    }
  }
  return out;
}
