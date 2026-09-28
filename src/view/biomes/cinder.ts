// The Cinder's look (BIOMES.md §3.5): black sand, dark rock, a green band on the mid-slope, the lava field glowing
// at night; flat-roofed basalt houses, dugouts with one sail, bandanas; iguanas, boobies, plankton in the
// shallows after dark; a low rumble and steam hissing at the vents.
import type { BiomeLook } from "./index";

export const CINDER_LOOK: BiomeLook = {
  id: "cinder",
  water: { shallow: "#6fbfb8", mid: "#2a8e96", deep: "#123f57" },
  terrain: { sandDeep: "#1c1a1a", sand: "#2e2a2a", grassLo: "#3f8a4a", grassHi: "#79ad5e", rock: "#4a4644", snowLine: 999, snow: "#eef2f5" },
  materialTints: { lava: { tint: "#1c1a1a", mix: 0.85 }, fertile: { tint: "#3f8a4a", mix: 0.55 }, vent: { tint: "#8d8a83", mix: 0.5 }, spring: { tint: "#6fbfb8", mix: 0.35 } },
  lagoon: { tint: "#9fe8dc", mix: 0 },
  sky: { fogTint: "#c9c3c0", fogMix: 0.2, aurora: 0 },
  walls: ["#5a5350", "#8d8a83", "#5a5350", "#6b6a66", "#8d8a83"],
  roofs: ["#c9674f", "#3d3a3a", "#c9674f", "#3d3a3a"],
  accents: { door: "#c9674f", trim: "#3d3a3a" },
  house: "basalt",
  roofShapeFor: () => "hipped",
  boat: "dugout",
  walker: { hat: "bandana", colors: ["#c9674f", "#e6dccb", "#3f8a4a", "#2a8e96", "#8d8a83", "#ffb859", "#5a5350", "#79ad5e"] },
  trees: { kit: "palm", trunk: "#5a4636", leaves: ["#3f8a4a", "#79ad5e", "#4a8a55"] },
  fauna: ["iguanas", "boobies", "plankton", "crabs"],
  glow: { material: "lava", color: "#ff6a2a", amount: 0.55 },
  ambience: { surf: 0.8, gulls: false, wind: 0.3, ice: 0, palms: 0.4, birds: 0.3, padRoot: 92, rumble: 1, hiss: 1 },
};
