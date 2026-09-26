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

## Overnight build (brief v2 / ROADMAP)

### M0 harness
- `npm run test` = vitest over `test/sim.test.ts`; a hygiene test greps `src/sim/**` for `@babylonjs` and for imports
  from view/world/build/ui, so the ledger can't grow a Babylon dependency silently.
- `npm run smoke` = `node test/smoke.ts` (Node 24 strips types natively, so no tsx). It starts Vite in-process on
  port 5181, drives headless Chrome (`channel: "chrome"`, the installed browser; no Playwright download) and writes
  `shots/m*.png`. `--ignore-gpu-blocklist` makes headless use the real GPU; without it Chrome falls back to
  SwiftShader (15 fps, meaningless). fps in the run log are measured this way.
- Type-only imports in `test/smoke.ts` must be `import type` — Node's type stripping doesn't elide them otherwise.

### M1 ledger
- `SimState` is one plain object (`src/sim/state.ts`): tide, pieces keyed by id, nextPieceId, score, rng, time,
  tick. `Grid` is an index over it (terrain classes + occupancy) rebuilt from `state.pieces`; `grid.attach(state)`
  repoints it after a load. Save = `JSON.stringify(state)`.
- `TIDE_PERIOD` is now 120 game seconds (brief v2); `SIM_TICK` = 1/20 s. The render loop accumulates frame time
  and runs whole ticks; `advance(cycles)` runs ticks until that many more high tides have passed (counting ticks
  instead left the phase a float below the peak and skipped the score snapshot).
- Autosave writes on every high-tide tick and on `__tidewater.save()`. Load on start if `tidewater.autosave`
  exists in localStorage; `__tidewater.newTown()` clears it. The smoke scenario calls `newTown()` first so a stale
  autosave can't leak between runs.
- View (`src/view/pieceViews.ts`) syncs meshes to `state.pieces` every frame: create for new ids, dispose for gone
  ids, lantern material from `reached`. Placement no longer owns meshes.
- `TideClock` class became functions over `state.tide` so the tide is serializable like everything else.

### M2 money loop
- Catalog lives in `src/sim/balance.ts` (`BUILDINGS`), with footprint, placement class, cost, jobs, residents,
  upkeep, floor height and a `network` role: **root** (piers; later docks) seeds connectivity, **link** (walkways,
  markets) passes it on, **leaf** (homes, most producers) only receives it. A market is a link, not a root, so
  cutting its walkway disconnects it and sales stop — the brief's "connected to a market or dock" reading.
- `economy.tryPlace(state, grid, kind, anchor)` is the one validate → pay → place path; placement, tests and the
  smoke scenario all go through it. `Placement.evaluate` only produces the ghost's blocker text.
- Cycle settlement runs at the high-tide peak: assign workers → residents eat → taxes → market sells what's left
  → upkeep → immigration (then workers re-assigned so newcomers work at once). Boats sail on entering high water
  and land their catch on leaving it, so a catch is sold at the *next* peak. Income lags a cycle; the starter town
  still nets ~+95$ over 4 cycles from 0$.
- Workers: nearest-first over the walkway graph using a per-workplace BFS distance field (`network.distanceField`,
  a 64×64 Int32Array — the grid-field mechanism). Ties break by id so assignment is deterministic.
- Happiness (M2 stub) = ½ fed + ½ employed per house, averaged; 1 with no residents so the first settlers come.
  Immigration: up to 3 per cycle into reached homes with room while food > 0 and happiness ≥ 0.5.
- Boats are a count on the pier (`building.boats`), crew = 2 per boat as pier jobs. Only the first two boats are
  purchasable (`PURCHASABLE_BOATS`); the "Boat" tool is clicked onto a pier.
- Save format bumped to `version: 2`; older autosaves are discarded on load (returns null → new town).
- `__tidewater.grant(money)` exists for scripted scenarios that need more than the 500$ start.

### M3 tide splits the economy
- **Tide shape**: each half-cycle eases (cosine) from the previous extreme to the next; a spring cycle k
  (`k % 4 === 0`) has trough `SPRING_LO` *before* its peak `SPRING_HI`, so the water is continuous through it.
  `tide.cycle` counts peaks; `troughLevel(k)` is the trough that precedes peak k.
