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

### M5 production chain
- **Trees are ledger state.** `sim/trees.ts` generates the 70 sites deterministically (same LCG as the study, so
  the island looks the same); `state.trees[k]` is each site's age 0..1. Lumber camps fell the nearest grown trees
  within radius 7 (`LUMBER_TREES_PER_CYCLE` × staffing per cycle), felled trees regrow 1/6 per cycle, and the view
  scales two thin-instance meshes (trunks, canopies) by age. Trees are not obstacles.
- **Markets keep a food reserve** (`FOOD_RESERVE_CYCLES` × the town's per-cycle need, counting next cycle's
  immigrants) before selling. Without it the market sold every fish at the peak, immigration saw "no food" and the
  town froze at 6 residents — found while chasing the M5 check.
- Balance nudges for the 12-cycle check: `LUMBER_TREES_PER_CYCLE` 3→4, `SAWMILL_RATE` 10→12,
  `IMMIGRANTS_PER_CYCLE` 3→4. With those the scripted town launches its first shipyard boat at cycle 10.
- The shipyard only accrues progress when a harbour has a free slot *and* the boat's planks and money are on
  hand; a full pier silently stalls it (the scenario adds a second pier). Boats go to the nearest harbour with room.
- `floor: "ground"` kinds (lumber camp, sawmill) sit on the terrain (max(1.0, terrain + 0.05)) and get no stilts;
  hill tools pick against the heightfield instead of a deck plane. Lumber camps must touch a flat cell with a
  walkway (`needsWalkway`); tall houses need a sawmill somewhere (`requires`). Both reasons show in the build menu.
- Build menu is by category (tabs; Tab cycles, digits pick within the visible tab). Greyed buttons say why:
  "no money", "no planks", "needs sawmill".
- Scripted streets now raise any walkway that isn't safe at spring tide; otherwise the whole town idles every
  fourth cycle and no 12-cycle check can pass. That is the real design lesson: **the flats need raised walkways**.

### M6 pollution and the outfall
- **Fields** (`sim/fields.ts`) are plain `number[]` of 4096 so they save with the ledger. `stepDrift` does
  decay (per second), four-neighbour diffusion, and advection along a precomputed flow: each cell's uphill
  neighbour while the tide rises (shoreward), downhill while it falls (seaward). Pollution runs every tick;
  fish density settles once a cycle. Reuse `stepDrift` for shark risk and fire risk.
- Waste routing is a settlement step: untreated waste (residents × `WASTE_PER_RESIDENT`, minus the staffed
  fraction of a treatment plant within radius 12) is split across every outfall as per-tick emitters; smokehouses
  and busy piers/docks add their own. No outfall → `wasteBacklog` and a flat happiness penalty. Outfalls need no
  walkway link (sewers are assumed); everything else still does.
- Units: with waste 2/resident/cycle, diffusion 3 %/s per neighbour and decay 0.6 %/s, a 6-resident town's
  outfall cell settles near 1 and its neighbours near 0.4; the oyster kill threshold is 0.25 for 2 cycles. The
  first cut (0.5/resident, 12 %/s diffusion) spread the mass over dozens of cells in seconds and never fouled
  anything — diffusion is the sensitive knob.
- Fish density lives on deep cells (`FISH_CAP` 1). Boats now sail to the *richest* ground in range (ties:
  nearest), catch scales with the density there, and each trip thins that cell by 0.12 per boat; grounds regrow
  15 % of the gap per cycle toward `FISH_CAP × (1 − pollution)`. Boats hop between grounds as they thin, so
  "the ground" in checks means the thinnest deep cell.
- Happiness now subtracts pollution at home (÷ `POLLUTION_HAPPY_SCALE`) and the backlog penalty; the full
  formula is M7.
- Overlays are one 4096-quad mesh with per-vertex colour+alpha, refreshed every 6th frame while shown; quads
  sit at max(terrain + 0.08, 0.95) so deep water shows the layer above the surface. `__tidewater.setOverlay`.

