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

### Backlog 1 reflections
- A Babylon `MirrorTexture` (1024², plane = the water level, refreshed each frame while on) renders every mesh but
  the water, the overlay quad and the placement ghost. It sits in `scene.customRenderTargets` only while the
  toggle is on, so off costs nothing; the sampler stays bound so the shader never sees an empty unit.
- The water fragment shader samples it at the fragment's own clip position (Babylon's mirror reflects the world
  through the plane and keeps the camera, so a point on the plane lands on the same pixel), nudged by the facet
  normal for a broken edge, and mixes it into the sky the fresnel term already reflects (`reflectMix`, and the
  fresnel share rises 0.55 → 0.7). `reflectMix = 0` is bit-for-bit the study; no other line of the shader moved.
- The toggle lives on the speed bar ("Reflections"), is remembered in localStorage, and is off by default: it is a
  second render of the scene. First measurement in the 300-building town (headless 4060, 165 fps off): 62.5 fps on
  at 1024², 62.5 at 512² — so the cost was draw submission (311 meshes), not fill. That forced the chunk merge
  below; with it the mirror renders every frame at the 165 fps cap. Walkers, lantern spheres, fins, flames and
  smoke are left out of the mirror. `__tidewater.setReflections(on)`.

### Backlog 2 caustics
- One additive line in the water fragment shader, after foam: two drifting `vnoise` layers (scales 2.6 and 4.3
  per unit, opposite drifts) summed, `smoothstep(0.5, 0.85)` then squared into a web, masked to depths 0.03–1.6
  (nothing on the shoreline foam, nothing in the deep), × `caustics` × 1.1. The strength looks high because the
  shallow water's alpha is 0.34: the terrain below carries most of the pixel, so the web reaches the eye at a
  third of its value.
- `caustics` is set with the lighting as `1 − k` (no sun at dusk or in a storm) and `water.setCaustics(false)`
  zeroes it. Smoke A/Bs the mean brightness of the viewport centre over a beach at high water
  (`__tidewater.brightness(x, y, w, h)` reads pixels in the next rendered frame) and expects on > off; the
  measured delta is ~1 of 255 because the sample includes sand and glint, hence the 0.5 threshold.

### Backlog 3 gulls and crabs
- `view/wildlife.ts`, two thin-instanced meshes, matrices rebuilt every frame from the ledger; nothing is stored.
- Gulls circle every harbour (pier, dock, harbor) that has boats: 2 + 1 per boat, at most 5 each and 48 in all,
  on staggered radii and heights above the deck, alternating direction, with a wing flap from a rotation about
  the body axis. Harbours without boats get none — a gull flock reads as "there is fishing here".
- Crabs: up to 64 seeded sites on unbuilt flat cells within 4 cells of any building (re-picked when the building
  set changes, so a fresh town gets crabs where the player looks). A crab shows when its cell's terrain is above
  the water, popping up over the first 8 cm of exposure and scuttling sideways in place; at +0.6 every flat cell is
  under water, so high tide has none and the smoke asserts exactly that, and > 0 at low water.

### Backlog 4 roof variety
- Homes (hut, house, tall house) draw one of three roofs — the pyramid the game had, a gable (a 3-sided cylinder
  on its side, apex up, ridge along x or z), and a low hip with a ridge cap — chosen by a hash of the building id
  and its level. The id is the per-placement seed the brief asked for (it comes off the ledger's counter, so a
  saved town keeps its roofs); the level is in the hash so a level-up may change the shape along with the colour.
  The ledger stores nothing new. `__tidewater.view.roofs()` counts shapes over homes; the big-town smoke asserts
  all three appear.

### Backlog 5 districts
- "Name a cluster" read the simple way: a district is a connected cluster of buildings (orthogonal adjacency
  through any building, walkways included) with at least 3 members, computed on demand from the ledger
  (`sim/districts.ts`), nothing stored. Its name is hashed from the lowest building id in the cluster — the oldest
  building — from a 12 × 8 word list ("Herring Quay", "Gull Reach"…), so it survives saves and stays while that
  building stands; removing the oldest building renames the district, which is accepted rather than adding a
  districts table to the state. Players don't name districts; the brief didn't ask and the UI has no text input.
- Stats (buildings, residents / capacity, workers / jobs, boats, mean happiness of lived-in homes) show at the
  bottom of the info panel for whatever is clicked; clusters under 3 read "Outlying". The BFS runs each frame the
  panel is open, over at most a few hundred buildings.

### Backlog 6 second island
- The world stays one 64 × 64 grid; the isle is blended into the heightfield (`sim/isle.ts`: centre (22.5, 22.5),
  radius 8.5, in the deep water off the south-east where the class map was all deep) as a dome — a small high knob
  at the centre, flats most of the way out, deep at the rim — with the blend weight fading over the outer 18 % so
  there is no seam. The main island's heights are untouched: the sim test counts 750 non-deep cells off the isle,
  the number the map had before, and checks the start hut and every tree site stay off it (the dome tops out at
  0.85, under the 1.3 tree line, by design).
- "Unlock via harbor": `grid.canPlace` refuses any footprint touching the isle's circle until the town has a
  harbor (`grid.isleOpen()`), the ghost says "Across the water: a harbor's ferry opens the isle", and the first
  harbor placed notifies "The ferry runs…". Nothing is stored; a loaded town with a harbor is open.
- The ferry is view only (`view/ferry.ts`): a small steamer on a 70 s timetable along the sea BFS route from the
  harbor to the isle's nearest shore cell, out / landed / back / berthed. It carries nobody in the ledger: the
  isle's settlement stands on its own pier (piers are network roots), so its walkways, homes and jobs work as a
  second town sharing the same money, food and immigration. Workers do not cross — the walkway graph has no edge
  over the water — which keeps `distanceField` and the storm/tsunami rules exactly as they were.
- `scenario.settleIsle` builds the first foothold (pier on the isle's shore, raised walkways toward the centre,
  huts alongside); the smoke asserts the lock, the unlock, the settlement and a running ferry, and shoots
  `shots/b6-isle.png`.

### Backlog 7 achievements
- Nine milestones in `sim/achievements.ts` (first boat, first catch, first trade, fifty and a hundred residents,
  a level-3 home, a storm weathered, a lighthouse, the first building on the isle), each a predicate over the
  ledger. `checkAchievements` runs once a second of sim time from `tick`; a new one is pushed onto
  `state.achievements` (so the order is the order won and a save keeps it) and logged with a ★.
- The save version stays 2: `deserialize` fills a missing `achievements` with `[]` for saves from before this.
- The popup (`ui/achievements.ts`, `#achievement`) shows the newest id for 6 s of view time; adopting a loaded
  town marks its list as seen so nothing replays. Scripted jumps (`advance`) push view time past the 6 s, which is
  why the smoke checks the popup right after a one-second tick.

### Save shape check (found in the first hands-on run)
- The user's browser held an autosave written by an early overnight build — version 2, but from before `storm`
  existed — and `deserialize` only checked the version, so the first frame died on `state.storm.active` with a
  blank scene and a zeroed HUD. `deserialize` now throws when any top-level key of `createState()` (or any of
  `fields`) is missing, the autosave path already fell back to a new town on a throw, and a slot load now
  notifies instead of crashing. Lesson for the next field added to the state: either fill it in `deserialize`
  (as `achievements` is) or accept that older saves are discarded.

