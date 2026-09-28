// Biomes on the ledger side (BIOMES.md §5): what a biome changes about the one catalog. Every biome runs the same
// ledger, tide clock, placement rules and stilt rule; a Biome is a delta: a tide multiplier, its goods, a few
// unique kinds and a few excluded ones, a terrain shaper with materials, validation on top of the base rules, and
// hooks the hazards and events call. Never a second catalog. The sim never imports Babylon.
// The interface and the registry live in registry.ts; every biome file registers itself when imported here.
export * from "./registry";
import "./tidewater";
import "./fjord";
import "./atoll";
import "./delta";
