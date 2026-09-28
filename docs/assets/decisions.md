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
11. **@babylonjs/loaders 7.54.3**, the exact version of @babylonjs/core, imported with a dynamic `import()` on the
    first asset load, so with the flag off the build never fetches the glTF plugin (Vite splits it into its own chunk).
12. **The flag-off path is untouched.** main.ts does not await anything: the kits build their primitives as they
    always did. Only with the flag on does main start loading the assets and ask Boats, Trees and Wildlife to
    rebuild once they are in (a few frames of primitives at boot, then the swap).
13. **`?assets=blender`** turns the Blender assets on for one page load, alongside the config constant, so the
    quality run can measure both without a rebuild.
14. **The loader lifts every part out of the glTF hierarchy** into plain vertex data in the game's axes (the loader's
    handedness root and a half turn about y), converts COLOR_0 from glTF's linear values back to the sRGB bytes the
    flat material expects (exact to 1/255: the colours on screen are the palette's), and winds each triangle the way
    Babylon's own builders do (compared against the file's normals, so a handedness flip anywhere upstream can't
    turn a model inside out). Normals are checked flat; a non-flat file would be converted.
15. **Fit offsets** (src/view/assets.ts `FIT`): boats sit 0.02 lower (the primitive keel is under its origin); the
    whale's back is lowered to centre on its origin like the primitive's; the spout is re-based to its own foot
    because the game places and scales it on its own.
16. **With the flag on, a boat rebuilds when the look changes even on the same kit** (its colours come with the
    look now); with the flag off it rebuilds only when the kit changes, as before.
