// A sector's miniature, as data: the island's heights on a coarse grid (landfill included) and where the roofs
// go, coloured from the real buildings. Pure functions over the ledger and the island generator — no Babylon —
// so the tests can check them; src/globe/world.ts turns them into meshes.
import { SIZE } from "../config";
import { BUILDINGS } from "../sim/balance";
import { LANDFILL_HEIGHT } from "../sim/balance";
import { HeightFn } from "../sim/heightfield";
import { SimState } from "../sim/state";
import { lookFor } from "../view/biomes";
import { hasRoof, roofFor, roofShape, RoofShape } from "../view/roofs";

/** Cells across the island square in the miniature (2-unit cells): 32 → 33 × 33 vertices. */
export const MINI_CELLS = 32;

/**
 * Vertex heights of the miniature on an (n+1)² grid over the 64-unit square, row-major with z growing down the
 * rows (row 0 = z = −32). Landfill cells stand at LANDFILL_HEIGHT.
 */
export function miniatureHeights(height: HeightFn, landfill: number[], n = MINI_CELLS, extent = SIZE / 2, landfillHeight = LANDFILL_HEIGHT): Float32Array {
  const out = new Float32Array((n + 1) * (n + 1));
  const filled = new Set(landfill);
  const half = SIZE / 2;
  const clamp = (v: number) => Math.max(-half, Math.min(half, v));
  for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
    // A grid over [−extent, extent]²; beyond the island's own square the heights continue its rim (the World's
    // heightmap clamps the same way, so the water's depth and the ground agree everywhere on the face).
    const x = clamp(-extent + (col * 2 * extent) / n), z = clamp(-extent + (row * 2 * extent) / n);
    let h = height(x, z);
    if (filled.size) {
      // A vertex on a landfill cell (or its boundary) stands at the fill height, like the island's own mesh.
      const i = Math.floor(x), j = Math.floor(z);
      for (const [di, dj] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const ci = i + di, cj = j + dj;
        if (ci < -half || ci >= half || cj < -half || cj >= half) continue;
        if (filled.has((ci + half) * SIZE + (cj + half)) && x >= ci && x <= ci + 1 && z >= cj && z <= cj + 1) h = Math.max(h, landfillHeight);
      }
    }
    out[row * (n + 1) + col] = h;
  }
  return out;
}

export interface RoofPlacement {
  shape: RoofShape;
  colour: string;
  /** Footprint centre and extent in island units; `y` is the roof's base (the deck plus the walls). */
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
}

/** The roofs to show on a miniature: one per building with walls, at its floor plus a kind-sized body. */
export function roofPlacements(state: SimState): RoofPlacement[] {
  const out: RoofPlacement[] = [];
  const look = lookFor(state);
  for (const b of Object.values(state.buildings)) {
    if (!hasRoof(b)) continue;
    const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    const home = BUILDINGS[b.kind].residents > 0;
    const body = home ? 0.55 + 0.14 * (b.level - 1) : 0.7;
    out.push({
      shape: home ? roofShape(b) : "hipped",
      colour: home ? roofFor(b, look.roofs) : look.roofs[1 % look.roofs.length],
      x: (minI + maxI + 1) / 2, z: (minJ + maxJ + 1) / 2, y: b.floorY + body,
      w: maxI - minI + 1, d: maxJ - minJ + 1,
    });
  }
  return out;
}

/** The tide level a sector's water sits at: the state's own. */
export function tideOf(state: SimState): number {
  return state.tide.level;
}
