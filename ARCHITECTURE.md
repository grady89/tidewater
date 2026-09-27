# Tidewater — architecture

How the code is laid out, what runs in what order, and how a click becomes a building. CLAUDE.md is the design
brief and the engineering rules; this is the map of what implements them. Nothing here is a rule — when the code
and this file disagree, fix one of them.

## The two halves

**The ledger** (`src/sim/`) is a plain JSON object, `SimState`, and pure functions over it. It never imports
Babylon or anything under `src/view`, `src/world`, `src/build` or `src/ui` (a test enforces this). It ticks on a
fixed timestep (`SIM_TICK`, 1/20 s of game time) and uses its own seeded RNG, so the same actions in the same
order always give the same state — the fuzzer, the smoke and the determinism tests depend on that.

**The view** (`src/world/`, `src/view/`, `src/build/`, `src/ui/`) reads the ledger every frame and draws it. It
never writes a number into the ledger except through the placement layer, which calls the same sim functions a
test would (`tryPlace`, `removeBuilding`, `buyBoat`, …). Killing the view changes nothing in the sim.

`main.ts` wires the two: it owns the render loop, the console/test API (`window.__tidewater`), autosave, the
quality presets and the playtest log — and, since the World (docs/globe), which of the two Babylon scenes on the
one engine renders: the globe of twelve seas the game launches into, or the island. See "The World" below.

## Module map

