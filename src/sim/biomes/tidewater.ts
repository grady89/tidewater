// Tidewater: the identity biome. The current generator, tide ×1, fish and shellfish, smoked goods, timber and
// planks, no unique kinds and nothing excluded. Seed 0 is the original island byte for byte.
import { islandHeight } from "../heightfield";
import { Biome, registerBiome } from "./registry";

export const TIDEWATER: Biome = registerBiome({
  id: "tidewater",
  label: "Tidewater",
  bands: ["temperate"],
  tide: 1,
  foods: ["fish", "shellfish"],
  luxury: "smoked",
  industrials: ["timber", "planks"],
  minor: [],
  cannotMake: ["coffee", "rice", "iron"],
  favourite: "coffee",
  unique: [],
  excluded: [],
  shape: noiseSeed => ({ height: islandHeight(noiseSeed) }),
  validate: () => [],
});
