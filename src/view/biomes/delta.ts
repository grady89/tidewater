// The Delta's look (BIOMES.md §3.4): silty green water, mud flats and reed beds, mangroves on the banks,
// reed-thatched stilt houses with wide eaves, sampans, conical hats; flamingos and herons by day, crocodiles in
// the channels, fireflies at night; frogs and insects after dark, rain more often.
import type { BiomeLook } from "./index";

export const DELTA_LOOK: BiomeLook = {
  id: "delta",
  water: { shallow: "#b8c9a8", mid: "#5f8f7a", deep: "#2c5a5e" },
  terrain: { sandDeep: "#9e8c66", sand: "#cfc3a0", grassLo: "#a9b56a", grassHi: "#79ad5e", rock: "#8d8a83", snowLine: 999, snow: "#eef2f5", bands: -0.42 },
  materialTints: { mangrove: { tint: "#3e6b4a", mix: 0.4 } },
  lagoon: { tint: "#9fe8dc", mix: 0 },
  sky: { fogTint: "#d6dcc8", fogMix: 0.3, aurora: 0 },
  walls: ["#e9dfc0", "#d9c9a5", "#e9dfc0", "#f2ece0", "#d9c9a5"],
  roofs: ["#b89a63", "#8a6f52", "#b89a63", "#4c5a66"],
  accents: { door: "#4c5a66", trim: "#b89a63" },
  house: "reed",
  roofShapeFor: () => "hipped",
  boat: "sampan",
  walker: { hat: "conical", colors: ["#2e3f7f", "#e9dfc0", "#79ad5e", "#b89a63", "#4c5a66", "#c9674f", "#d9c9a5", "#5f8f7a"] },
  trees: { kit: "mangrove", trunk: "#5a4636", leaves: ["#3e6b4a", "#4a7a52", "#355f40"] },
  fauna: ["flamingos", "herons", "crocodiles", "fireflies"],
  ambience: { surf: 0.35, gulls: false, wind: 0.15, ice: 0, palms: 0, birds: 0.7, padRoot: 104, frogs: 1, insects: 1, rain: 0.5 },
};
