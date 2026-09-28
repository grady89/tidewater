// Biomes on the view side (BIOMES.md §5): the palette and the variant picks one island wears. Everything the
// view used to hard-code — terrain bands, water tints, sky fog, walls, roofs, boats, walkers, trees, fauna,
// ambience — is read through `lookFor(state)` / `lookOf(id)`. A look is data; the kits that draw it live in the
// modules that always drew them. Tidewater's look is the game as it was, value for value.
import type { BiomeId } from "../../sim/biomes";
import type { RoofShape } from "../roofs";
import { ATOLL_LOOK } from "./atoll";
import { FJORD_LOOK } from "./fjord";
import { DELTA_LOOK } from "./delta";

export type BoatKit = "dory" | "longboat" | "outrigger" | "sampan" | "dugout" | "dhow";
export type HatKit = "straw" | "knit" | "hood" | "conical" | "bandana" | "wrap";
export type TreeKit = "conifer" | "pine" | "palm" | "mangrove";
export type HouseKit = "cottage" | "stave" | "round" | "reed" | "basalt" | "cube";
export type FaunaKind = "gulls" | "crabs" | "seals" | "whales" | "puffins" | "turtles" | "reefFish" | "frigatebirds"
  | "flamingos" | "herons" | "crocodiles" | "fireflies" | "iguanas" | "boobies" | "plankton" | "pelicans" | "dolphins" | "ghostCrabs";

export interface BiomeLook {
  id: BiomeId;
  /** The water shader's three depth tints. */
  water: { shallow: string; mid: string; deep: string };
  /** The terrain shader's height bands, and the snow line (999 = no snow). */
  terrain: { sandDeep: string; sand: string; grassLo: string; grassHi: string; rock: string; snowLine: number; snow: string;
    /** Shift of the colour bands in metres (the terrain shader's coastLift): negative brings the green down the flats (the Delta's reeds). */
    bands?: number };
  /** Tints per cell material (materials.ts codes 1..8; missing = no tint) and how strongly they show. */
  materialTints: Partial<Record<"lagoon" | "mangrove" | "lava" | "dune" | "oasis" | "vent" | "spring" | "fertile", { tint: string; mix: number }>>;
  /** The water over lagoon cells is pulled toward this colour by `mix`. */
  lagoon: { tint: string; mix: number };
  /** Sky: the fog and horizon are pulled toward `fogTint` by `fogMix`; `aurora` 0..1 draws the curtains at night. */
  sky: { fogTint: string; fogMix: number; aurora: number };
  walls: readonly string[];
  roofs: readonly string[];
  /** Doors and shutters; trim on the hut kits. */
  accents: { door: string; trim: string };
  house: HouseKit;
  /** The roof a home of this level wears; null lets the base pick (pyramid / gable / hipped by id). */
  roofShapeFor(level: number): RoofShape | null;
  boat: BoatKit;
  walker: { hat: HatKit; colors: readonly string[] };
  trees: { kit: TreeKit; trunk: string; leaves: readonly string[] };
  fauna: readonly FaunaKind[];
  /** Ambience parameters for view/audio.ts (0..1 levels; `padRoot` in Hz). */
  ambience: { surf: number; gulls: boolean; wind: number; ice: number; palms: number; birds: number; padRoot: number;
    /** The later coasts' layers (0..1, absent = off): frogs and insects at night, rain, a low rumble, steam hiss, blown sand. */
    frogs?: number; insects?: number; rain?: number; rumble?: number; hiss?: number; sand?: number };
}

const LOOKS = new Map<BiomeId, BiomeLook>();
export function registerLook(l: BiomeLook): BiomeLook {
  LOOKS.set(l.id, l);
  return l;
}

/** Tidewater: CLAUDE.md §2's palette exactly as the view has always used it. */
export const TIDEWATER_LOOK: BiomeLook = registerLook({
  id: "tidewater",
  water: { shallow: "#94dbd1", mid: "#38a1b3", deep: "#175785" },
  terrain: { sandDeep: "#9e8c66", sand: "#e6d3a1", grassLo: "#a8c97a", grassHi: "#73a85c", rock: "#8f8a82", snowLine: 999, snow: "#eef2f5" },
  materialTints: {},
  lagoon: { tint: "#9fe8dc", mix: 0 },
  sky: { fogTint: "#cfe3ef", fogMix: 0, aurora: 0 },
  walls: ["#f2ece0", "#f4d9c6", "#d5e6ea", "#ece3c3", "#f7e7d3"],
  roofs: ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"],
  accents: { door: "#2f6f8f", trim: "#e6dccb" },
  house: "cottage",
  roofShapeFor: () => null,
  boat: "dory",
  walker: { hat: "straw", colors: ["#c9674f", "#4c5a66", "#2f6f8f", "#79ad5e", "#f4d9c6", "#b9543f", "#5d6d7a", "#e6d3a1"] },
  trees: { kit: "conifer", trunk: "#5b4634", leaves: ["#4a8a55", "#5a9a5c", "#3f7f4d"] },
  fauna: ["gulls", "crabs"],
  ambience: { surf: 1, gulls: true, wind: 0, ice: 0, palms: 0, birds: 0, padRoot: 110 },
});

// The other looks are plain data in their own files; registered here (not on their import) so no file reads this
// module's registry before it exists.
registerLook(FJORD_LOOK);
registerLook(ATOLL_LOOK);
registerLook(DELTA_LOOK);

/** The look for a biome id; Tidewater's for anything not registered. */
export function lookOf(id: BiomeId): BiomeLook {
  return LOOKS.get(id) ?? TIDEWATER_LOOK;
}
export function lookFor(state: { world: { biome: BiomeId } }): BiomeLook {
  return lookOf(state.world.biome);
}

