// The Atoll's look (BIOMES.md §3.2): the brightest water on the World, white sand, palms, thatched round huts,
// outriggers and straw hats; turtles, reef-fish shoals and frigatebirds; birds, softer surf, wind in the palms.
import type { BiomeLook } from "./index";

export const ATOLL_LOOK: BiomeLook = {
  id: "atoll",
  water: { shallow: "#9fe8dc", mid: "#3fc4c8", deep: "#1a6fa0" },
  terrain: { sandDeep: "#d9cfae", sand: "#f4ecd4", grassLo: "#8cc46a", grassHi: "#5faa5a", rock: "#b9b6ae", snowLine: 999, snow: "#eef2f5" },
  materialTints: { lagoon: { tint: "#e8f2e0", mix: 0.35 } },
  lagoon: { tint: "#9fe8dc", mix: 0.55 },
  sky: { fogTint: "#dff3f3", fogMix: 0.3, aurora: 0 },
  walls: ["#f7f1e3", "#f2ece0", "#f7e7d3", "#ece3c3", "#f7f1e3"],
  roofs: ["#c9a86a", "#b89a63", "#c9a86a", "#a98a55"],
  accents: { door: "#e0705a", trim: "#d9c9a5" },
  house: "round",
  roofShapeFor: () => "pyramid",
  boat: "outrigger",
  walker: { hat: "straw", colors: ["#e0705a", "#f7f1e3", "#3fc4c8", "#8cc46a", "#f4d9c6", "#c9a86a", "#2f6f8f", "#f4ecd4"] },
  trees: { kit: "palm", trunk: "#a98a55", leaves: ["#5faa5a", "#8cc46a", "#4f9a4a"] },
  fauna: ["turtles", "reefFish", "frigatebirds", "crabs"],
  ambience: { surf: 0.6, gulls: false, wind: 0.3, ice: 0, palms: 1, birds: 1, padRoot: 123 },
};