```
src/config.ts            sizes, tide constants (TIDE_*, SPRING_*), stilt rule constants, day length, terrain seed
src/sim/
  balance.ts             every tunable and the building catalog (BUILDINGS: footprint, class, cost, floor, network role…)
  goods.ts               the goods registry: every stockpiled good with a role, a cap and the company's prices
  materials.ts           cell materials beside the classes (lagoon, mangrove, lava, dune, oasis, vent, spring, fertile)
  tides.ts               the tide's numbers per biome: tidesFor(scale) rederives every level, mark, flood line and floor
  food.ts                food variety (any food feeds, eaten in proportion), the luxury rule, the favourite
  biomes/                registry.ts (the Biome interface and registry), index.ts (imports every biome), tidewater.ts,
                         fjord.ts, atoll.ts — each a delta on the catalog: tide, goods, kinds, shaper, validation, hooks
  state.ts               SimState, Building, Fields; createState; notify (+ onNotify hook); population
  cells.ts               the 64×64 lattice helpers: HALF, DIRS, inBounds, cellIndex, cellCenter, worldToCell
  heightfield.ts         islandHeight(seed): the analytic terrain; terrainHeight = seed 0; cellClass(h)
  isle.ts                the second island's outline and height, blended into every heightfield
  island.ts              island(seed): validation (flats, region, pier/harbor sites, trees), rerolls, tree sites
  grid.ts                Grid: cell classes/heights/masks from the island, occupancy index, placement rules
                         (footprint with rotation, classOk, terrainOk, canPlace), the stilt rule (floorFor,
                         stiltLength), facing, place/remove, landfill; terrainVersion for terrain-keyed caches
  rng.ts                 rand(state): the ledger's RNG (xorshift on state.rng)
  tide.ts                tickTide, levels, phases, spring cycles, floodFate
  daylight.ts            sun/moon vectors and the dusk factor from sim time (view reads, sim owns)
  network.ts             updateNetwork (reached/cut flood fill from piers), distanceField (+ the ferry edge)
  workers.ts             jobsAt, assignWorkers (nearest-first over distanceField), trimCrew, staffing, employed
  economy.ts             money/goods: canAfford, pay, placeCost, tryPlace, removeBuilding, boats, caps,
                         shiftStart/shiftEnd (boats, beds, camps), produce, homeHappiness, settleCycle
  money.ts               moveMoney: the one way the purse changes; auditMoney listener (fuzzer, playtest)
  fields.ts              the 64×64 scalar fields: buildFlow/flowFor (tide drift graph), stepDrift, at, maxOf
  pollution.ts           emitters → pollution field; fish density regen/depletion; oyster bed stress
  sharks.ts              shark-risk field, swimmers per beach, incidents, injuries and healing
  fire.ts                fire-risk field, ignition, spread, burn-out, damage and repair (streets first)
  services.ts            coverage layers per service kind, lanterns, level-up announcements
  land.ts                landfill, plant, clear (the land tools)
  trees.ts               tree sites (from the island) and ages; felling and regrowth
  sea.ts                 sea BFS: grounds for boats, sea paths for the ship and the ferry
  trade.ts               the trade ship as the Trade Company's carrier: what it carries and buys here, sliding prices, the order book, tourists
  loan.ts                one loan at a time, repaid per settlement
  events.ts              storms and the tsunami (warning, drawdown, wave, strike, shielding)
  districts.ts           named clusters of buildings (view/info only)
  achievements.ts        milestones, checked once a second
  tick.ts                tick(): the order below; advanceCycles for tests
  save.ts                serialize/deserialize (fills fields added since), stateHash
  start.ts               newGame(seed, islandSeed), startCell, suggestPier
  sectors.ts             the World's twelve sectors: metadata, read/write/rename/delete/export/import over an
                         injected Store (localStorage in the game), the active sector, legacy migration, band/biome lists
  compress.ts            the LZW packer sector states are stored with (twelve big towns overflow 5 MB as plain JSON)
src/world/               the study's terrain / water / sky shaders and lighting (uniforms only are new; the World
                         adds `frame` and `fogNear/fogFar`, identity and the study's literals by default)
src/globe/
  geometry.ts            the dodecahedron (pure math): faces, frames, corners, edges, bands, the pentagon disc mesh
  miniature.ts           a sector's island on a 32-cell grid and its roof placements, from the SimState (Babylon-free)
  world.ts               World: the second Scene — per-face oceans, miniatures, roof instances, edges, clouds, the
                         sun by the clock, hover/idle/keyboard motion, the entrance, the dive and return flights
  ui.ts                  WorldUi: title, sector card (built / new-sector flow), notice, hint, import control
src/view/
  buildings.ts           one factory per kind → merged flat mesh; rotation baked about the footprint; damage tint
  buildingViews.ts       chunk merge (8×8 cells → one mesh), lantern thin instances
  walkers.ts / boats.ts / ship.ts / ferry.ts / wildlife.ts / trees.ts / effects.ts / overlays.ts / marker.ts
                         thin-instanced or pooled meshes driven by the ledger + view time; walkers ride the ferry
  ground.ts              the ground sampler every prop stands on (the rendered terrain, landfill included)
  roofs.ts               roof shape and colour per building (shared by the island's meshes and the World's miniatures)
  biomes/                the looks: index.ts (BiomeLook, lookFor, Tidewater's look), fjord.ts, atoll.ts
  audio.ts               procedural Web Audio (surf, bell, thrum, pad, gulls, hammering)
src/build/
  placement.ts           pointer → cell, ghost (fate tint, stilts, door tab), drag-to-paint, lift, turn, place/remove
  cameraControl.ts       the Cities: Skylines-style camera
src/ui/
  hud.ts                 resource bar, build palette, hint line, tide clock, ledger line, notifications
  infoPanel.ts / tutorial.ts / achievements.ts / markerLabel.ts / speed.ts
  saveMenu.ts            Town menu: the sea's name and the "World" button, island seed, new town, the playtest log
  settings.ts            quality presets and the first-launch probe thresholds
  playtest.ts            PlaytestLog: the opt-in local session log and its export shape
  dialog.ts              in-page confirm / prompt / notice (promise-based, focus-trapped) — no window.confirm anywhere
test/
  sim.test.ts            sim-only checks (no Babylon) — helpers in scenario.ts (scripted towns)
  sectors.test.ts / globe.test.ts   the sector model (budget, migration, export/import) and the World's pure parts
  fuzzCore.ts / fuzzWorker.ts / fuzz.ts   the sim fuzzer (invariants every cycle; worker threads)
  smoke.ts               headless Chrome launches into the World, dives into a sea, plays every milestone, comes back
  monkey.ts / quality.ts / deploycheck.ts   random real input; preset fps (island, World, each coast); the built site under /tidewater/
  fjord.test.ts / atoll.test.ts / biomes.test.ts / goods.test.ts   the coasts, the framework, the registry and the base additions
  biomeShots.ts          shots/biomes/: every charted coast beside Tidewater, day and night, wide and close
```

## The World

The game launches into the World: a dodecahedron of twelve seas, one town per face (`docs/globe/` has the
design notes, decisions and the build ledger). Two things make it cheap to keep next to the island:

