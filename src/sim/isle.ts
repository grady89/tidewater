// The second island: a low shelf of flats around a knob, in the deep water off the south-east corner, blended
// into the heightfield. It is locked until the town has a harbor — the ferry is what makes it reachable — and
// the grid refuses placement on it before then. Pure geometry; nothing here reads the state.
//
// Nothing about it is a circle: the rim is a circle warped by three low harmonics, the knob sits off-centre so
// the shelf is wide on one side and narrow on the other, and the shelf tilts a little around, so the beach and
// the shallows vary — the "perfect ring of light" a round dome drew in the water is gone.
import { Cell } from "./state";

/** Centre and mean radius in world units. The knob is designed so its top stays under the tree line (< 1.3). */
export const ISLE = { x: 22.5, z: 22.5, r: 8.5 };
/** Where the knob rises: a little west and south of the rim's centre. */
const KNOB = { x: 21.2, z: 23.7 };

/** The rim's radius in a direction: three harmonics that never sum to a round outline. */
function rimRadius(theta: number): number {
  return ISLE.r * (1 + 0.13 * Math.sin(3 * theta + 0.7) + 0.08 * Math.sin(5 * theta + 2.1) + 0.05 * Math.sin(7 * theta + 4.0));
}

/** Distance from the centre as a fraction of the rim's radius in that direction: 1 on the rim. */
function dist(x: number, z: number): number {
  const dx = x - ISLE.x, dz = z - ISLE.z;
  return Math.hypot(dx, dz) / rimRadius(Math.atan2(dz, dx));
}

/** 1 over the isle proper, fading to 0 at the rim so the heightfield blend has no seam. */
export function isleWeight(x: number, z: number): number {
  const d = dist(x, z);
  if (d >= 1) return 0;
  if (d <= 0.82) return 1;
  const t = (d - 0.82) / 0.18;
  return 1 - t * t * (3 - 2 * t);
}

/** The isle's own height: the knob at its own centre, flats most of the way out, shallower on one side than the other. */
export function isleHeight(x: number, z: number): number {
  const k = Math.hypot(x - KNOB.x, z - KNOB.z) / (ISLE.r * 0.9);
  const theta = Math.atan2(z - ISLE.z, x - ISLE.x);
  return 0.85 - 1.5 * k * k + 0.07 * Math.sin(2 * theta + 1.3);
}

/** Is the cell inside the isle's outline (its flats, its knob, and the ring of water round them)? */
export function isleCell(c: Cell): boolean {
  return dist(c.i + 0.5, c.j + 0.5) < 1;
}