- **Standard walkways stand `STILT_LENGTH` (0.5) above their cell** (`floor: "stilts"` in the catalog). Since
  settlement, immigration and worker assignment happen at the peak, a walkway on terrain < 0.1 is under water
  at every settlement and its street is dead; terrain 0.1–0.35 dies only at spring peaks. That is the game: the
  shoreline flats need raised walkways (12$, fixed 1.2). The ghost tints by fate (green safe, amber spring, red
  every tide, grey blocked) and the hint says why.
- **The starting hut is placed by the sim** (`sim/start.ts`, `newGame`) on flat ground 0.36–0.58 nearest the
  island centre: high enough that standard walkways around it never flood. The scripted starter town builds
  from the free hut: pier nearest it (penalising shore cells below 0.1), walkways greedily toward the hut using
  raised where a standard one would flood every tide, then 2 huts and a market. 500$ covers it with ~50$ left.
- **Roots vs links**: piers and docks are roots. A dock in open water is "reached" by definition; it needs a
  raised walkway (allowed on flat *or* deep cells) or a touching pier for crews to get there. I did not enforce the
  brief's "must touch a walkway via raised walkway or pier" at placement; an unreachable dock just never staffs.
- **Shifts**: high water and low water are shifts. `shiftStart` on entering a phase (boats out from piers at high,
  from docks at high *and* low), `shiftEnd` on leaving it (catch lands; oyster beds and clam camps deliver
  shellfish at the end of low water). Spring low (level ≤ −0.5) doubles shellfish. Clam camps count exposed,
  unbuilt flat cells within radius 6 above the current water level.
- Oyster beds have a terrain window 0.0–0.45 (`terrain` in the catalog) on top of the flat class.
- The smoke scenario imports `test/scenario.ts` into the page through the Vite dev server instead of duplicating
  the script; the unit tests import it directly.

### M4 the town looks alive
- **Boats are a pure function of ledger + view time.** The sim stores per harbour `boats`, `atSea` and the chosen
  `ground` (deepest reachable deep cell 5–14 cells out by water; M6 swaps "deepest" for "richest"). The view
  derives a position from `phaseProgress` (0..1 across the current high/low shift, solved numerically on the eased
  tide) and the BFS sea path: out for the first 30 %, drifting on the ground, back for the last 30 %. Moored
  boats float on the shader's wave function (`waveHeight` in `world/water.ts`, kept in step with the vertex
  shader) or heel 24° on the mud when the water is more than a boat's draft below the mooring. Nothing in the
  boat code writes to the sim, and `advance()` jumps land the boats exactly where they belong.
- Hulls and sails are two thin-instance meshes (per-instance colour on hulls via the `color` thin-instance
  buffer): two draw calls for every boat in the world.
- **Walkers** are one thin-instance figure (body, head, hat) with per-instance colour. On every shift change the
  view spawns one walker per assigned worker (home → work on entering a shift, back on leaving; capped at
  `MAX_WALKERS` = 200, sampled beyond) and walks it over a BFS route on reached, un-cut links at 1.6 cells/s.
  Three loiterers circle each staffed market. Routes and RNG live in the view (an LCG, not `Math.random`, so
  screenshots are repeatable; it still touches no sim number).
- **Day/night** is `duskAt(sim time)`: late morning (0.15) at the start of each `DAY_CYCLES`-long day, full dusk
  half a day later, cosine in between. `computeLighting(dusk)` is the study's NOON/DUSK lerp; terrain, water and
  sky get the values as the uniforms they already had. Lantern emissive follows the study's lamp curve.
- The smoke can't buy more than two boats (that's the rule), so M4 sets `boats` on a second pier and a dock in
  the ledger directly and notes it; the shipyard makes this legitimate in M5. A dock only gets crew after the
  nearer pier and market fill, so the scenario grows the town to ~14 residents first.
- `__tidewater.advanceTo(fraction)` ticks to the next time the clock passes a cycle fraction; views only see the
  final state, so a scenario that wants a shift-change wave steps through slack water first.

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
