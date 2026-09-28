// Which roof a building wears and in what colour: pure functions over the ledger, shared by the island's
// building factories and the World's miniatures. No Babylon here.
import { BUILDINGS } from "../sim/balance";
import { Building } from "../sim/state";

export const ROOF_COLOURS: readonly string[] = ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"];

// The island's active roof palette and level shapes (view/biomes sets them through setRoofPalette); the World's
// miniatures pass each sector's own look instead.
let activeRoofs: readonly string[] = ROOF_COLOURS;
let activeShapeFor: (level: number) => RoofShape | null = () => null;
export function setRoofPalette(roofs: readonly string[], shapeFor: (level: number) => RoofShape | null): void {
  activeRoofs = roofs;
  activeShapeFor = shapeFor;
}

/** Roof colour by level: any of the palette at level 1, the second at 2, the third at 3. */
export function roofFor(b: Building, roofs: readonly string[] = activeRoofs): string {
  if (b.level >= 3) return roofs[2 % roofs.length];
  if (b.level === 2) return roofs[1 % roofs.length];
  return roofs[b.id % roofs.length];
}

export type RoofShape = "pyramid" | "gable" | "hipped";
const ROOF_SHAPES: RoofShape[] = ["pyramid", "gable", "hipped"];

/** Which of the three roofs a home wears: the biome's pick for its level, else seeded by its id (one draw per placement) and its level. */
export function roofShape(b: Building, shapeFor: (level: number) => RoofShape | null = activeShapeFor): RoofShape {
  return shapeFor(b.level) ?? ROOF_SHAPES[(Math.imul(b.id * 31 + b.level * 17 + 5, 2654435761) >>> 0) % 3];
}

/** Kinds on land with nothing under a roof worth drawing from the sky (fields, walls, nets). */
const ROOFLESS: ReadonlySet<string> = new Set(["path", "oysterBed", "seaWall", "breakwater", "sharkNet", "crocNet", "ricePaddy"]);
/** Does this kind have a roof worth drawing from the sky: anything on land with a footprint and walls. */
export function hasRoof(b: Building): boolean {
  const def = BUILDINGS[b.kind];
  if (def.cls === "deep" || def.cls === "edge" || def.cls === "street") return false;
  return !ROOFLESS.has(b.kind);
}
