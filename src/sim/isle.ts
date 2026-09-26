// The second island: a low dome of flats in the deep water off the south-east corner, blended into the
// heightfield. It is locked until the town has a harbor — the ferry is what makes it reachable — and the grid
// refuses placement on it before then. Pure geometry; nothing here reads the state.
import { Cell } from "./state";

/** Centre and radius in world units. The dome is designed so its top stays under the tree line (< 1.3). */
export const ISLE = { x: 22.5, z: 22.5, r: 8.5 };

function dist(x: number, z: number): number {
  return Math.hypot(x - ISLE.x, z - ISLE.z) / ISLE.r;
}

/** 1 over the isle proper, fading to 0 at the rim so the heightfield blend has no seam. */
export function isleWeight(x: number, z: number): number {
  const d = dist(x, z);
  if (d >= 1) return 0;
  if (d <= 0.82) return 1;
  const t = (d - 0.82) / 0.18;
  return 1 - t * t * (3 - 2 * t);
}

/** The isle's own height: a small high knob at the centre, flats most of the way out, deep at the rim. */
export function isleHeight(x: number, z: number): number {
  const d = dist(x, z);
  return 0.85 - 1.5 * d * d;
}

/** Is the cell inside the isle's circle (its flats, its knob, and the ring of water round them)? */
export function isleCell(c: Cell): boolean {
  return dist(c.i + 0.5, c.j + 0.5) < 1;
}
