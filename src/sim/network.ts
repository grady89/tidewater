// Connectivity: flood-fill from piers through walkways. Houses are leaves; a house is reached when a reached
// walkway or pier is orthogonally adjacent. Anything whose floor is under water is cut and blocks the fill.
import { Grid, Piece } from "../build/grid";

export interface NetworkStats {
  houses: number;
  reached: number;
  cut: number;
}

export function updateNetwork(grid: Grid, waterLevel: number): NetworkStats {
  const stats: NetworkStats = { houses: 0, reached: 0, cut: 0 };
  const queue: Piece[] = [];
  for (const p of grid.pieces.values()) {
    p.cut = p.floorY < waterLevel;
    p.reached = false;
    if (p.cut) stats.cut++;
    if (p.kind === "house") stats.houses++;
    if (p.kind === "pier" && !p.cut) { p.reached = true; queue.push(p); }
  }
  while (queue.length) {
    const p = queue.pop()!;
    for (const c of p.cells) for (const n of grid.neighbors(c)) {
      const q = grid.pieceAt(n);
      if (!q || q.cut || q.reached) continue;
      q.reached = true;
      if (q.kind === "walkway") queue.push(q);
      else if (q.kind === "house") stats.reached++;
    }
  }
  return stats;
}