### M7 happiness, services, leveling
- **Happiness** (`balance.HAPPY`): base 0.10 + fed 0.30 + jobs 0.30 + water 0.10 + leisure 0.12 + night 0.08, minus
  pollution at home (÷ 8, up to 0.5), minus the waste backlog penalty, minus injury/damage terms that M8/M10 will
  feed. A fed, employed home with no services sits at 0.7; fed but idle at 0.4 — so immigration (≥ 0.5) stops when
  there is no work, which is the intended brake.
- **Waste backlog accumulates.** With no outfall, each cycle's untreated waste piles up and costs 0.003 per unit
  (cap 0.3); an outfall drains 30 units a cycle on top of the current waste. The first version applied a flat
  −0.25 the moment a town existed, which held the starter town below the immigration bar forever. The scripted
  starter town now spends its last 40$ on an outfall.
- **Coverage fields**: one layer per `ServiceKind` (water, leisure, night, treatment, lifeguard, firewatch),
  rebuilt at every settlement from `BUILDINGS[kind].service` (radius, staffed fraction) and lantern posts (radius
  3). The treatment plant's coverage replaced the ad-hoc radius check in waste routing. Taverns pour 2 smoked
  goods a cycle; dry, they give half coverage.
- **Leveling**: a home at happiness ≥ 0.8 for 3 consecutive settlements grows a level (max 3): +1 resident of
  capacity per level (`grid.capacityOf`), a taller body, a window box at 2, a chimney and the blue-grey roof at 3.
  The view rebuilds a building's mesh when its `meshSignature` (kind, level, lantern) changes.
- **Lantern posts** are a flag on a walkway (`building.lantern`), placed with the "Lantern post" tool (8$) rather
  than occupying a cell. They light the night layer and glow at dusk like house lanterns.
- Market squares are links (walkers loiter there) and must touch the fish market (`touches` in the catalog).
- **Click to inspect**: a left click on an occupied cell that can't take the current tool opens the info panel
  (`ui/infoPanel.ts`): status line, residents/capacity, workers, boats, last output, coverage at home. Escape
  closes it. `__tidewater.select(i, j)` does the same for scripts.
- Scenario bug worth knowing: `placeByWalkway` used to try anchors offset by up to one cell regardless of
  footprint, so 1×1 buildings could land one cell *off* the street and stay unreached. It now bounds the offsets
  by the kind's footprint; scripts that need room call `growStreet` first.

### M8 beaches and sharks
- **Beaches are derived** in the Grid: high cells with terrain ≤ `BEACH_MAX_HEIGHT` (0.95, where the terrain
  shader is still sand) that touch a water cell (flat or deep). `cls: "beach"` is the lifeguard tower's class.
- **Daylight moved into the sim** (`sim/daylight.ts`); the view's `duskAt` re-exports it. A day is 2 tide
  cycles, so high water alternates day/night and people swim every other cycle.
- **Shark risk** is a field over water cells fed by staffed markets (8/cycle) and piers/docks with boats
  (4/boat/cycle), using the same `stepDrift` as pollution but tuned wide and thin (decay 0.003/s, diffusion
  8 %/s → e-folding ≈ 5 cells). The first tuning (0.008 / 5 %) gave a plume that died within 2 cells and never
  reached a beach. Nets zero their cell every tick; risk is zeroed on land.
- **Only open water counts**: a beach cell's swimmable water is its water neighbours with nothing built on them.
  Netted, pier'd or walkway'd cells aren't swum in and aren't read for risk, which is what makes "nets + lifeguard
  → 0 incidents" hold exactly.
- Incident roll at the end of each high-water shift: chance = risk beside the beach × swimmers there × 0.25 (×2 at
  night, ×0.2 under lifeguard coverage), capped 0.9, from the seeded RNG. A hit injures one resident of the
  fullest home in reach and sets `shock` on homes within 6 for 3 cycles (−0.2 happiness). Injured residents don't
  work; clinics heal 2 per cycle per staffed clinic, otherwise one per home every 6 cycles.
- Shark sources live in `state.sharkEmitters` (rebuilt at settlement) rather than a cache: a WeakMap cache keyed
  by state broke the JSON round-trip determinism test.
