// Cell materials sit beside the classes: the class (deep / flat / high) decides every rule that exists today, the
// material gates the biomes' unique buildings and tints the ground. The island generator sets them; the grid
// carries them; nothing else writes them. Codes are the index in MATERIALS, so a Uint8Array holds a map.
export type Material = "plain" | "lagoon" | "mangrove" | "lava" | "dune" | "oasis" | "vent" | "spring" | "fertile";
export const MATERIALS: readonly Material[] = ["plain", "lagoon", "mangrove", "lava", "dune", "oasis", "vent", "spring", "fertile"];
export const MATERIAL_LABEL: Record<Material, string> = {
  plain: "ground", lagoon: "the lagoon", mangrove: "mangrove", lava: "the lava field", dune: "a dune", oasis: "an oasis",
  vent: "a steam vent", spring: "a hot spring", fertile: "the fertile band",
};
/** Materials nothing may be built on. */
export const UNBUILDABLE: ReadonlySet<Material> = new Set<Material>(["lava"]);

export function materialCode(m: Material): number {
  return MATERIALS.indexOf(m);
}
export function materialOf(code: number): Material {
  return MATERIALS[code] ?? "plain";
}