### Camera rework and two HUD bugs (first hands-on feedback)
- The camera is now modelled on Cities: Skylines rather than Babylon's ArcRotate defaults, which had left-drag
  orbiting (fighting placement), wheel zooming toward the target rather than the cursor, no smoothing and no
  keyboard rotation. `build/cameraControl.ts` clears Babylon's camera inputs and owns everything: left/middle
  drag grabs the ground (the grabbed point stays under the cursor — exact, not eased), right-drag yaws and
  tilts, the wheel dollies toward the ground point under the cursor, W A S D / arrows pan in the view frame at a
  speed proportional to distance, Q/E turn, R/F zoom, Home frames the town. Every input sets a goal the camera
  eases toward (12/s); pitch follows a log curve of distance (1.18 rad from the up axis at 6 units, 0.5 at 110)
  plus the player's tilt, and is steepened if the eye would dip under the terrain or the water. Right-click
  without a drag still removes (placement's slop check). Edge scrolling stays off per the brief.
- Tabs could not be changed: `hud.update` re-selected the active tool's category every frame, so a click held for
  one frame. It now follows the tool only when the tool changes.
- Palette cards bled past the panel: `1fr` grid columns don't shrink below their content; `minmax(0, 1fr)` with
  `min-width: 0` on the buttons fixes it, and the overlay row wraps.
- Smoke now clicks the Homes tab, checks no HUD button extends past the panel, and drives the camera with real
  wheel/drag/key events (zoom keeps the point under the cursor within 1.5 units, right-drag removes nothing).

### Placement rework (second hands-on feedback: seams, topography, docks, crabs, a stuck start)
What other builders do and what was taken from each:
- **Autotiled roads** (SimCity, Banished, Anno): a road tile's mesh depends on its neighbours, so a street is one
  surface. `view/buildings.ts › streetDeck`: a walkway's slab runs to the cell edge on every side that meets a
  deck (the neighbour does the same, so the seam vanishes), a low kerb closes open sides, and `meshSignature`
  carries the join key so placing a piece rebuilds its neighbours' chunk too.
- **Terrain conforming** (Cities: Skylines flattens under buildings and grades roads; Timberborn steps in
  levels): a stilt town has a cleaner answer — level runs. `grid.floorFor` for "stilts" pieces rises to the
  highest neighbouring deck within `WALKWAY_SNAP` (0.4) so a street laid over uneven flats stays flat, never
  drops below the cell's own stilt height (that would flood it), and where a neighbour is higher than the snap a
  two-step stair is drawn up to it. Raising a deck only ever improves its flood fate.
- **Drag to lay roads** (all of them): click-drag with a walkway, raised walkway, breakwater, net or sea wall
  draws an L-shaped run (longer axis first, ≤ 40 cells); the ghost shows each cell green or grey, the hint prices
  the run, release lays it in order so each deck meets the last. The camera's left-drag grab is off while a line
  tool is selected (`cameraControl.leftDrag`) — CS keeps panning on the middle button for the same reason.
- **"Needs road access"** (CS greys the building and says so): the deep dock now requires touching a pier or a
  raised walkway at placement (`needsLink`), with the reason in the ghost hint, because a dock dropped in open
  water was unreachable and the player couldn't tell why. Raised walkways were already the bridge piece (class
  flatOrDeep); the catalog now says so.
