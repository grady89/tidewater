// The Dunes' look (BIOMES.md §3.6): pale sand and dune crests, clear shallow water over the lagoon, green only at
// the oases; whitewashed cube houses with small domes, dhows with lateen sails, head wraps; pelicans on the piers,
// dolphins in the lagoon, ghost crabs on the bars at night; dry wind and blown sand; the clearest stars on the World.
import type { BiomeLook } from "./index";

export const DUNES_LOOK: BiomeLook = {
  id: "dunes",
  water: { shallow: "#a6dcd0", mid: "#3aa3a8", deep: "#1d5f86" },
  terrain: { sandDeep: "#d9c89a", sand: "#efe2b8", grassLo: "#e8d9ac", grassHi: "#e2cf9a", rock: "#b9a98a", snowLine: 999, snow: "#eef2f5" },
  materialTints: { dune: { tint: "#e2cf9a", mix: 0.55 }, oasis: { tint: "#6d9c55", mix: 0.8 } },
  lagoon: { tint: "#9fe8dc", mix: 0 },
  sky: { fogTint: "#efe2b8", fogMix: 0.1, aurora: 0, stars: 1 },
  walls: ["#f6f1e6", "#f2ece0", "#f6f1e6", "#ece3c3", "#f7e7d3"],
  roofs: ["#d9c9a5", "#4c5a66", "#d9c9a5", "#f6f1e6"],
  accents: { door: "#2f6f8f", trim: "#d9c9a5" },
  house: "cube",
  roofShapeFor: () => "hipped",
  boat: "dhow",
  walker: { hat: "wrap", colors: ["#2f6f8f", "#f6f1e6", "#c9674f", "#d9c9a5", "#4c5a66", "#b9543f", "#e2cf9a", "#3aa3a8"] },
  trees: { kit: "palm", trunk: "#8a6f52", leaves: ["#6d9c55", "#4a8a55", "#79ad5e"] },
  fauna: ["pelicans", "dolphins", "ghostCrabs"],
  ambience: { surf: 0.55, gulls: false, wind: 0.7, ice: 0, palms: 0.25, birds: 0.2, padRoot: 110, sand: 1 },
};
