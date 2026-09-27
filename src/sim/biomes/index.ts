// Biomes on the ledger side: the id, the band it may stand in, and (Stage 2) the delta it applies to the base
// catalog. Every biome runs the same ledger; this file only says what differs. The sim never imports Babylon.
import { BASE_MAKES, GoodId } from "../goods";

export type BiomeId = "tidewater" | "delta" | "dunes" | "atoll" | "cinder" | "fjord";
export const BIOME_IDS: readonly BiomeId[] = ["tidewater", "delta", "dunes", "atoll", "cinder", "fjord"];
export const BIOME_LABEL: Record<BiomeId, string> = { tidewater: "Tidewater", delta: "Delta", dunes: "Dunes", atoll: "Atoll", cinder: "Cinder", fjord: "Fjord" };

export function isBiomeId(id: unknown): id is BiomeId {
  return typeof id === "string" && (BIOME_IDS as readonly string[]).includes(id);
}

/** The goods an island of this biome can make on its own (Stage 2 fills the other biomes in). */
export function makesOf(biome: BiomeId): readonly GoodId[] {
  void biome;
  return BASE_MAKES;
}

/** The luxury an island of this biome makes itself (never "foreign" to it). */
export function luxuryOf(biome: BiomeId): GoodId {
  return LUXURY[biome];
}
/** The favourite luxury (BIOMES.md §2's ring): in stock, it adds HAPPY.favourite to every home. */
export function favouriteOf(biome: BiomeId): GoodId {
  return FAVOURITE[biome];
}
const LUXURY: Record<BiomeId, GoodId> = { tidewater: "smoked", atoll: "pearls", delta: "indigo", cinder: "cocoa", fjord: "whaleOil", dunes: "coffee" };
const FAVOURITE: Record<BiomeId, GoodId> = { tidewater: "coffee", atoll: "smoked", delta: "pearls", cinder: "indigo", fjord: "cocoa", dunes: "whaleOil" };