- View: swimmers are the walker figure bobbing in the open water beside each busy beach; fins are a thin-instance
  triangle circling the three riskiest water cells above 0.25. Shark-net floats sit at a fixed y (0.15); they
  look odd at spring low. Overlay "Sharks" shows the field.

### M9 trade and tourism
- **Trade state** lives in `state.trade`: `nextVisit` (cycle), `shipCycle` (the visit in progress or last),
  `plankOrder`, `visits`. A harbor schedules the first call for the next cycle; each call at that cycle's
  settlement buys all smoked goods (9$) and fish above the food reserve (5$), delivers as many ordered planks as the
  purse allows (3$ each), swaps the tourists, and books the next call 3 cycles on (2 with a reached lighthouse).
- **Tourists** are a count: up to 4 land per call into reached inns (6 beds each; unstaffed inns still offer half),
  spend 6$ per cycle (×0.4 without a tavern, bathhouse or beach) and sail with the next ship. Losing the harbor
  sends them home.
- **The ship is a view function**: through the visit's high water, `phaseProgress` drives it along the sea path
  from the map edge — in for the first 38 %, berthed on the first cell outside the harbor, out for the last 38 %.
  `seaEntry` prefers a map-edge cell at least 12 cells out by water so the run-in is watchable; the first cut used
  the nearest edge cell and the ship "moved" three cells.
- Harbor placement uses the catalog's terrain window (`max: -1.5`) on top of the deep class; the lighthouse gets a
  `highOrEdge` class (high cells, or the pier rule).
- `__tidewater.orderPlanks()` and the "Order 20 planks" button queue a delivery; the tide clock shows the ship's ETA.

### M10 fire
- **Fire risk** is a field like the others but with no tide advection and very little diffusion (0.5 %/s): the
  steady state per cell is roughly emission ÷ (120 × (decay + 4·diffuse)), so a staffed smokehouse (6/cycle over
  2 cells) settles near 0.8, two adjacent pass the ignition threshold of 1.0, three reach ~1.5. Taverns add 3,
  lantern posts 0.3 each. My first cut (2/cycle, 2 %/s diffusion) never got a cluster above 0.3 — diffusion is the
  knob that matters, as with pollution.
- **Ignition** rolls once a cycle per building: chance = 0.05 + 0.05 × (effective risk − 1), only above the
  threshold. A staffed fire watch cuts effective risk by 97 % within 8 cells, which keeps a watched cluster below
  the threshold entirely — that is what makes "with a fire watch it doesn't burn" a hard guarantee rather than
  a probability. Rain (M11 storms) will zero the field.
- **Burning** is per tick: 24 s of fire, and each second a 1.5 % chance to light every orthogonal neighbour
  (the first cut at 4 % chain-reacted down a whole street). At burn-out the building is damaged unless fire-watch
  coverage at its cell is ≥ 0.5, in which case it is "saved".
- **Damage** (`building.damaged`, shared with storms and the tsunami): `active()` = reached ∧ dry ∧ intact gates
  production, boats, services and sales. Repair costs 50 % of the build price plus 5 timber per 100$ and is paid
  automatically at settlement, oldest damage first; production in that same settlement has already run, so a
  repaired building works from the next cycle. Homes within 3 of damage lose 0.15 happiness.
- View: damaged buildings get the shared dark material and lean 5° about their footprint centre (pivot set on the
  merged mesh). Flames are self-lit cones and smoke is grey spheres, both thin instances over burning buildings.
- `__tidewater.ignite(i, j)` and `tickSeconds(s)` exist so a scenario can watch a fire between shifts.

### M11 storms and the tsunami
- **Water shader uniforms only.** `shaders/water.ts` keeps the study's wave line and adds `waveAmp` (multiplies
  the swell; 1 = the study) and a travelling Gaussian crest `waveHeight · exp(−((w·waveDir − waveFront)/waveWidth)²)`
  (height 0 = off). The fragment shader is untouched. `world/water.ts` exposes `setSwell` and `setCrest`.
