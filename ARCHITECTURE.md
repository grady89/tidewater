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
quality presets and the playtest log.

## Module map

```
src/config.ts            sizes, tide constants (TIDE_*, SPRING_*), stilt rule constants, day length, terrain seed
src/sim/
  balance.ts             every tunable and the building catalog (BUILDINGS: footprint, class, cost, floor, network role…)
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
  trade.ts               the trade ship, plank orders, tourists
  loan.ts                one loan at a time, repaid per settlement
  events.ts              storms and the tsunami (warning, drawdown, wave, strike, shielding)
  districts.ts           named clusters of buildings (view/info only)
  achievements.ts        milestones, checked once a second
  tick.ts                tick(): the order below; advanceCycles for tests
  save.ts                serialize/deserialize (fills fields added since), stateHash
  start.ts               newGame(seed, islandSeed), startCell, suggestPier
src/world/               the study's terrain / water / sky shaders and lighting (uniforms only are new)
src/view/
  buildings.ts           one factory per kind → merged flat mesh; rotation baked about the footprint; damage tint
  buildingViews.ts       chunk merge (8×8 cells → one mesh), lantern thin instances
  walkers.ts / boats.ts / ship.ts / ferry.ts / wildlife.ts / trees.ts / effects.ts / overlays.ts / marker.ts
                         thin-instanced or pooled meshes driven by the ledger + view time; walkers ride the ferry
  ground.ts              the ground sampler every prop stands on (the rendered terrain, landfill included)
  audio.ts               procedural Web Audio (surf, bell, thrum, pad, gulls, hammering)
src/build/
  placement.ts           pointer → cell, ghost (fate tint, stilts, door tab), drag-to-paint, lift, turn, place/remove
  cameraControl.ts       the Cities: Skylines-style camera
src/ui/
  hud.ts                 resource bar, build palette, hint line, tide clock, ledger line, notifications
  infoPanel.ts / tutorial.ts / achievements.ts / markerLabel.ts / speed.ts
  saveMenu.ts            Town menu: slots, island seed, new town, the playtest log switch/notes/export
  settings.ts            quality presets and the first-launch probe thresholds
  playtest.ts            PlaytestLog: the opt-in local session log and its export shape
test/
  sim.test.ts            sim-only checks (no Babylon) — helpers in scenario.ts (scripted towns)
  fuzzCore.ts / fuzzWorker.ts / fuzz.ts   the sim fuzzer (invariants every cycle; worker threads)
  smoke.ts               headless Chrome plays every milestone through the console API
  monkey.ts / quality.ts / deploycheck.ts   random real input; preset fps; the built site under /tidewater/
```

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
6. At the peak (`tide.peaked`): `settleCycle` — workers assigned, coverage rebuilt, residents eat and pay tax,
   the market sells, land production, trees regrow, fields settle, waste routed, emitters rebuilt, ignitions,
   repairs, healing, upkeep and the loan instalment (`moveMoney`), trade and tourism, immigration, `state.last`.
   Then `rollStorm` and `rollTsunami` (which is why a storm can take boats right after crews were assigned —
   `trimCrew` keeps the counts honest).
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
  `world`, `rot`). The Grid is rebuilt from the state (`grid.attach`).
- Derived per-tick caches keyed on the terrain (the field flows) check `grid.terrainVersion`.
- localStorage (view/UI only): the autosave, three save slots, tutorial step, quality preset, playtest switch and
  notes. Nothing the ledger needs.
- Module-level listeners (test instrumentation, null in the game): `auditMoney` (money.ts), `onNotify` (state.ts).

## Invariants the fuzzer checks every cycle

Finite, non-negative goods; stocks never grow past their cap; the purse moved by exactly the sum of its entries;
every assignment's home and work exist and the counts agree with `workers`, `residents`, `jobsAt`; reached/cut
match a fresh flood fill; every building stands on cells of its class, once, indexed, above its ground, with
its counters in range; pollution, shark risk and every coverage layer within [0, 1], fish within [0, FISH_CAP],
fire risk finite and ≥ 0 (it is meant to climb past its ignition threshold of 1.0); save → load → save is the
same JSON. `test/fuzzCore.ts` is the list in code.
