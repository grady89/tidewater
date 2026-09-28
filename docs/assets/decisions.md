# Assets pilot — decisions

Where the brief was silent or could not be followed to the letter, the simplest option consistent with the game.

1. **Blender 5.2.2 LTS, not 4.x.** The brief says "require 4.x"; this machine has only 5.2.2 LTS (the current
   long-term release). The requirement is read as a floor (major ≥ 4): stopping would leave the pilot undone,
   and everything the pipeline uses (bpy geometry, colour attributes, the glTF exporter, Workbench) exists in 5.x.
   The resolver accepts 4.x or later and records the version in tools/assets/blender.json.
2. **The palette reads the looks through esbuild.** Node runs .ts here but its resolver wants file extensions the
   game's sources don't carry (`./atoll`), so palette.ts bundles src/view/biomes/index.ts with esbuild (already a
   dev dependency) and imports the bundle; the bundle is refused if it mentions `@babylonjs`. palette.json keeps
   each look's hexes by role plus `all`, the set a kit may paint with.
3. **Tint masks.** Parts the game paints per instance — boat hulls (the hull colour cycles per boat), palm fronds
   (the leaf colour per tree) — are exported in #ffffff, #e4e4e4 or #c8c8c8 (the greys the conifer kit already uses
   for shading under the instance colour), the only non-palette values allowed. The turntable shows them in the
   game's colour: the hull in the look's `accents.door` (Tidewater's #2f6f8f is one of the hull colours), the
   fronds in the look's leaves.
4. **Boat colours are roles over the palette** (kits/_boats.py): band = roofs[1], trim = accents.trim, deck and
   spars = trees.trunk, wood = terrain.sandDeep, sail = the palest of walls and terrain.sand, stripe and shield =
   accents.door. The same script with another look's palette is the recolour; nothing else changes. On
   Tidewater this lands on the primitive dory's own colours (the band #4c5a66, the deck #5b4634).
5. **Axes.** 1 Blender unit = 1 cell. Blender +X is the bow (the game's +x), Blender +Y is port (the game's +z, where
   the moorings keep the outrigger's float outboard), +Z up. The loader maps Blender (x, y, z) to Babylon (x, z, y).
6. **File names**: the asset's own look carries no suffix (dory.glb is Tidewater's, longboat.glb the Fjord's,
   outrigger.glb the Atoll's); the others are <name>.<look>.glb.
7. **The turntable**: one orthographic Workbench render of four copies in a 2×2 grid — front (bow toward the
   camera) top left, three-quarter top right, side (bow to the right) bottom left, top bottom right — and a
   1-cell cube in a strip underneath, on the look's sky colour. Flat lighting as briefed; with it alone the facets
   vanish, so Workbench's cavity shading and object outline are on to keep the silhouette and the planes readable.
8. **Normals.** A closed part (every edge shared by two faces) gets bmesh's outward normals; an open part (a hull
   split by colour, a frond's two sheets) keeps the winding it was built with — every primitive is built closed
   and wound outward before a part is split from it.
9. **The palm's coconuts ride with the trunk**, not the canopy: the canopy is multiplied by the leaf colour per
   tree, which would turn them olive. They sit under the fronds and are hidden from every angle the game uses
   (see pilot.md).
10. **tools/ is typechecked** (tsconfig include, `allowImportingTsExtensions` for Node's `.ts` imports).
