// Which roof a building wears and in what colour: pure functions over the ledger, shared by the island's
// building factories and the World's miniatures. No Babylon here.
import { BUILDINGS } from "../sim/balance";
import { Building } from "../sim/state";

export const ROOF_COLOURS = ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"];

/** Roof colour by level: any of the palette at level 1, slate at 2, the red at 3. */
export function roofFor(b: Building): string {
  if (b.level >= 3) return ROOF_COLOURS[2];
  if (b.level === 2) return ROOF_COLOURS[1];
  return ROOF_COLOURS[b.id % ROOF_COLOURS.length];
}

export type RoofShape = "pyramid" | "gable" | "hipped";
const ROOF_SHAPES: RoofShape[] = ["pyramid", "gable", "hipped"];

/** Which of the three roofs a home wears: seeded by its id (one draw per placement) and its level. */
export function roofShape(b: Building): RoofShape {
  return ROOF_SHAPES[(Math.imul(b.id * 31 + b.level * 17 + 5, 2654435761) >>> 0) % 3];
}

/** Does this kind have a roof worth drawing from the sky: anything on land with a footprint and walls. */
export function hasRoof(b: Building): boolean {
  const def = BUILDINGS[b.kind];
  if (def.cls === "deep" || def.cls === "edge" || def.cls === "street") return false;
  return b.kind !== "path" && b.kind !== "oysterBed" && b.kind !== "seaWall" && b.kind !== "breakwater" && b.kind !== "sharkNet";
}