- **Connectivity preview** (CS's "not connected" icon): a placeable piece that touches nothing on the network
  shows an amber caution ("Not joined to the town yet…") rather than being refused — a street can be started
  from either end.
- **Demolish refund** (CS, Anno): right-click removal returns `REMOVE_REFUND` (50 %) of the money cost. This is
  the way out of the soft-lock the first playtest hit: 500$ spent on walkways and homes with no pier means no
  fish, no food, no residents and no income. `Tutorial.stuck` also says exactly that when there is no pier and
  less than a pier's price.
- **Highlighted first site** (the brief's "pier suggestion highlighted"): `sim/start.ts › suggestPier` picks the
  deep cell that takes a pier nearest the homes; `view/marker.ts` pulses a ring there until any harbour exists.
- Crabs: 22 sites instead of 64, and they now sit still and dart sideways in short bouts (`CRAB_BOUT` 3.2 s,
  `CRAB_MOVE` 0.35 s) between seeded resting spots, facing across their dart, instead of sliding in circles.
- Why people weren't coming in that playtest: immigration needs a home *reached* from a pier (walkway path to a
  pier with a boat) and food in stock; the seed money is 500$ and it had all gone on unconnected pieces.

### Third hands-on feedback: horizon artifacts, stairs, deck height, walkthrough
- The "water artifacts when the tide goes down" were the study's sky bug seen twice: `skyFS` clamped d.y to
  −0.05 and `pow` of a negative gave a black band just under the horizon; with reflections on, the mirror painted
  that band across the sea as dark streaks along the wave facets. One number changed in the shader (clamp floor
  0.0) — the first deliberate edit to settled shader math, recorded here for that reason.
- Stairs were backwards (the top tread sat away from the higher deck) and then floated. They are now a solid
  flight: n = ⌈dh / 0.13⌉ treads (≥ 2), each a block from the lower deck up to its own height and out to the
  shared edge, alternating plank/wood, so the top tread meets the higher floor and the flight is a wedge.
- Deck height is now the player's: with a walkway selected, `]` / `[` lift the deck in `LIFT_STEP` (0.2 m) steps
  up to `LIFT_MAX` (4) for `LIFT_COST` (2$) a step; the ghost, the fate tint, the hint and the drag-run price all
  follow. It sits on top of the neighbour snap (`floorFor(kind, cells, lift)`) and `tryPlace` charges for it.
  This is the tide game's real lever — the question "how high?" was already the whole design, so it deserved a key.
  Kinds with a fixed floor ignore the lift; `placeCost` is the one place that knows the price.
- The walkthrough is a card (step N of 6, title, instruction, a Skip button — the old banner skipped on any
  click, which is how the first playtest lost it), each step points at its tab and tool and the HUD pulses them,
  and the pier ring carries a DOM label "Pier goes here" pinned via `screenOf`. Steps clear themselves as before.

### Fourth hands-on feedback: far-water streaks, one plane, paths onto the hill, references
- The far-water streaks and the dark band at the horizon came from the mirror, two ways. (1) Babylon's mirror
  clips geometry under the plane with `scene.clipPlane`, which StandardMaterials honour and our custom terrain
  shader ignored — so the *seabed* was reflected up across the sea as dark slopes. The terrain shader gained a
  `clipY` uniform and one `discard` line, set to the water level only during the mirror pass
  (`water.mirror.onBefore/AfterRenderObservable`). (2) The reflection is sampled at the fragment's screen
  position plus a facet nudge; at the screen's top edge that wrapped round to the bottom of the mirror texture
  (dark water) and painted a band at the horizon. The mirror now clamps.
- "Why is it so hard to get things on one plane": the snap window was 0.4, so a walkway beside a raised one
  (1.2 vs ~0.9) stepped instead of joining. `WALKWAY_SNAP` is 1.2 now — a stilt deck always rises to meet its
  highest neighbour (longer stilts) and never drops below its own stilts, so runs are level on the way down and
  climb by a stair only where the ground itself rises past the deck. Existing decks keep their placed height.
- Onto the island: a **Path** (2$, Streets tab, class high, floor "terrain" = ground + 0.05, network link) — a
  slab the colour of wet sand joined like a deck, with stairs where it meets a higher deck. `touchesWalkway`
  accepts paths, so lumber camps and the like can hang off a path on the hill. Homes (hut, house, tall house) may
  now stand on the hill too: a numeric floor is `max(f, ground + 0.05)`, so nothing sinks into a slope and a home
  on the flats keeps its 1.0 deck. Paths and hill homes above 0.85 never flood; between 0.6 and 0.85 a spring
  tide cuts them, which is the game.
- People and boats rebuilt from `reference/people` and `reference/boat` (Grady's Midjourney refs from prompts I
  wrote — that is the intended workflow for most assets from here): the figure is a wide 8-sided straw hat over
  a round head, a six-sided tunic flaring to the hem with stub sleeves (white vertices, so the per-instance
  colour dresses it) over dark trousers and bare feet, split into a coloured mesh and a fixed-colour mesh that
  share one matrix buffer. The boat is a hexagonal prism stretched 2.4× along x (six flat facets, pointed at both
  ends) with a dark waterline band, pale gunwale, open cockpit, two thwarts, a net, mast, boom and a tall
  triangular sail; only the upper hull takes the instance colour.
- Boats clipped through decks because a trip's route started on the harbour's own cell; a trip now starts at the
  boat's mooring and joins the route at its first cell outside the harbour, and moorings skip cells with
  anything built on them (a walkway laid alongside the pier used to get a boat parked inside it).
- Swimmers stood in the sand: they now pick the deepest water cell beside the beach, only where it is 0.3 deep,
  and never sit below the ground.

### The art pass from reference/ (every asset rebuilt from Grady's Midjourney sheets)
- `view/buildings.ts` was rewritten around a small kit read off the sheets: `gable` (a 3-sided prism scaled to a
  rise, with a ridge beam), `hip` (a 4-sided frustum with a cap), `window_` (dark glass, a sill, blue shutters),
  `door` (blue panel with a lintel), `railing`, `chimney`, `crate`, `barrel`, `bollard` (blue with a red cap on
  the dock), `bracketLantern` (the arm-hung lantern on every house, tavern, well, shrine), `postLantern`, `net`,
  `rock` (a squashed icosahedron), `logPile` (red-cut ends with bark). Decks gained posts along their sides and
  an under-rail. Two hexes were added to the palette for what the sheets needed and nothing covered: pale quay
  stone `#b9b6ae` and window glass `#2b3a45`; the doors and shutters use the existing hull blue `#2f6f8f`.
- Homes: hut = one small room with a bracket lantern; house = wider cottage with shutters and (level 2) a window
  box; tall house = narrow tower with a balcony on posts and upper windows; level 3 adds a chimney. Roof shapes
  are still seeded per placement. Plank lines are two thin pale bands on the wall.
- Market = six posts under a wide blue gable with red trim, a blue plank back wall, a white counter with fish
  laid out, nets hanging, crates, a barrel, a signboard. Dock = tall piles with blue-painted feet, red-capped
  bollards, a dockmaster's hut, a crane, a ladder. Harbor = a stone quay with a white two-storey harbour house,
  red roofs, a crane, bollards, barrels, a lamp post. Shipyard = a slipway ramp, a blue hull on a cradle, a
  workshop with blue doors, a crane, timber. Lighthouse = a tapered white tower with a red band, a glazed lamp
  room with a blue cap and gallery rail, a keeper's hut, on rock. Breakwater = heaped blue-grey rocks. Sea wall
  = stone footing under a blue plank face with a plank cap. Shark net = a red buoy on a post and a rope of
  red-and-white floats. Production sheet: smokehouse (white shed, red roof, tall brick chimney), sawmill (open
  shed, blue roof, big blade, logs, a boulder), net loft (blue roof, nets on the wall, a red rope coil),
  warehouse (barn with plank bands, double doors, crates). Services sheet: well (stone ring, A-frame, windlass,
  bucket, lantern), clinic (two-storey, red cross sign on the lean-to), fire watch (X-braced tower, cabin,
  hipped red roof, bell beneath), treatment plant (shed, two polyhedron tanks, blue pipes), lifeguard (tall stilt
  tower, blue band cabin, ladder, red flag). Leisure sheet: bathhouse (shingle roof, two chimneys, round pool),
  tavern (tall narrow, blue roof, red lean-to, hanging sign), shrine (red pillar on stone steps, crossbar with
  streamers, little roof), market square (flagstones, bench under a red awning, flower tub, basin), inn
  (two-storey, blue roof, balcony on posts, lantern by the door).
- Trees: three stacked tiers per conifer, darker toward the ground, on a taller tapered trunk. Gulls: a tapered
  body, head, orange beak, wedge tail, red legs, and two wing meshes hinged at the shoulder that beat in bursts
  (clipped sine, gliding between). Crabs: a rounded shell, claws held forward, six angled legs, eye stalks. Trade
  ship: blue double-ended hull with a pale sheer line, bowsprit, two masts with booms and furled sails, a jib,
  crates. Ferry: red hull, white sheer, white wheelhouse under a red roof, funnel, stern lantern.
- Everything stays one merged mesh per building (chunk-merged in the view) or a thin-instance set; the big town
  still runs at the cap. A gallery script was used to shoot every kind three at a time from a low angle and
  compare against the sheets before committing.

### Fifth hands-on feedback: trails, painting, camera keys, people, activity, land tools
- Paths are now narrow dirt trails (half a cell wide) that drape over the *rendered* terrain: `world/terrain.ts`
  keeps the un-flattened height grid and exposes `heightAt(x, z)`, which interpolates on the same triangles the
  mesh draws (Babylon's ground splits each quad on the low-x/high-z → high-x/low-z diagonal), so a strip laid
  0.05 above it never cuts a slope the way sampling the analytic heightfield did. Every view factory reads
  ground height through `view/ground.ts` (a swappable sampler) rather than the heightfield directly.
- Dragging a street tool paints along the pointer's track cell by cell (each pointer step adds the L from the
  last painted cell, revisits skipped, 40-cell cap) instead of one L from the start.
- A/D and the arrows were mirrored: the camera's right vector was forward × up instead of up × forward.
- Walkers keep their post: a worker arriving at work stands there (turning, shifting weight) until the shift
  ends and the homeward wave replaces them; homecomers shrink indoors over 0.5 s instead of popping. Loiterers
  stand, step to a seeded spot, stand again — no more gliding circles. `PERSON_SCALE` 0.62 (a person ≈ 0.37 of a
  cell; Cities: Skylines is ≈ 0.22 — still a touch large on purpose, for readability from the default camera).
- Swimmers: the ledger counts them per beach cell for shark risk; the view now shows at most SWIM_FRACTION of
  the population in total, spread over beaches with knee-deep water, in the water. The old draw-all put a line
  of figures along the whole shore.
- Activity cues: `BOAT_MIN_RANGE` 5 → 7 so boats visibly leave; a line of red net floats trails a boat while it
  is on its ground; a working smokehouse puffs from the chimney; the pier's info line says how far out its boats
  are fishing; a market that sold nothing at the peak while fish sat above the reserve now says why (under
  water at the peak / no walkway to a pier / no workers) — the first playtest had exactly that puzzle.
- Land tools (Land tab): **Landfill** (45$ + 4 timber) raises one flat cell to `LANDFILL_HEIGHT` 0.9 — dry at
  every tide, still below the hill — recorded in `state.landfill` and re-applied by `Grid.attach`; the terrain
  mesh's height grid is raised inside the cell (one grid step of skirt) and the water's heightmap updated, so
  the sea discards there. Priced so it is a decision: the game is about building against the tide, and fill is
  the one deliberate way to move its edge. Raising and lowering terrain freely was rejected for that reason.
  **Plant tree** (3$) adds a site to `state.extraTrees` (ages line up in `state.trees` after the fixed sites)
  that grows like a felled tree regrows; **Clear tree** sets the age to −1 (never regrows) and pays a timber for
  a grown one. Lumber camps see planted trees. Saves from before get empty lists.

### Sun and moon, ambient audio, porters, loans, seed money
- The sun now arcs: `sim/daylight.ts › sunVector(d)` is a great circle from the east horizon at the day's start
  (d = 0, dawn) through the study's late-morning direction at d = 0.25 (so noon *is* the settled look) to the
  west horizon at d = 0.5, under the world at night; the moon is its antipode. `computeLighting(dusk, day)`
  lights the scene from the sun while it is up and from the moon (cool, 0.35 intensity, rising with it) once the
  sun is under; both are dim near the horizon so the hand-over is between two faint states. The sky shader
  gained `moonDir/moon/night` and two additive terms — a moon disc with a halo, and a hashed star field that
  fades toward the horizon; the sun disc uses the true sun, the terrain/water/props the current light. The
  palette lerp (`dusk`) is unchanged for the sunset; past it a `night` factor (dusk > 0.6 and the sun under)
  pulls the zenith, horizon and fog toward a deep blue-black and dims both ambients by 62 %, so midnight reads
  as night (stars, lanterns, moonlit water) rather than a long sunset. All of that is uniform values; the
  shader colour math is the study's. Consequence: a new town starts at dawn (orange light, sun on the horizon)
  and reaches noon a minute in.
- Ambient audio (`view/audio.ts`): a pad (root + fifth in detuned triangle pairs, a sine voice gliding through a
  pentatonic set every 6–14 s, low-passed, breathing on a 0.07 Hz LFO, a little fuller at dusk and dawn, ducked
  under a storm); gull cries (a sawtooth swept down through a band-pass with a 28 Hz tremolo, a second shorter
  yelp 70 % of the time) every 4–14 s while gulls are up, more often with more of them, never at night; and
  hammering (a filtered noise tick with a woody knock) twice a second while a shipyard has a boat on the ways.
  Still no samples. `__tidewater.audioCry()` and `view.audio().cries/hammers` for checks.
- Porters: when a harbour's boats land (atSea true → false, seen by the view), up to four figures carrying a
  basket (a third thin-instanced mesh sharing the walkers' matrices) walk the street from the pier to the first
  working market and go in. The catch is the game's income; now you see it arrive. `view.porters()`.
- Loans (`sim/loan.ts`): one at a time, 300$ now, 360$ back at 24$ per settlement over 15 tides (Cities:
  Skylines-style instalments rather than SimCity bonds; Anno and Banished have neither). The button sits under
  the ledger; the HUD shows what is owed; the "stuck" hint offers it. It is the way out of the first playtest's
  soft-lock without a reset, and priced so it is not free money.
- Seed money 500 → 650$: the scripted starter town ended with ~4$ from 500, which is exact for a script and
  cruel for a first player. 650 leaves ~150$ of slack for a wrong walkway or two; the tests use the constant.

### Chunk merge (the M12 perf pass, done for the mirror)
- `view/buildingViews.ts` now merges every building in an 8×8-cell chunk into one mesh (`chunk:i,j`), rebuilt
  when any building in the chunk appears, leaves or changes its mesh signature. 300 buildings → 15 chunk meshes;
  the whole scene is ~31 meshes. A rebuild re-creates each building's primitives and merges twice (building, then
  chunk) — tens of milliseconds for a full chunk, once per placement, not per frame.
- To merge, everything must share the one flat material, so damage is now baked into the vertex colours (× 0.45,
  0.42, 0.40 — the old damaged material's diffuse) instead of a material swap; the lean is still a pivot rotation,
  baked by the merge. `damagedMaterial()` is left in place but unused.
- Lanterns became two thin-instanced spheres, lit and dark, whose instance buffers are rebuilt only when the set
  of lit lanterns changes (a per-frame signature string over ≤ a few hundred ids). Lantern positions are read off
  the per-building lantern mesh at chunk build and the mesh is disposed.
- Smoke M1 now asserts one mesh per chunk (1–64) instead of one per building; `__tidewater.view.chunks()`.

## Session A (overnight, branch `rules`)

### Task 1: the stilt rule replaced
- **The rule.** `grid.floorFor`: an auto-sized piece stands at max(terrain + `STILT_MIN` 0.5, tide-to-clear +
  `CLEARANCE` 0.1). Walkways (`floor: "street"`) clear `TIDE_HI` → never under 0.7; buildings (`floor: "stilts"`:
  hut, house, tall house, market, clam camp, smokehouse, net loft, warehouse, well, bathhouse, tavern, shrine,
  market square, clinic, inn, oyster bed) clear `SPRING_HI` → never under 0.95. Both snap up to a neighbouring
  deck within `WALKWAY_SNAP` and take the lift; neither ever goes below its safe height. The cut rule itself is
  untouched (`floorY < level`): with these floors the only thing a tide can cut is a standard walkway on terrain
  below `SPRING_FLOOD_TERRAIN` = SPRING_HI − STILT_MIN = 0.35, at a spring peak. The constant is derived, not
  typed, so the floor formula and the flood line can't disagree; a test pins it.
- **What "standard" means** was read as: everything whose old floor was the flat-class 1.0 or the old terrain+0.5
  stilts. Sea structures (pier, dock, harbor, shipyard, breakwater, net, outfall) keep their fixed 1.0 — they
  already clear the spring peak and aren't on the flats. Hill/ground kinds (lumber camp, sawmill, treatment
  plant, fire watch, lifeguard, lighthouse, sea wall) keep `"ground"` = max(1.0, terrain + 0.05), which also
  clears the spring peak on the flats. Homes on the hill now stand on 0.5 stilts like everywhere else (they used
  to sit on the ground) — one rule, one look; `deck()` draws the stilts whenever there is 0.2 to draw.
- **Paths vs walkways on the beach band.** Paths hug the ground (floor = terrain + 0.05), so a path on the beach
  between 0.6 and 0.85 used to be cut at a spring peak — a hole in "only walkways can flood". Now paths need dry
  ground at or above `DRY_TERRAIN` = SPRING_HI + CLEARANCE (0.95, a `terrain` window on the kind) and walkways
  take a new placement class `street` = flat cells plus high cells below DRY_TERRAIN. The two tile exactly, so a
  trail from the flats up the hill is walkway-on-stilts across the beach, then dirt. Walkways are picked against
  the terrain like hill tools, since the street class climbs.
- **Cost.** `placeCost(kind, stilt)` = base + `STILT_COST_PER_UNIT` (6) × stilt length, rounded to the dollar;
  `tryPlace` computes the floor first (snap and lift included) and prices from it. 6 was chosen so a standard
  walkway on the lowest flat cell (terrain −0.35 → stilts 1.05 → 11$) still undercuts the fixed-price raised
  walkway (12$), which stays the spring-proof option at a known price. The old `LIFT_COST` is gone: a lift is
  just more stilt, priced the same way. The ghost grew four thin posts from deck to ground and the hint says
  "Stilts 0.9 m · 10$"; the info panel shows a building's stilts.
- **Starter town from 650$ (seed 7):** 143$ after the build (pier 60, two boats 160, three standard walkways on
  0.72–0.98 m stilts — no raised needed now — huts 0.58–0.98 m, market 0.82 m, outfall), then 136 → 133 → 160 →
  195 over four cycles: +52 net. Positive; nothing retuned.
- **Tsunami.** `WAVE_HEIGHT` = SPRING_HI + CLEARANCE + `WAVE_MARGIN` (0.45) = 1.4, unchanged in value but now
  stated as "anything not lifted WAVE_MARGIN above the safe building height" — two `]` presses (0.4) don't quite
  make it, three do, which gives the lift key a purpose. The roll now books the wave for the next settlement
  (`tsunami.due`) and says "The sea is uneasy" (log and tide clock) — one tide of warning; `forceTsunami` stays
  immediate for the smoke. `repairDamage` rebuilds damaged walkways, raised walkways and paths first, for their
  base price and no timber, before the repair fund touches anything else. Old saves get `due = -1`.
- **Removed:** the market warning branch "under water at the peak" (a market's stilts now clear every tide; the
  street to it can still flood at a spring peak, which the "no walkway to a pier" branch already reports), the
  walkthrough step's "press ] to raise the deck", the "+2$ a step" hint. The "stuck" hint never had flood advice.
- **Old saves** keep their stored floors: a walkway placed at terrain + 0.5 under the old rule may still sit
  below 0.7. Not migrated — the shape check passes and a wrong-height street is visible and cheap to replace; a
  migration would have to guess the lift.

### Task 2: the known-broken hour
- `PERSON_SCALE` 0.62 → 0.4: the figure is 0.63 units tall at scale 1, so a person is now a quarter of a cell
  (Cities: Skylines is ≈ 0.22). Read "≈ 0.4 of a cell" as the scale value the handoff had been discussing, not a
  height, since 0.62 already gave 0.39 of a cell and the complaint was "a touch large". Baskets, hats and porters
  share the matrix and scale with it; swimmers' waterline offset became `CHEST` = 0.34 × scale.
- Shark-net floats and the marker buoy left the static building mesh for `view/effects.ts › syncNets`: five
  floats (red/white per-instance colour) and a buoy per net, placed on `tide.level + waveHeight` every frame, so
  they ride the tide and the swell and sit on the mud at a spring low. The net panel stays static, hung from the
  seabed to 0.7. Smoke: the same net's floats sit 0.95 lower at −0.35 than at 0.6.
- The shift bell is gated by `isSunUp` (the sun vector's y > 0, i.e. the first half of the day) — not
  `isDaytime`, whose dusk threshold runs a little past sunset. Smoke walks eight shift changes and expects the
  bell exactly on the four with the sun up.
- Sea wall class `flat` → `shore` (a flat cell orthogonally against the hill), as the brief says. NOTES M11 argued
  a shore wall protects nothing on the flats; that stands — it now protects what is *behind* the shore along the
  wave axis (hill homes, the landward street), and the flats rely on breakwaters and lifted decks. The tsunami
  test now guards a hut on the hill behind a shore wall instead of a house on the open flats.

### Task 3: the ferry carries workers (attempt 1 worked)
- The edge lives in `sim/network.ts › distanceField`, which is now a bucket queue (Dial's algorithm) so one
  weighted edge keeps distances minimal: when the walk reaches a cell of the ferry's mainland terminal it also
  pushes every cell of each isle terminal at `d + FERRY_COST`, and vice versa. Everything else is the old BFS.
  `assignWorkers` did not change at all — it already ranks home/work pairs by that field, so the crossing simply
  costs `FERRY_COST` = 10 cells of walking (about the width of the channel) and nearer jobs still win.
- "An edge harbor": the mainland terminal is the harbor, and it counts only when the walk can reach it — a raised
  walkway (`flatOrDeep`, "bridges deep water out to a dock") from the street to the harbor, the same link the
  harbor's own six boat slots need for crew. An unlinked harbor still runs the visual ferry and opens the isle,
  but nobody crosses. The isle terminals are every pier or dock standing on the isle (any `slots` kind but the
  harbor), lowest id first; a cut terminal (spring tide over its deck) drops the edge for that phase.
- `crossCommuters(state, grid)` sums the assignments whose home and work sit on different sides of the water; the
  view reads it every frame. The ferry itself is still pure view: it now lands beside the isle's pier (a free deep
  cell next to it, nearest the harbor) instead of the bare rim, and seats `min(8, commuters)` figures on its deck
  in two rows, facing the bow, whatever leg it is on. The walkers' two-leg commute is the simplest reading of
  "passengers visible": a cross commuter walks home → terminal on their side, vanishes for
  `FERRY_CROSSING_SECONDS` (20 s), and reappears at the far terminal walking on to work. It is not synchronised
  with the ferry's 70 s timetable — the deck riders stand for the crossing, the walkers for the legs.
- Scenario helper `bridgeTo(state, grid, piece)` lays raised walkways from a sea piece to the nearest mainland
  link; the sim test builds harbor + bridge + smokehouse + two empty houses, then the isle, and checks both
  directions: with 6 residents and 10 jobs on the mainland the isle's 6 residents fill the 4 left over; with two
  boats at the isle pier, empty isle huts and the houses filled, 4 mainland hands crew the isle boats. The isle
  hut's distance from the market is exactly market→harbor + 10 + pier→hut. Smoke B6: 4 commuters, 4 riders.

### Task 4: seeded islands
- `heightfield.ts › islandHeight(seed)` is the old `terrainHeight` with the noise seed as a parameter: the hash
  already mixed `TERRAIN_SEED` (0) in, so seed 0 runs the identical arithmetic and the original island comes out
  byte for byte (the sim test pins a fingerprint of all 4096 cell heights, `19bacd86`, and the old `mainLand = 750`).
  The radial falloff is the same for every seed, so no main island ever reaches the isle, which is blended in
  unchanged at (22.5, 22.5); the isle is left out of every validation count.
- `island.ts › island(seed)` returns the first candidate that passes; candidate k is `candidateSeed(seed, k)` —
  the seed itself first, then a hash of (seed, k) — so a seed always gives the same island. Validation
  (thresholds in balance.ts, `ISLAND_*`): ≥ 400 flat cells, a 4-connected flats region ≥ 250, ≥ 3 pier sites by
  the grid's edge rule (deep anchor, flat beside it, two deep cells seaward), ≥ 1 harbor site (a 3×3 block under
  −1.5), ≥ 60 trees on high cells. Tree sites come from the same 70-site placer as before, moved into island.ts
  and fed the candidate's heightfield.
- "≥ 60 high cells with trees" is read as tree *sites* on high cells, not distinct cells: the original island's
  70 sites share 45 cells, so the distinct-cell reading would fail seed 0, which the brief says must stand as it
  is. With the sites reading seed 0 passes on its own (island() still exempts seed 0 as a guard, and the test
  asserts it passes without the exemption).
- Reroll rate, seeds 1..200: 114 of 200 needed at least one reroll (57%), 269 rerolls in all (1.35 per island),
  the worst seed took 11, none hit the cap (`ISLAND_MAX_REROLLS` 32, after which the original island stands in
  and the count says so). Almost every rejection is the tree rule — the noise makes plenty of islands whose hill is
  too small or too steep for 60 of the 70 sites — with 16 of 200 also short of flats and 16 short of a contiguous
  region. A candidate costs ~5 ms (4096 heights + 3000 tree tries), so the worst seed opens in ~60 ms. The rate
  is logged in the ledger too: a seeded town's first notification says "Island N: F flat cells, P pier sites
  (after R rerolls)".
- The ledger carries `world.seed` (the requested seed; old saves get 0), `createState(seed, islandSeed)` sizes the
  tree ages from the island, and `Grid.island` is `island(state.world.seed)` — `attach` reclassifies from it, so a
  load onto another island just works. The view samples ground through `view/ground.ts` everywhere now (boats'
  bed, swimmers, crab spots, the camera floor, the placement ray used to read the seed-0 heightfield directly);
  `terrain.reset(height)` rebuilds the mesh and the water's heightmap for the island in `syncGround`.
- The Town menu: an "Island seed" field (shows the current island's seed when opened), **Random** (1..999999),
  and **New town** on that seed after the usual confirm. The RNG seed stays `SEED` = 1: the island seed changes
  the ground, not the dice. `newTown()` in the console API defaults to seed 0, so the smoke's scenarios keep the
  original island; its Task 4 block drives the menu with real clicks, reloads onto island 7, and returns to 0.

## Session B (QA, branch `qa`)

### Rotation (Grady, live: "the door is not facing the pathway")
- `Building.rot` is 0–3 quarter turns; rot 0 is how every factory was drawn (door toward −z), 1 puts the door
  toward −x, 2 toward +z, 3 toward +x (Babylon's `RotationY`, baked into the vertices about the footprint centre
  before the chunk merge, so nothing else in the view changes). Odd turns swap a footprint's width and depth in
  `Grid.footprint(kind, anchor, rot)`; the factory still builds the piece as designed because `bounds(cells, rot)`
  hands it the unturned extent. The two factories that read their orientation off the cells themselves (clam camp,
  lumber camp) turn with the footprint and are not baked.
- `tryPlace(…, rot = null)`: null means "face the street" — `Grid.facing(cells)` counts walkways, piers and
  markets against each side and picks the busiest (ties: −z). A footprint that isn't square keeps its shape on its
  own (0 or 2 only); R still stands it on end. The placement ghost shows a blue door tab on the facing side; R
  adds a quarter turn from whatever the ghost shows, and changing tools goes back to automatic. R was the camera's
  keyboard zoom-in; it still is when no turnable building is in hand.
- Turnable: land classes (flat, high, flatOrHigh, shore, beach) minus the street kinds. Streets, piers, docks,
  the harbor and the sea pieces keep their one orientation. Old saves read every building as rot 0.

### The isle's outline (Grady, live: "a perfect circle of light around it")
- The dome was radially symmetric, so the flats shelf, the rim blend and the shallow-water brightening in the
  water shader all drew concentric circles. `isle.ts` now warps the rim radius with three low harmonics (3θ, 5θ,
  7θ; ±26 % at the extremes), puts the knob 1.3 west / 1.2 south of the rim's centre, and tilts the shelf with a
  2θ term, so the beach is wide on one side and the shallows narrow on the other. Same mean radius, still
  clear of the main island (its nearest land cell is 30.7 from the isle's centre; `mainLand` stays 750), and the
  isle mask follows the new outline. Isle land 127 cells (was ~110), knob 26.
- Seed 0's fingerprint moved with it (`19bacd86` → `3fcf3090`); "the current island" for Task 4's guarantee
  is the island as it is after this change. `settleIsle` now lands two huts instead of three; the ferry test's
  arithmetic still comes out at four commuters each way.

### Task 1: the sim fuzzer
- `src/sim/money.ts › moveMoney(state, amount, why)` is now the one way the purse changes (build, refund, boat,
  shipyard, settlement, trade, tourism, loan, repair, rebuild, landfill, plant, lantern); `auditMoney(fn)` is a
  module-level listener the fuzzer subscribes to. It is not in the state (saves and hashes are unchanged) and
  `moveMoney` adds exactly what the old `+=` added, so no number moved.
- `test/fuzzCore.ts › runSeed(seed, cycles)` plays ~6 random actions a cycle from its own mulberry32 stream (the
  ledger keeps its RNG) — placements of every kind at cells near the town with random turns and lifts, removals
  (boats out or not), boats, loans, plank orders, forced storms/tsunamis/fires, land tools, lanterns, save→load
  (forced often mid-storm and mid-wave), speed changes and the occasional grant — and checks every invariant at
  every cycle boundary (right after the settlement). Every fifth seed plays a generated island.
- Reading of the brief's invariants: "no negative stock" is the goods; the purse may go below zero (upkeep is
  unconditional — see the proposal in QA.md). "Caps respected" means a stock never *grows* past its cap (a grant or
  a lost warehouse can leave it above, and `addCapped` then holds it there). "No building on an invalid cell" is
  judged on the building's own cells (a neighbour's landfill can turn a pier's shore high without moving the pier —
  a rule question, also in QA.md).
- What the 50 × 2000 runs found (QA.md #1–#3): a stale crew count after a storm at the peak, the stale tide-drift
  flow (found by reading, not by the fuzzer — it builds a fresh Grid on every load), and the pollution field
  running past 1.0 in big late towns, first through unbounded emitter adds and then, once those were capped,
  through the drift itself: advection sends each cell's share to its one uphill/downhill neighbour, so a sink
  cell with several full neighbours takes in more than it can hold. Pollution is a 0..1 fraction everywhere it is
  read, so its emitter stops at full and `stepDrift` takes a ceiling (1 for pollution); the mass above full is
  dropped. It changes nothing in a town that never saturates a cell, which is every town the tests and the smoke
  play. The first attempt clamped all three fields — and silenced every fire: fire risk is meant to climb past
  `FIRE_IGNITE_THRESHOLD` (1.0), so the fire field (and, untouched, the shark field) stay unbounded and the fuzzer
  holds fire to "finite and ≥ 0" instead — a rule question for QA.md, not a fix.
- `npm run fuzz`: esbuild bundles `test/fuzzWorker.ts` (Node can't import the extensionless TS of `src/` on its
  own) and worker threads play the seeds in parallel; a cycle costs ~0.2 s on a young town and ~0.6 s on a full
  one, so 50 seeds × 2000 cycles is about an hour on 25 workers. `test/fuzz.test.ts` runs two short seeds under
  vitest so the fuzzer itself is exercised on every `npm test`. `--json` writes the per-seed hashes: the
  determinism baseline for Task 6.

### Task 3: quality presets
- `ui/settings.ts` holds the three presets and the probe thresholds; `main.ts › applyQuality` flips the bloom
  pass, the water's reflection and caustics uniforms, `walkers.cap` and `wildlife.gulls`. The old remembered
  reflections toggle became live-only: the preset decides what a launch starts with, the button flips it for
  the session (two remembered switches for one thing disagreed on load).
- First launch: no stored preset → the game starts at High and counts frames for `PROBE_SECONDS` (3); ≥ 55 fps
  keeps High, ≥ 35 drops to Medium, below that Low; the verdict is written to localStorage, shown in the panel
  ("Chosen at first launch: …") and logged. The probe runs on the starting town, which is cheaper than a full
  one — a deliberate lean toward High; the player can always step down.

### Task 4: deploy
- `vite.config.ts` gets `base: "./"`: relative asset URLs, so one build runs at the root (the dev server, `vite
  preview`, `check:dist`) and under `/tidewater/` on Pages without knowing its own path. Nothing in `src/` loads by
  absolute URL (the only `/…` import is the smoke's `/test/scenario.ts`, served by the dev server).
- `test/deploycheck.ts` serves `dist/` under the repository path with a twelve-line static server and loads it in
  headless Chrome, failing on any response ≥ 400, failed request, page error or console error. Locally it uses the
  installed Chrome with the GPU; in CI (`CI` set) Playwright's own Chromium, installed by the workflow.
- `.github/workflows/ci.yml`: build + `npm test` + `check:dist` on every push and pull request; on `main` the
  `dist/` artifact is published with `actions/deploy-pages`. Pages must be set to "GitHub Actions" as the source
  once in the repository settings; the site is https://grady89.github.io/tidewater/. The workflow has not run yet —
  nothing was pushed tonight — so the first push to `main` is its first run.

### Task 5: the playtest log
- `ui/playtest.ts › PlaytestLog` is pure data with an injected clock, so the export shape is unit-tested from a
  scripted session (`test/playtest.test.ts`); main.ts feeds it: `placement.onPlace/onRemove` (tool, cell, what it
  cost or refunded), `onNotify` in state.ts (every notification is a "warning" event; a module-level listener like
  the money audit — not state), the HUD's `lastHint` when it changes to something other than the tool's default
  prompt, the walkthrough's step index/title when it changes, and a money/population sample at every peak.
- Off by default; the switch, and the notes, live in localStorage so they survive a reload; the log itself starts
  fresh at every page load with the switch on (it is a session log). Thirty minutes after `start()` it stops
  taking events; the export says how long it ran. "Export playtest log" builds a Blob and clicks an `<a download>`
  — no server anywhere. The smoke drives the real switch, textarea and download.

### Task 2: the UI monkey
- `test/monkey.ts` drives headless Chrome with real input: clicks with all three buttons at random canvas
  points, drags (left = paint/select, right = orbit, middle = pan), wheel, held camera keys and every other key
  the game reads, clicks on whatever buttons are visible (so the palette, the Town and Quality panels, the
  save/load slots — dialogs are accepted or dismissed at random), typing into the seed field, viewport resizes,
  and at 35 % / 70 % of the run a forced tsunami and a forced storm each followed by a save and a reload.
- Pass criteria as the brief lists them; "fps never below 30 for more than 2 s" is measured from a
  requestAnimationFrame log installed on every navigation: the longest run of consecutive frames slower than
  33 ms. A single stall (a chunk rebuild, a resize) counts if it lasts two seconds; a page reload resets the log.
  "No stuck modal" is checked at the end: three Escapes must leave the Town menu hidden.

### Task 6: code health
- The refactors are behaviour-neutral by construction and by measurement: a 12-seed × 120-cycle fuzz run was
  recorded before (`fuzz-baseline.json`) and replayed after — identical end-state hashes for every seed — and
  the smoke passes unchanged.
- Removed: exports nothing referenced (`buildingCost`, `stormActive`, `tsunamiActive`, `addAt`, `damagedCount`,
  `randInt`, `cellsWithin`, `lanternCount`, `isHome`, `springAhead`, `HARBOR`, `damagedMaterial` and its
  material map, `footprintOf`). Merged: the three per-module flow caches into `fields.flowFor` (which is where
  QA #2 came from), the lattice helpers into `sim/cells.ts` so `island.ts` no longer carries its own copies.
- `any` is gone: the headless scripts type the console API with `TidewaterApi` (a type-only import of main.ts,
  never loaded at runtime) and the ledger's own types; the handful of `!` that appeared mark places the scenario
  guarantees (the starter town's market and pier exist).
- The test suite: `sim.test.ts` was one 1474-line file that vitest could only run on one core (60 s+). It is now
  six topic files (`sim`, `economy`, `fields`, `fire`, `town`, `world`) plus `fuzz` and `playtest`; vitest runs
  files in parallel, so the wall time is the slowest file. Measured at 31 s with the 50-seed fuzz run holding
  25 of the cores at the same time; the solo number is in QA.md.
- Per-tick hot paths, same arithmetic in the same order: `stepDrift` keeps its neighbour table flat (an
  Int32Array and a count per cell) and clears its scratch with `fill`; `updateNetwork` walks DIRS by index
  (`grid.buildingAtIJ`) instead of building neighbour cell objects 2400 times a cycle per building.
- ARCHITECTURE.md: the module map, the tick order, and the path from a palette click to a merged chunk mesh.
- No TODO / FIXME existed anywhere in `src/`, `test/` or `shaders/`.

## Session C (overnight, branch `globe`): the World

The game now launches into a floating dodecahedron of twelve seas and dives into one. The notes for it live in
`docs/globe/` rather than here, because the brief asked for them as a staged set:

- `direction.md`, `experience.md`, `hero.md`, `motion.md` — the four design stages (what it is, every state and
  interaction, the hero's numbers, the motion table with the values the code uses).
- `decisions.md` — the fifteen calls the brief left open (island scale; a static globe with an orbiting camera;
  the shaders' `frame` and fog uniforms; the sun by the player's clock; face order and migration targets; roofs
  as thin instances; sector storage and its LZW packing; uncharted seas as fogged water; the return framing; the
  active sector as the autosave; the disc triangulation; the heap check in the smoke; Escape returning from the
  island; the first-launch probe measuring the World).
- `review.md` — the frame-by-frame pass and its twelve fixes; `audit.md` — the launch checklist and the final
  runs; `PROGRESS.md` — the stage ledger.

Two things a future session should know that the docs only imply: the island scene is never rebuilt (a dive
is `adopt(state)` and a camera hand-over — do not turn it into a create/dispose lifecycle), and the shaders in
`shaders/` gained uniforms only (`frame`, `fogNear`, `fogFar`; identity and the study's 45/140 by default), so
the island's water and terrain render exactly as before.

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

## Session D (overnight, branch `biomes`): the six-biome framework, the Fjord and the Atoll

BIOMES.md is the design; docs/biomes/PROGRESS.md the stage ledger; docs/biomes/decisions.md the twenty-odd
calls the design left open (numbered, cited from the code). ARCHITECTURE.md "Biomes" is the map. What a future
session should know that those only imply:

- **Tidewater plays as it did, except the two house-level rules.** The goods registry, the tide scaling, the
  materials, the looks and the shader uniforms all default to the study's values; seed 0's fingerprint test
  still pins the island, and the M2/M3/M5/M9 scenarios pass with their numbers. The two changes: a home needs
  two food kinds in stock for level 2 (fish + shellfish: an oyster bed or a clam camp) and three plus a foreign
  luxury for level 3 (the company sells rice and coffee to a Tidewater harbor). The smoke's M7 grants those.
- **Balance pass (Stage 7), measured with a scripted "natural" player** — the starter town, then the second
  food building as soon as it is affordable, then a well, then huts; a harbor granted at cycle 9 and a luxury +
  a third food ordered at cycle 10 (the numbers in the log below are cycles):

  | coast | second food | level 2 | level 3 (with the purchase) | money over the first 4 cycles |
  |---|---|---|---|---|
  | Tidewater (seed 7 / 0) | oyster bed c1 | c14 / c21 | not within 24 (happiness 0.71 with 8 residents) | positive |
  | Fjord (seeds 2, 4, 7) | racks c3–c5 (unsalted) | c13 | c16 | positive (+52$) |
  | Atoll (seeds 2, 4, 7) | grove c1 | c14 | c17 (seed 2; the others lacked a third food in time) | positive |

  Level 2 lands around cycle 13–14 on every coast rather than the brief's ~8, and the reason is the base game,
  not the new numbers: happiness sits at 0.69–0.74 until a well (+0.10) is affordable and placed, and the
  level-up threshold is 0.8. The new numbers were nudged where they were plainly off: unsalted racks make 0.6
  of the stockfish (was 0.5: at 0.5 the racks lost money against selling the fish), stockfish sells for 6$ at
  the market (fish 4$; the salt is imported), the company buys it at 7$; a coconut grove gathers 1.0 per grown
  palm within 6 (was 0.6). Nothing in balance.ts that existed before this session moved.
- **Starter towns on the new coasts** needed the scenario helpers to grow up: `starterTown` grows the street
  until a market fits (the Fjord's ledges), `growStreet` may grow off the market's edge when its walkways are
  boxed in (the Atoll's reef flat), paths count as street for `placeByWalkway`, and `biomeTown` / `joinByLine`
  / `growStreetAny` put the coast's own kinds down and join a hill kind to the street. The Fjord's starting hut
  looks for its flats at the head of the fjord (`Biome.startNear`); the island's centre is the channel.
- **What the fuzzer found:** nothing new in the two-seed vitest run per coast; the overnight 50 × 2000 run has
  not been made on this branch (`npm run fuzz`; every fifth seed now plays a generated island on the next charted
  coast).
- **Rough edges worth knowing** (HANDOFF.md "Biomes" has the list): the Fjord's ridges read as smooth slabs
  under the snow (the shaper's noise is small against its profile); the whaling station's boat slot shows a
  fishing boat, not a whaleboat; the aurora is a sky term only (no light on the ground); sea ice is a colour
  and a swell change, not a mesh; the ice-breaker pier's prow is a plain wedge; nothing announces the
  favourite luxury's bonus in the info panel beyond the happiness figure.
- **Stage 9, sea lanes v0** (`sim/lanes.ts`, `LANES_ENABLED = false`): the ledger and the cargo hop exist and are
  tested; nothing is drawn, nothing is announced beyond a notification, the company does not sail the lanes, and
  the hold/reserve/want numbers are untuned placeholders. docs/biomes/PROGRESS.md Stage 9 lists exactly what is
  missing. Turning the flag on is safe (the smoke and fuzz never saw it on, so run both first).

## Session E (2026-09-27, after the first blind playtest): the first fifteen minutes

A blind tester's report (charming, the tide is a hook, but step 3 never checked off and the money loop never
closed) replayed in the sim alone (`scratch/replay.ts`, not committed) and turned out to be two logic problems:

- **The dragged run skipped what it could not build on.** A street dragged from the pier to the hut is an L; on a
  generated island the L crosses a high cell, the cell is skipped, and two fragments go down with a gap between
  them — planks "where it asked", the hut never on the street, and since immigration fills only homes on the
  street, nobody came either. Now `build/line.ts` `routePath` lays the L when it is clear and otherwise the
  shortest route through cells that fit (the ends may be unbuildable — the pier, the hut — the route starts and
  ends beside them); only when no route exists does the plain L show, red. Step 3 says why it is still open once
  walkways exist. Tested on four islands (`test/line.test.ts`).
- **The market took three of the first four residents.** Nearest-first assignment, the market nearest, three
  jobs: one crew of two on a boat, a fish a cycle sold, +2$ a cycle against upkeep. The market now needs one
  worker at full selling rate; four residents give three crew and a seller, about 26$ a cycle from cycle 3 on
  seeds 0 and 7. Job counts elsewhere shift by two (the World's ferry test).
- The first peak said "no workers" before anyone lived there; it now says no one lives here yet and what fills
  the homes. The "Make room" step names the three conditions for arrivals.
- A pier click within a cell of a working spot takes that spot (`Placement.snapTo`).

The same tester's full round (two seas, both exported; `scratch/inspect.ts` loads a sea export and prints every
building's connection and the job assignment) added:

- **The walkthrough never ran.** Its progress is one localStorage key, and the first session had finished it, so
  every later sea opened on "Walkthrough done" and the tester built from the empty-state hints alone. Entering a
  sea at cycle 0 now resets the walkthrough.
- **"Placement needs a press-and-hold."** The tester drives a browser by script: a click with no pointer move first
  found no hovered cell, because the cell was picked on pointermove only. The press and the release now pick where
  they land. (A human's mouse moves first, which is why nobody saw it by hand.)
- **The street is one tool.** On the Fjord the tester laid thirty walkways that never met the pier: the cells the
  street needed were the hill's, which take paths, and the hint said so thirty times. A walkway run now lays a
  path where only a path fits and a path run a walkway; `routePath` sees both.
- **Every edge piece snaps** (outfall, shipyard, pier): "Needs deep water against the shore" was unplaceable by
  hand.
- **The loan waits three settlements** (`LOAN_GRACE_CYCLES`; `loan.holdUntil`, absent in older saves = at once)
  before the instalments start: taken at cycle 5 with nothing earning, 24$ a tide made a stall a death spiral.
- The HUD shows who is at work beside the job count (the tester read "2 / 5 jobs" as none filled); the ledger
  line shows the cycle's upkeep (and loan) so the drain is accounted for; the connection warning says what a
  street needs instead of "streets need a pier at one end".

Round 2 (the same tester, after those fixes; one export) confirmed the fixes and died twice more:

- **A storm took the only boat at cycle 11**, and the town had no way back: the loan then drained it. Storms now
  take no boats before `STORM_LOSS_FIRST_CYCLE` (20 — the dice still roll, so a seed's story is unchanged) and
  never a town's last boat (`startStorm` clamps the loss to the fleet minus one). The tsunami still takes every
  unsheltered boat: it comes after cycle 20 with a tide of warning.
- **The loan is paid out of earnings, never out of the purse:** `repayLoan(state, surplus)` takes at most the
  instalment and at most what the cycle earned above its upkeep. A stalled town owes but is not drained (test:
  a hut alone pays nothing and its purse moves only by upkeep). The grace stays.
- **"A visible walkway ran to the market and it still said no walkway to a pier."** The export showed why: the
  walkways touched the market but never the pier's street — the break was elsewhere and nothing showed it. Now
  a piece the network does not reach (a street piece, a home, a workplace; never a root) is drawn faded toward
  bare wood (`applyUnreached`, part of the mesh signature), which also paints a street cut by the spring tide for
  the length of the peak; the spring-peak notification counts the cut walkways.
- **The route leaves from any side of the pier and arrives at any side of the hut** (`RouteOptions.startCells /
  goalCells`): a drag that began on the pier's seaward cell had no buildable neighbour and fell back to the L,
  leaving the gap at the pier the tester saw. The route is now cost-weighted (Dijkstra over the cell's own stilt
  price): on the Fjord it takes the shore over the deep flats instead of a 212$ crossing. The L is kept whenever
  it fits, so a street the player drew straight stays straight.
- A drag that never left its cell places that cell (it placed nothing); the boat tool buys at the pier, dock or
  harbor within two cells of the click (walkways beside the pier were eating the click).
- **True costs at the cursor:** a tag beside the ghost shows the price with its stilts, the flood fate and any
  caution, and during a drag the run's count and price; red when blocked. The build cards keep the base price.
- `__tidewater.world.export(face)` returns a sea's export JSON for testers whose browser drops downloads.
- Not bugs: the "hut stacked on the market" had no overlapping footprints in the export (the hut stood beside
  it); the second fish market that never sold was simply off the street — the fade now says so.

Grady's own pass (2026-09-28, by mouse) found what the scripted tester could not:

- **The painted drag laid staircases.** The run followed the pointer's track cell by cell, so a diagonal hand
  made a diagonal of one-cell steps, each with rails on its two open sides — rails "in the middle of the path",
  and stairs at every wobble. A drag is now one street from where it began to the pointer: straight, or one
  bend after the leg the pointer left the start cell on (`Placement.lineAxis`), recomputed from the start on
  every move; another bend is another drag from the end of the first (the route leaves from beside an occupied
  cell). Where the L is blocked, `routePath` runs Dijkstra over (cell, heading) with a turn cost
  (`RouteOptions.turnCost`, 2) on a binary heap, so the way round a hill has one bend, not a staircase.
- **The gap at the pier, at last.** Street tools pick the terrain under the pointer, and over water the seabed
  lies two metres below the deck, so a drag begun on the pier began three cells past it (both blind rounds
  and Grady saw the gap). `pickCell` now takes the deck plane wherever the ground under the hit is below the
  tide.
- **The rails across the walk.** `tryPlace` gave every piece a facing (`grid.facing`) when none was passed, and
  the dragged run passed none — so a walkway laid beside a street to its west turned a quarter, and its rails
  (built for its real joins) came round across the walk; a leg laid along j happened to face 0. `mayTurn(kind)`
  (balance.ts: rotatable classes minus `LINE_KINDS`) gates the facing in `tryPlace` and the turn in the view, so
  older saves with turned walkways draw straight too.
- **A path's ghost was buried.** A path's floor is "terrain" (not "ground", which the first fix looked for), and a
  6 cm slab on a slope is inside the hill either way. Ground pieces' ghosts — the run's cells and the single
  ghost — now stand on the rendered ground (`view/ground`) as low blocks a quarter of a metre tall.
  The deeper cause: the run's ghost cells are thin instances of a box whose *mesh* y-scale was 0.06, and thin
  instances live in the mesh's own frame, so every instance's height was multiplied by 0.06 — the run's ghost
  had always sat near sea level, plausible on the low flats and buried anywhere higher. The thickness is now
  in the box's geometry.

Grady's third pass (paths on the hill):

- **Paths took any ground, through trees and up cliffs.** Nothing stands on a standing tree now
  (`Grid.treeOn`, in `canPlace`: clear it from the Land tab or go round), and a path is walkable: it climbs at
  most `PATH_MAX_RISE` (0.7 m) per cell along the run (`Grid.stepOk`, threaded through `routePath` as
  `RouteOptions.step`), may only be stepped onto from a street it touches within that rise — or within a stair,
  `STREET_STEP_MAX` 1 m, from a deck (`joinStepOk`) — and cannot perch on a spike (`slopeOk`: some neighbour
  within the rise). A trail may still follow the contour of a steep flank; the drag finds the switchbacks itself.
  The Fjord's banks are cliffs (two thirds of its dry cells rise more than 0.7 m a cell), so its mine test joins
  by the same route (`joinByLine` now routes with `routePath` first).
- **The deck met the path in mid-air.** A deck's stair aimed at the path cell's nominal floor (its centre); the
  path's surface at the shared edge is the ground there. `deckJoins` reads the ground at the edge for a path
  neighbour, and a deck builds a stair up to 1 m (was 0.8).
- **A deck a metre and a half above a path, and no stair.** Stairs stopped at 1 m and adjacency did not care, so a
  walkway laid up to a path far below joined it in the network and floated over it on screen. `STREET_STEP_MAX`
  is 1.5 m, a stair is drawn up to it (a tall flight runs 0.9 of the cell), and `joinStepOk` is strict both
  ways: every street piece a new deck or path touches must be within a stair (deck to path) or the rise (path to
  path), or the piece cannot be laid — what the network joins, the eye sees joined.
- **The outrigger's float sat inside the pier.** Moorings used one yaw per berth, and the Atoll's float lives on
  the hull's local +z, so on one side of every pier (and one side of every dock) it pointed into the deck. A moored
  boat now turns so its outboard side faces away from the harbour's centre (`Boats.moorings`).
- **The path started a cell away from the walkway.** A drag begun on the flats beside a walkway (where a path
  cannot go) now leaves from that walkway (`Placement.streetBeside`), so the two join.
- The achievement toast sat on the walkthrough; it now rises above the speed bar.
- "Backwards stairs": the treads are built by the lower deck and climb toward the shared edge, which the code and
  a side view confirm; the stairs Grady saw were on the staircase-laid cells. If one still reads backwards after
  this build, a close-up with the tide clock in frame is the thing to send.
- **The Fjord's back ran off the square.** Behind the head the valley climbed 5.5 m to the back edge and stopped
  there, so the island ended in a sheer ten-metre cliff. The water's heightmap clamps at the edge, so every point
  behind it read that cliff's height and the sea vanished in a strip to the horizon; on the World the miniature's
  ridge ran into the next face with no shore. The valley now climbs 3 m to a col between the ridges and the whole
  back falls to deep water between z −21.5 and −30.5, a slope like the flanks'. Thresholds still pass on every
  seed tried with no rerolls; a test holds every charted coast's rim below −2.