- **Storm** (`sim/events.ts`): rolled at settlement after cycle 6, 12 % a cycle, never in consecutive cycles; lasts
  until the next peak. Boats don't sail, swimmers stay home, rain zeroes the fire field every tick, and at the
  storm's start each boat at an unsheltered pier/dock is lost with 50 % (a reached lighthouse saves them all).
  Shelter = a breakwater within 6 cells. The view eases a `stormMix` over 3 s: light blends toward the study's dusk
  palette and the swell triples.
- **Tsunami**: rolled after cycle 20, 5 % a cycle, 12-cycle cooldown. Drawdown: 20 s of `tide.override` ramping to
  −1.2 (boats heel on the mud through the existing mooring code). Wave: a front sweeps along the wave axis at 10
  u/s; every building it passes whose floor is under 1.4 and which has no sea wall or breakwater within 12 cells in
  front of it along the axis is damaged, and unsheltered boats are lost. Then 6 s of settling back to the clock's
  level. The wave axis points at the deepest map-edge cell.
- **Sea wall placement is "flat", not "shore".** The brief's shore class (flat cell touching high ground) is the
  landward edge of the flats; a wall there protects nothing on the flats. On the flats it is the line you build
  along the seaward edge, which is what "shields flats behind it" needs.
- Storms are the reason scripted towns now call `shelterHarbours` (breakwaters around every harbour) before
  counting boats, and skip a storm cycle before measuring sailings: two M4/M5 checks silently depended on calm
  weather. Forced events: `__tidewater.forceStorm()`, `forceTsunami()`.

### M12 camera, polish, saves, tutorial
- **Camera**: orbit/zoom stay Babylon's; panning is ours (`build/cameraControl.ts`) on middle-drag and WASD, in
  the camera's ground frame, clamped to the island plus a margin. Right-drag can't pan because right-click removes.
- **Speed**: pause / 1× / 2× / 4× buttons (space toggles pause) scale the frame time fed to the fixed-step
  accumulator; the ledger only ever sees whole `SIM_TICK`s.
- **Save slots**: three named slots in localStorage (`tidewater.slot.N` + `.meta`) beside the autosave; Load
  swaps the ledger through one `adopt()` that re-attaches the grid and clears every per-building view. "New town"
  confirms, clears the autosave and resets the tutorial. Esc opens the menu (or closes the info panel first).
- **Tutorial** (`ui/tutorial.ts`): five steps, each clearing itself from ledger facts (pier, boat, reached hut,
  market, 3 cycles + 4 residents); progress in localStorage because it is UI state. After it, the same line shows
  the empty-state hint for whatever the town lacks most (no pier, no boats, no market, waste piling up, no well).
- **Performance**: the 300-building / 30-boat / 200-walker town runs at 165 fps headless on the RTX 4060 and a
  saved one loads in ~0.6 s, so the per-chunk static merge from the roadmap was **not** done — the target holds
  without it and every repeated prop (trees, walkers, boats, fins, flames, smoke, overlay) is already instanced or
  one mesh. Lantern spheres remain one small mesh per lit building. Revisit on integrated graphics.
- The island's flats hold about 160 jobs; the 200-walker figure is reached with `__tidewater.stressWalkers(n)`,
  which spawns extra walkers on existing routes in the view only. The 300 buildings are padded with breakwater
  cells (real ledger entries, real meshes) once the flats are full.

### M13 audio
- `view/audio.ts`, Web Audio only: a 2 s seeded-noise loop through a low-pass is the surf (gain 0.04 + 0.08 ×
  tide + 0.25 × storm; cutoff 350 → 1650 Hz), a 46 Hz sine with a slow frequency wobble is the tsunami thrum (up
  during drawdown, louder for the wave), and a shift change rings two decaying sines (660 + 990 Hz). No samples.
- The context is created on the first pointerdown/keydown anywhere and resumed if suspended; until then nothing
  exists (`view.audio().started` is false), which is what browsers' autoplay rules need. Mute is a master gain
  ramp and is remembered in localStorage.

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
