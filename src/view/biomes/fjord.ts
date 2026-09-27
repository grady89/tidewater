// The Fjord's look (BIOMES.md §3.3): dark steep water between two ridges, grey shingle, pines to the shoreline,
// stave-style dark timber houses with steep roofs, snow above 4.0, aurora at night; longboats, hooded coats;
// seals, whale spouts and puffins; wind and ice creak.
import type { BiomeLook } from "./index";

export const FJORD_LOOK: BiomeLook = {
  id: "fjord",
  water: { shallow: "#7fb7b0", mid: "#2b6f78", deep: "#10303f" },
  terrain: { sandDeep: "#6f6a5e", sand: "#a9a08a", grassLo: "#3f7346", grassHi: "#2f5e3a", rock: "#6b6a66", snowLine: 4.0, snow: "#eef2f5" },
  materialTints: {},
  lagoon: { tint: "#9fe8dc", mix: 0 },
  sky: { fogTint: "#b8c6cf", fogMix: 0.35, aurora: 1 },
  walls: ["#3d2e26", "#5a4636", "#8a3f33", "#4a3a30", "#3d2e26"],
  roofs: ["#2b2b2b", "#5d6d7a", "#2b2b2b", "#4c5a66"],
  accents: { door: "#8a3f33", trim: "#2b2b2b" },
  house: "stave",
  roofShapeFor: () => "gable",
  boat: "longboat",
  walker: { hat: "hood", colors: ["#3d2e26", "#5a4636", "#8a3f33", "#4c5a66", "#5d6d7a", "#2b2b2b", "#b9a377", "#6b6a66"] },
  trees: { kit: "pine", trunk: "#3a2c24", leaves: ["#2f5e3a", "#3f7346", "#274f33"] },
  fauna: ["seals", "whales", "puffins"],
  ambience: { surf: 0.7, gulls: false, wind: 1, ice: 0.6, palms: 0, birds: 0, padRoot: 98 },
};