- **Two scenes, one engine, one canvas.** `World` (src/globe/world.ts) is a second Babylon `Scene`. The island
  scene is built at module scope as it always was and stays resident. `main.ts` holds `mode` (`"world" |
  `"island"`): the render loop calls `world.render(dt)` and returns while the World is up, so the island's camera
  control, tick accumulator, autosave and view sync are simply not run; `body[data-mode]` hides the island's DOM
  and shows `#world`; `CameraControl.enabled` and `Placement.enabled` gate the island's pointer handlers because
  both scenes share the canvas. Nothing is created or disposed on a switch.
- **The dive is `adopt(state)`.** Entering a sea reads its record, `adopt`s the state into the resident island
  (the same path a load takes), flies the World's camera to the pose that equals the island's `frameTown`
  framing expressed in the face's frame, cuts, and puts the island camera at that framing. The return saves the
  town into its sector, refreshes the face's miniature, cuts to the World at the island camera's pose and flies
  back to the orbit. With `prefers-reduced-motion` both are cuts.

**Rendering.** Each face is the game's water `ShaderMaterial` on a pentagon disc in the face's own frame with its
own 128² heightmap; the shaders take a `frame` matrix (the inverse of the mesh's world matrix) so their
height/depth/uv/slope math runs in face-local coordinates, and `fogNear/fogFar` so the World can push the fog out
(the island passes identity and the study's literals). A built face carries a miniature: `island(seed).height`
sampled on a 32-cell grid (landfill raised), the terrain shader, roofs as thin instances of three primitives
coloured by `view/roofs.ts` from the real buildings, the water at the sector's tide level. Empty faces are the
same water fogged close. One sun follows the player's clock; each face's sun/sky uniforms scale with how far it
turns toward it, which is the night side. Clouds are thin instances on seeded orbits; their count follows the
quality preset, as does bloom. Draw calls: 12 seas + edges + clouds + sky, plus a miniature and up to three roof
meshes per built face (`world.drawCalls()` in the console API).

**Sectors** (`sim/sectors.ts`, sim-only, tested without Babylon). Face N's town lives in localStorage under
`tidewater.sector.N` (the SimState, LZW-packed by `sim/compress.ts`) and `tidewater.sector.N.meta` (name, seed,
biome, band, population, cycles, buildings, money, created, lastPlayed — what the card shows without reading the
state). `tidewater.sector.active` is the sea the island scene autosaves into (every peak and on return). The
first launch with the old layout moves `tidewater.autosave` to face 1 and `tidewater.slot.1–3` to faces 2–4,
marks `tidewater.sectors.migrated` and leaves the old keys. Export is the record as JSON; import validates it
through `deserialize`. Faces 0 and 11 are polar, 1–5 temperate, 6–10 tropical; only the Tidewater biome exists
(`BAND_GATING` in config.ts, off, would restrict it to the temperate band).

## The tick

`tick(state, grid, dt)` in `sim/tick.ts`, every `SIM_TICK` of game time, in this order:

1. `tickTide` — the level, wet level, cycle count, `peaked` flag.
2. `updateNetwork` — every building's `cut` (floor below the water) and `reached` (flood fill from piers through
   walkways and markets). Runs every tick because the water moves every tick.
3. `tickTsunami` — drawdown / wave front / strike / settle, when one is running (it overrides the tide level).
4. `tickPollution`, `tickSharks`, `tickFire` — emitters add, `stepDrift` decays, diffuses and drifts each field
   along the terrain flow (up while the tide rises, down while it falls); fire also burns and spreads.
5. Phase change (`high` / `slack` / `low`): `shiftEnd` lands catches and shellfish, `shiftStart` sends boats and
   crews out, swimmers are counted at high water, shark incidents rolled as it ends.
6. At the peak (`tide.peaked`): `settleCycle` — workers assigned, coverage rebuilt, residents eat (every food kind in proportion) and pay tax,
   the market sells, land production, trees regrow, fields settle, waste routed, emitters rebuilt, ignitions,
   repairs, healing, upkeep and the loan instalment (`moveMoney`), trade and tourism, immigration, `state.last`.
   Then `rollStorm` and `rollTsunami` (which is why a storm can take boats right after crews were assigned —
   `trimCrew` keeps the counts honest). The biome's `settle` hook runs right after `settleCycle` (whale season, sea ice,
   avalanches; bleaching, the turtles); its `tick` hook runs every tick before the peak check.
7. Every 20 ticks: `checkAchievements`.

The view loop (`main.ts`) accumulates real time × speed, ticks the ledger as many times as fit, autosaves at each
peak, then syncs every view object from the state and renders.

## From a menu click to a mesh

1. **Palette** — `ui/hud.ts` renders the build menu from `BUILDINGS`; clicking a tool calls `placement.setTool`.
2. **Hover** — `build/placement.ts › refresh` picks a cell under the pointer (a plane at the tool's deck height, or
   the terrain for hill tools), then `evaluate` asks the Grid for the footprint (`grid.footprint(kind, anchor,
   turns)`), the floor (`grid.floorFor` — the stilt rule, the snap, the lift), the stilt length and price
   (`placeCost`), the turn (`grid.facing` unless R was pressed), and the blocker in the same order `canPlace`
   checks it (class, terrain window, occupancy, isle lock, walkway/link/prerequisite/touch, affordability). The
   ghost shows the footprint with the fate tint, four stilt posts and the door tab; the HUD shows the hint.
3. **Click** — `placement.place` calls `tryPlace(state, grid, kind, anchor, lift, rot)` in `sim/economy.ts`:
   footprint → `canPlace` → `floorFor` → `placeCost` → `canAfford` → `pay` (`moveMoney`) → `grid.place`, which
   writes the `Building` into `state.buildings` and the occupancy index. `placement.onPlace` fires (playtest log).
4. **Next tick** — `updateNetwork` marks it reached or not; at the next peak `assignWorkers` staffs it.
5. **Next frame** — `view/buildingViews.ts › sync` fingerprints every chunk's buildings (`meshSignature`: kind,
   level, lantern, damage, rot, street joins); a changed chunk is rebuilt: `createBuildingMeshes` runs the kind's
   factory in `view/buildings.ts` (primitives → one merged flat mesh, turned about its footprint, damage baked
   into vertex colours), the chunk's meshes are merged into one draw call, lanterns become thin instances.
   Walkers, boats and everything else read the same ledger on their own `sync`.

