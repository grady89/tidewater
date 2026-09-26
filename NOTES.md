# Tidewater notes

Decisions and findings that CLAUDE.md does not cover. Newest at the bottom of each section.

## Port decisions (session 1: reference scene in project structure)

- **Lighting is baked, not computed.** The study's time-of-day slider defaulted to `dusk = 0.15` (labelled "Noon" but
  the sun sits at 56° elevation, i.e. late morning). All sun/sky/fog/ambient values in `src/world/lighting.ts` are the
  study's NOON/DUSK palettes lerped by `k = 0.15^0.8 = 0.2192`. The shaders still declare a `dusk` uniform because they
  are ported verbatim; it is fed the constant `k`.
- **`src/world/lighting.ts` is an extra file** not in the CLAUDE.md layout. It holds the baked constants and the two
  Babylon lights that StandardMaterial props need. Terrain/water/sky shaders read the constants directly.
- **Terrain seed.** The study's hash had no seed. `TERRAIN_SEED` is mixed in as `Math.imul(seed, 0x27d4eb2f)` added to
  the lattice hash, so seed `0` reproduces the study's island exactly. Any other seed gives a different island.
- **Tide clock lives in `src/sim/tide.ts`**, not in `water.ts`. `water.ts` only moves the plane and sets uniforms.
  The clock starts at high tide (`phase = π/2`), as the study did. Wet-sand level starts at 0 and dries at
  `WET_SAND_DRY_RATE` (0.012 units/s), so the wet band trails a retreating tide by tens of seconds.
- **Decoration is `src/tempDecoration.ts`.** Study props (12 houses, nearest-neighbour walkways, 70 trees) using the
  study's own LCG with seed 7. Lanterns are unlit: the study's lamp term is `pow(max(0,(dusk-0.45)/0.55),1.5)` which
  is 0 at late morning. Delete the file once `build/pieces.ts` exists.
- **Post-processing kept from the study**: FXAA + bloom (threshold 0.9, weight 0.15, kernel 48, scale 0.5).
  Cut bloom first if integrated graphics can't hold 60 fps.
- **Dependency is `@babylonjs/core`** (ES modules), not the `babylonjs` UMD bundle the study loaded from a CDN.
  Named imports from the package barrel; no side-effect imports were needed for ShaderMaterial, RawTexture,
  ArcRotateCamera auto-rotation, or DefaultRenderingPipeline.
- **Dev server is on port 5180** (`vite.config.ts`, `strictPort`) because 5173 was held by another project's Vite.
- **`window.__tidewater`** exposes `{ engine, scene, tide }` in dev builds only, for console inspection and fps checks.
- Vite serves the study at `http://localhost:5180/reference/tidewater-study.html`, handy for A/B comparison.

## Things that did not port cleanly

- **Sky dome renders black below the horizon.** `skyFS` does `pow(clamp(d.y, -0.05, 1.0), 0.4)`; `pow` of a negative
  base is undefined in GLSL and comes out NaN (black) on this machine's GPU. It is only visible when the camera is far
  enough out that the water plane's edge is in view. The study has the same defect; shader left verbatim per the brief.
  Fix later by clamping `h` to `[0, 1]` (one-character change) once we decide to touch the shaders.

## v1 gameplay decisions (session 2)

- **Floor heights are absolute world Y** (house 1.0, walkway 0.95, pier 1.0), not terrain-relative. Terrain only
  sets stilt length. Reasoning: walkways must be level to read as connected, and the numbers come straight from
  the study where FLOOR was absolute. "Height derived from the cell's terrain" is taken to mean the stilts.
- **The cut rule is dormant at the shipped constants.** High tide is +0.60 and the lowest floor is 0.95, so nothing
  is ever cut in v1. The rule is implemented (`piece.floorY < tide.level`) and was verified by forcing the level to
  0.97: every walkway cuts, houses and piers don't, every house goes unreached. The 0.05 gap between walkway and
  house floors only matters if some tide exceeds 0.95 (storm tide, or a taller tide range). **Design call for the
  user**: raise TIDE_HI, add an occasional spring tide, or accept that v1 has no survival pressure.
- **Cell model**: cell (i, j) covers x in [i, i+1), z in [j, j+1); i, j in [-32, 32). Cells are classed by the
  terrain height at their centre: deep (< TIDE_LO), flat (TIDE_LO..TIDE_HI), high (> TIDE_HI). Houses and walkways
  go on flat cells only. Nothing can be built on high ground.
- **Pier placement**: anchored on a deep cell that touches a flat cell; the second cell extends directly away from
  that flat neighbour (seaward). No rotation control needed. A house directly adjacent to a pier counts as reached.
- **Right-click removes a piece.** Not in the brief, but a sandbox without removal is unplayable for testing shapes.
- **Reached feedback**: lanterns (`#ffb859`, emissive) light on reached houses. Nothing else changes visually.
  Cut pieces get no extra visual since they are under water anyway.
- **Score** is snapshotted on the frame the tide peaks (`TideClock.peaked`) and displayed until the next peak.
  The clock starts at high tide, so the first score arrives 80 s in.
- **Camera auto-rotation is off**: a drifting ghost under the cursor is unusable. Orbit + zoom only, no panning.
- **Extra files vs the CLAUDE.md layout**: `src/build/placement.ts` (pointer handling and ghost preview),
  `src/world/flatMesh.ts` (vertex-colour + merge helpers), `src/world/trees.ts` (kept from the decoration layer as
  world dressing; `tempDecoration.ts` is gone).
- **One draw call per piece.** Each piece merges its primitives into one vertex-coloured mesh sharing a single
  white StandardMaterial. Houses add one lantern mesh. A 20-piece town is ~26 meshes.
- **Picking** marches the camera ray against the analytic heightfield (`terrainHeight`) instead of picking the
  57k-triangle terrain mesh; 8 bisection steps after the first hit.

## Findings on the v1 questions

(placement and connectivity exist now; play a few cycles and write answers here)

## Performance (session 1)

- Scene: 291 meshes, 296 draw calls per frame, WebGL2 via ANGLE/D3D11 on an RTX 4060 Laptop GPU. One `scene.render()`
  costs ~2.8 ms of CPU.
- The Claude desktop app's embedded browser pane does not fire `requestAnimationFrame` unless it is on screen, and
  even when driven synchronously it shows a content-independent floor of ~33 ms/frame at 1920x1080: disabling bloom,
  FXAA, and the whole water plane changed nothing. The study benchmarks identically in the same pane, so the port is at
  parity. **Measured in Chrome: 165 fps** (RTX 4060 Laptop, full post-processing). Still untested on integrated
  graphics; if that falls short of 60, cut bloom first.
- Draw calls will drop a lot once the decoration layer is replaced: the study's props are ~290 unmerged meshes.
  Merging stilts/decks per house or instancing is the obvious first optimisation when real placement lands.