Removal is the mirror: right-click → `removeBuilding` (refund through `moveMoney`, `grid.remove` drops the
occupancy and the building's assignments) → the chunk's signature changes → rebuilt.

## Where state lives

- The ledger: `SimState` only. Saves are `JSON.stringify(state)`; `deserialize` rejects saves missing fields and
  fills the ones that have safe defaults (`achievements`, `extraTrees`, `landfill`, `loan`, `tsunami.due`,
  `world`, `rot`; version 2 → 3: every registry good at zero, `world.biome`, `trade.orders` from the plank order,
  `tide.scale`, `biomeState`, `fields.bleach`). The Grid is rebuilt from the state (`grid.attach`), its tides from the biome.
- Derived per-tick caches keyed on the terrain (the field flows) check `grid.terrainVersion`.
- localStorage (view/UI only): the twelve sectors and their metadata, the active sector, the migration mark
  (the old autosave and slot keys are left in place), tutorial step, quality preset, playtest switch and notes.
  Nothing the ledger needs.
- Module-level listeners (test instrumentation, null in the game): `auditMoney` (money.ts), `onNotify` (state.ts).

## Invariants the fuzzer checks every cycle

Finite, non-negative goods; stocks never grow past their cap; the purse moved by exactly the sum of its entries;
every assignment's home and work exist and the counts agree with `workers`, `residents`, `jobsAt`; reached/cut
match a fresh flood fill; every building stands on cells of its class, once, indexed, above its ground, with
its counters in range; pollution, shark risk and every coverage layer within [0, 1], fish within [0, FISH_CAP],
fire risk finite and ≥ 0 (it is meant to climb past its ignition threshold of 1.0); save → load → save is the
same JSON; bleaching within [0, 1] and only on lagoon cells; every biome counter finite; the tide scale the coast's.
Every fifth seed plays a generated island on the next charted coast. `test/fuzzCore.ts` is the list in code.

## Biomes (docs/biomes, branch `biomes`)

A biome is a delta on the one catalog, never a second one (BIOMES.md §0). The pieces, in the order the ledger
meets them:

- **The goods registry** (`sim/goods.ts`): every stockpiled good the World trades — the base five plus
  BIOMES.md §2's foods, luxuries, industrials and sponges — with a role, a base cap and the Trade Company's
  prices (`buys`: what it pays an island; `sells`: what it charges to deliver). `state.resources` is keyed by good
  id (`GoodKind = GoodId`); `CAP_BASE` is derived from the registry; a warehouse raises every cap. The resource bar
  shows what the coast makes plus anything it holds (`shownGoods`), grouped by role.
- **Food variety and the luxury rule** (`sim/food.ts`): any food feeds; residents eat every kind in stock in
  proportion; a home needs 2 food kinds in stock for level 2, 3 kinds plus one *foreign* luxury (one its biome
  does not make) for level 3, and level-3 residents use a little of that luxury each cycle; the biome's favourite
  luxury (BIOMES.md §2's ring) adds `HAPPY.favourite`. The market sells every food above the reserve, first kinds
  first, the same arithmetic as the old fish-then-shellfish sale.
- **The Toolworks** (base catalog): burns iron, ×1.2 output for producers within 8 (`toolBonus`).
- **The Trade Company as carrier** (`sim/trade.ts`): the ship carries every registry good with a `sells` price
  that the coast cannot make, plus planks; it buys the coast's own goods with a `buys` price (never its cargo
  back), luxuries at prices that fall with the volume of one visit (`companyPays`); `trade.orders` is the order
  book (the old plank order generalised), driven from the harbor's info panel.
- **Cell materials** (`sim/materials.ts`): plain, lagoon, mangrove, lava, dune, oasis, vent, spring, fertile —
  set by the island generator (`Island.materials`, one byte per cell), carried by the Grid, gating unique kinds
  (`BuildingDef.material`), refusing anything on lava, and tinting the ground (the height texture's blue channel).
  Classes stay deep / flat / high for every rule.
- **Tides per biome** (`sim/tides.ts`): every tide constant in config.ts is Tidewater's; `tidesFor(scale)`
  multiplies the levels about mean sea level and rederives the marks, the flood lines, the wave height, the beach
  band, the landfill height and the fixed deck heights. `Grid.tides` is the active set (from the biome at
  `attach`), `TideState.scale` rides in the save, and `cellClass`, `floodFate`, `phaseFor`, `floorFor`,
  `terrainOk` and the placement ghost all read it. Tidewater is scale 1 and computes what it always did.
- **The Biome interface** (`sim/biomes/registry.ts`, the files in `sim/biomes/`): id, bands, tide multiplier,
  foods / luxury / industrials / minor, favourite, unique and excluded kinds, `shape(seed)` (a heightfield, a
  material function, optional tree sites), `validate(stats)` and threshold overrides, `startNear`, and hooks:
  `tick`, `settle` (after the base settlement), `frozen`, `happiness`, `seasonLabel`, `storm` (swell/loss/name),
  `tourism`, `lanternDimmed`, `sharks`. `index.ts` imports every biome file (they register themselves) and
  re-exports the registry; `island.ts` reads the registry directly (the biome files import `state.ts`, which
  imports `trees.ts`, which needs `island()` at load). `catalogFor(biome)` = base ∪ unique − excluded, read by
  `Grid.inCatalog` (inside `canPlace`), the HUD palette and the ghost. `island(seed, biome)` caches per pair.
- **Per-biome state:** `state.biomeState` (a flat bag of numbers: whale season, sea ice, avalanches, bleached
  cells, hatchings, the turtle bonus) and `fields.bleach` (a 0..1 field over lagoon cells). Save version 3;
  version-2 saves are read with every new field backfilled.
- **The looks** (`view/biomes/`): a `BiomeLook` per biome — water and terrain tints, material tints, sky fog and
  aurora, walls, roofs, accents, the house / boat / hat / tree kits, fauna picks, ambience levels — read through
  `lookFor(state)`. `main.applyLook` pushes it into the terrain and water materials (uniforms), the building
  palette (`applyPalette`; chunks rebuild on `views.clear`), the roof palette, and `setLook` on walkers, boats,
  trees, wildlife and audio, each of which rebuilds its base meshes only when its kit changes. The World's
  miniatures read each sector's own look.
- **Shader additions, uniforms only:** terrain bands (five vec3), `snowLine/snowColor`, `matTints[9]/matMix[9]`
  read against the material code in the height texture's blue channel, `tideScale`; water `shallow/mid/deep`,
  `lagoonTint/lagoonMix`, `depthScale`, `ice`, and the bleaching in the height texture's alpha; sky
  `aurora/auroraTime`. With the defaults every fragment computes what the study computed.
- **The Fjord** (`sim/biomes/fjord.ts`, `view/biomes/fjord.ts`) and **the Atoll** (`atoll.ts`): BIOMES.md §3.3
  and §3.2 in full — see docs/biomes/decisions.md #16–#23 for every number the design left open.

`docs/biomes/PROGRESS.md` is the stage ledger, `decisions.md` the calls made where BIOMES.md was silent.
