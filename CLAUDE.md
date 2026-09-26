# Tidewater — project brief (v2)

A coastal town simulator in the Cities: Skylines mold, where the tide is the town's clock.
Earn money, spend it to build. Boats, docks, harbors, shipyards. People and boats visibly moving and working.
The sea gives (fish, shellfish, trade, tourists) and the sea takes (pollution, sharks, storms, tsunamis).

This file is the design bible and the engineering rules. ROADMAP.md is the ordered build plan.
PROGRESS.md is the live status. NOTES.md holds decisions made along the way. Read all four before touching code.

---

## 1. The fantasy

You are laying out a stilt town on tidal flats. Twice per cycle the water rises over the flats and the boats go out;
twice per cycle it drains and the flats become the workplace. You watch your town change shifts. You earn money from
the sea, spend it on the next dock, the next street of houses, the smokehouse, the harbor big enough for a trade ship.
Problems you created come back at you through the water: sewage kills your oyster beds, fish waste draws sharks to the
beach, an unprotected harbor loses boats in a storm. Rarely, the sea pulls back further than it ever has, and a wave comes.

The player places and watches. No direct unit orders. The town runs itself.

## 2. Art direction (settled — never relitigate, never "improve")

- Flat-shaded low-poly geometry from primitives in code. No textures, no imported models, no sprites.
- Palette (hex): sand `#e6d3a1`, wet sand `#b9a377`, grass `#a8c97a`/`#79ad5e`, rock `#8d8a83`, wood `#5a4636`,
  planks `#8a6f52`, walls `#f2ece0 #f4d9c6 #d5e6ea #ece3c3 #f7e7d3`, roofs `#c9674f #4c5a66 #b9543f #5d6d7a`,
  lantern `#ffb859`, boat hulls `#f2ece0 #4c5a66 #c9674f #2f6f8f`, sails `#f7f3e8`, foliage `#4a8a55 #5a9a5c #3f7f4d`.
  New buildings pick from these; add a new hex only when nothing fits and note it in NOTES.md.
- Water and sky shaders in `shaders/` are byte-identical to `reference/tidewater-study.html`. They may receive new
  uniforms (storm amplitude, pollution tint, wave drawdown) but the existing math is not rewritten.
- Every prop is a merged mesh or thin instances. Target: one draw call per building type, one per walker set, one per boat set.
- Time of day exists (the study's dusk lerp). A day is `DAY_CYCLES` tide cycles. Lanterns light at dusk.
- Read `references` for the look, then build new pieces in the same language: boxes, pyramids, cylinders, cones, tessellation 4–8.

## 3. Engineering rules

- Vite + TypeScript strict + Babylon.js 7. No other runtime dependencies without a one-line justification in the commit.
- **The simulation is a ledger.** `src/sim/` owns all state: stockpiles, buildings, workers, fields. It ticks on a fixed
  timestep (`SIM_TICK` seconds of game time), independent of frame rate. It never touches Babylon.
- **People and boats are a visual layer.** `src/view/` reads sim state and animates it. Walkers travel the walkway
  graph between home and workplace at shift change; boats travel deep-water paths. Killing the view must not change
  a single number in the sim. No agent-based decisions in the view.
- **Grid fields** (`Float32Array` of 64×64) are the mechanism for anything spatial: pollution, fish density, shark risk,
  fire risk, service coverage, land value. Fields diffuse/decay per tick; buildings read and write them. Reuse this
  everywhere before inventing a new mechanism.
- All tunables in `src/config.ts` and `src/sim/balance.ts`. No magic numbers in systems.
- Sim state is a plain JSON-serializable object. Save/load = `JSON.stringify` of it plus the grid. Design for this from milestone 1.
- 60 fps on an integrated GPU with 300 buildings, 200 walkers, 30 boats. If a feature costs frames, instance it or cut it.
- Determinism: sim uses its own seeded RNG (`src/sim/rng.ts`). `Math.random` only in the view.
- Commit per system. Short messages. Never leave `main` broken: `npm run build` must pass before every commit.

## 4. The tide (the clock)

- `TIDE_PERIOD` (default 120 s of game time) per full cycle; sine between `TIDE_LO` (−0.35) and `TIDE_HI` (0.60).
- **High water** = level above `HIGH_WATER_MARK` (0.25). **Low water** = below `LOW_WATER_MARK` (0.0). Between is slack.
- Every `SPRING_EVERY` (4th) cycle is a spring tide: peak `SPRING_HI` (0.85), trough `SPRING_LO` (−0.55). Spring low
  exposes the outer flats: bonus shellfish. Spring high floods low walkways (see §9 damage).
- Shift change happens at each transition: high-water producers run in high water, low-water producers in low water.
- Day/night: `DAY_CYCLES` (2) tide cycles per day. Purely visual plus lantern lighting and night swimming risk.

## 5. Resources (global stockpiles, capped by warehouses)

| Resource | Source | Sink | Base cap |
|---|---|---|---|
| money | market sales, trade ship, tourism, taxes | building, upkeep, repair | ∞ |
| fish | boats at high water | market, smokehouse, residents (food) | 100 |
| shellfish | oyster beds, clam camps at low water | market, residents (food) | 100 |
| smoked goods | smokehouse | trade ship (high value), tavern | 60 |
| timber | lumber camp | sawmill, repairs, sea wall | 80 |
| planks | sawmill | tall houses, shipyard, breakwater, harbor | 60 |
| boats | shipyard (or bought, first 2) | docks (capacity) | — |

Residents eat: each resident consumes `FOOD_PER_CYCLE` from fish or shellfish. Hunger lowers happiness.
Taxes: `TAX_PER_RESIDENT` money per cycle. Upkeep: per building, per cycle, in `balance.ts`.

## 6. Buildings (all grid pieces; footprint w×d in cells; placement class)

Placement classes: **flat** (terrain −0.35..0.60), **deep** (below −0.35), **high** (above 0.60, only where noted),
**shore** (flat cell orthogonally adjacent to a high cell), **edge** (deep cell adjacent to a flat cell).

Residential (flat; need walkway link to any market or dock to be "connected"; unconnected houses never fill)
- Hut 1×1, 2 residents, 40$. Starting house.
- House 1×1, 4 residents, 80$.
- Longhouse 2×1, 8 residents, 160$.
- Tall house 1×1, 6 residents, 140$ + 10 planks. Requires sawmill built.
- Houses level up (1→3) when happiness stays above `LEVEL_UP_HAPPINESS` for 3 cycles: +1 resident per level, nicer roof color.

Infrastructure
- Walkway 1×1, 5$. Standard stilts: floor = terrain + `STILT_LENGTH` (0.5). Floods at spring high if terrain < 0.35.
- Raised walkway 1×1, 12$. Floor fixed 1.2. Never floods. 
- Boardwalk 2-wide variant of walkway, 14$/cell pair; walkers move 1.5× faster on it.
- Lantern post 1×1 on any walkway, 8$. Night coverage field (safety + happiness).
- Pier (edge, 1×2 extending seaward), 60$. 2 boat slots. Boats can only depart/return in high water; at low water they sit on the mud.
- Deep dock (deep, 2×2, must touch a walkway via raised walkway or pier), 150$ + 20 planks. 4 slots, works all tide.
- Harbor (deep, 3×3, needs depth < −1.5), 600$ + 60 planks. Trade ship berth + 6 slots. Only one needed.
- Breakwater (deep, per cell, line), 60$ + 4 planks/cell. Shields cells shoreward of it from storm and wave damage.
- Sea wall (shore, per cell), 25$ + 3 timber/cell. Shields flats behind it from tsunami.

Production
- Fishing boat (unit), 80$ (first two purchasable; then shipyard only: 30 planks + 40$). 2 crew. Trip = one high-water phase.
  Yield = `BOAT_BASE_FISH` × fish density at ground × crew fraction × net loft bonus.
- Oyster bed (flat, 1×1, must be under water at high tide and exposed at low: terrain 0.0..0.45), 30$. 2 workers. Produces
  shellfish each low water. Dies if pollution at cell > `OYSTER_POLLUTION_KILL` for 2 cycles.
- Clam camp (flat, 2×1), 70$. 4 workers, roams: harvests shellfish from exposed flat cells within radius 6 at low water.
  Spring low doubles yield.
- Fish market (flat, 2×2), 120$. 3 workers. Sells fish/shellfish each cycle at `PRICE_*`. Emits fish waste → shark risk field.
- Smokehouse (flat, 2×1), 160$. 3 workers. Converts fish → smoked goods. Fire risk source.
- Net loft (flat, 1×1), 90$. +15% yield to boats docked within radius 8.
- Lumber camp (high, 2×1, must be adjacent to a flat cell with a walkway), 100$. 3 workers. Fells trees within radius 7;
  trees regrow over `TREE_REGROW_CYCLES`. Produces timber.
- Sawmill (flat or high, 2×2), 180$. 3 workers. timber → planks.
- Shipyard (edge, 3×2), 300$ + 40 planks. 5 workers. Builds a boat every `SHIPYARD_CYCLES` if planks available; assigns to a dock with a free slot.
- Warehouse (flat, 2×2), 120$. +100 cap on all goods.

Services (each has a coverage radius written into a field)
- Sewage outfall (edge, 1×1), 40$. Houses generate waste. Without an outfall waste piles up (happiness −). Outfall dumps
  waste into the pollution field at its cell each tick; the tide carries it (§8).
- Treatment plant (flat or high, 2×2), 350$. 4 workers. Neutralizes waste of houses within radius 12 before it reaches an outfall.
- Lifeguard tower (shore, 1×1 on a beach cell), 90$. 1 worker. Shark incidents within radius 5 drop 80%.
- Shark nets (deep, per cell line), 20$/cell. Blocks shark risk from crossing.
- Clinic (flat, 2×1), 200$. 3 workers. Heals injured residents (injury → they stop working until healed).
- Fire watch (flat or high, 1×1), 120$. 2 workers. Suppresses fires within radius 8. 
- Well / cistern (flat, 1×1), 50$. Drinking water coverage radius 8; uncovered houses lose happiness.

Leisure & tourism
- Beach: any sand cell above high tide adjacent to water (derived, not built). Residents within radius 10 swim at high water in daytime.
- Bathhouse (shore, 2×1), 130$. Happiness coverage radius 8.
- Tavern (flat, 2×1), 150$. 2 workers. Consumes smoked goods; happiness radius 10; tourists spend here.
- Inn (flat, 2×2), 250$ + 20 planks. Tourists arrive on the trade ship if an inn has room; each spends `TOURIST_SPEND` per cycle at tavern/bathhouse/beach.
- Lighthouse (high or edge, 1×1), 400$. Boats never lost in storms; trade ship visits every 2 cycles instead of 3.
- Shrine (flat, 1×1), 60$. Small happiness radius; purely for pretty.
- Market square (flat, 2×2, must touch fish market), 100$. Happiness + walkers linger here.

## 7. People

- Population lives in houses. New residents move in at the start of each cycle when: connected housing is free, town
  happiness ≥ `IMMIGRATION_HAPPINESS`, and food stock > 0. Arrive by trade ship if a harbor exists, otherwise walk in from the largest pier.
- Jobs: each production/service building has a worker count. Workers are assigned each cycle by nearest-first over the
  walkway graph (BFS distance from home). Unfilled jobs scale output by the filled fraction.
- Happiness (per house, averaged for town): food, water coverage, job within reach, pollution at home, lantern/night
  coverage, leisure coverage, injuries and fires nearby, damaged buildings nearby. Formula in `balance.ts`.
- Injuries: shark incidents and fires injure residents; clinic heals over cycles; uninjured residents work.
- View: each worker has a home cell and a work cell. At shift change, spawn a walker that follows the graph path
  (precomputed BFS, cached per pair) and despawns on arrival. Cap live walkers at `MAX_WALKERS` (200); beyond that, sample.
  Walkers are thin instances of one 3-primitive figure (body box, head sphere, hat cone) with per-instance color.
  Idle walkers loiter on market square and beach. Swimmers are walkers bobbing on the water at beach cells at high water.
  Kids (small walkers) appear near houses at level 2+.

## 8. Fields and the tide's effect on them

- **pollution**: sources = outfalls (untreated waste), smokehouses (small), docks (small). Each tick: decay ×`POLLUTION_DECAY`,
  diffuse to 4 neighbors, and **advect** with the tide: rising tide pushes shoreward (toward flats), falling tide pulls seaward.
  Pollution on flat cells kills oyster beds and lowers house happiness; on deep cells it reduces fish density regen.
- **fishDensity** (deep cells only): regenerates toward `FISH_CAP` × (1 − pollution); boats deplete the ground they fish;
  boats pick the richest reachable ground within `BOAT_RANGE` of their dock.
- **sharkRisk**: sources = fish market and docks (fish waste); decays; blocked by net cells. Incident chance at beach
  cells with swimmers = risk × swimmers × (night ×2), reduced by lifeguard coverage.
- **fireRisk**: smokehouses, taverns, lanterns raise it; rain (storms) zero it; fire watch lowers it. Fire ignites with
  chance ∝ risk, spreads along adjacent wooden pieces each tick until watched or burnt out; burnt buildings are damaged.
- **coverage fields**: one per service type (water, leisure, night, lifeguard, treatment, firewatch), rebuilt on placement.
- Overlays: any field can be shown as a color tint on the grid cells (view layer).

## 9. Events and damage

- **Storm** (chance `STORM_CHANCE` per cycle after cycle 6, never two in a row): sky/light lerps toward the study's dusk
  palette, wave amplitude uniform ×3, boats don't sail; boats at piers/docks outside breakwater shelter have `STORM_LOSS_CHANCE`
  of being lost (unless lighthouse). Lasts one cycle. Fire risk zero during storm.
- **Spring high flooding**: standard walkways with terrain < 0.35 are cut for the high-water phase (network breaks; workers can't reach); no damage.
- **Tsunami** (after cycle 20, chance `TSUNAMI_CHANCE` per cycle, min `TSUNAMI_COOLDOWN` cycles apart): 20 s foreshadow
  where the tide plunges to −1.2 (flats dry far out, boats heel over on the mud, notification "the sea is pulling back"),
  then a wave uniform sweeps across the water plane from the deep side; on impact every building on a cell whose floor is
  below `WAVE_HEIGHT` (1.4) and not shielded by a sea wall or breakwater (ray from the deep side along the wave axis) is damaged.
  Boats outside shelter are lost.
- **Damaged** buildings stop producing; repair costs `REPAIR_FRACTION` of build cost in money + timber, paid automatically
  when affordable, otherwise they sit damaged (darker tint, tilted roof). Burnt = damaged.

## 10. Trade

- Trade ship visits the harbor every `TRADE_EVERY` cycles at high water, stays one phase, buys smoked goods and surplus fish
  at `TRADE_PRICE_*` (above market), sells planks at `TRADE_PLANK_PRICE` if the player has queued a purchase, and drops off
  tourists (if inn capacity) and immigrants. Visible: a larger ship with a sail enters from the deep edge along a path to the berth.

## 11. UI

- Resource bar (money, fish, shellfish, smoked, timber, planks, population/jobs, happiness).
- Tide clock: dial with current level, high/low markers, next event (spring tide, storm warning, trade ship ETA).
- Build menu by category (Homes, Streets, Sea, Production, Services, Leisure) with cost, and greyed when unaffordable or unmet prerequisite (with reason).
- Ghost preview with placement validity and, for tide-sensitive pieces, a fate tint (safe / spring-floods / floods every tide).
- Click a building: info panel (workers filled/needed, output last cycle, status: working / idle: no workers / cut / damaged / polluted).
- Overlays toggle: pollution, fish density, shark risk, fire risk, happiness, water coverage.
- Notifications feed (immigrants arrived, oyster bed died, shark incident, boat lost, storm coming, the sea is pulling back).
- Speed: pause / 1× / 2× / 4×. Time is game time; the tide period is in game seconds.
- Camera: orbit, zoom, pan (drag with middle/right or WASD). Edge scroll off by default.
- Save/load: autosave to localStorage every cycle; manual save slots (3); load on start if present; "new town" resets.
- Start: 500$, 2 boats available to buy, a hut, a pier suggestion highlighted. Short 5-step tutorial via notifications.

## 12. Audio (last)
Procedural only (Web Audio): filtered noise for surf whose gain follows tide level and storm; a soft bell on shift change; a
low thrum for the tsunami drawdown. No samples. Mute button. Starts on first click.

## 13. Layout
```
src/
  main.ts                 bootstrap, loop (sim tick + render), dev console API window.__tidewater
  config.ts               sizes, tide constants, day length, caps
  world/                  terrain, water, sky, lighting, trees (from sessions 1–2)
  sim/                    ledger: state.ts, rng.ts, balance.ts, tide.ts, buildings.ts (catalog + factories of sim entries),
                          grid.ts, network.ts, fields.ts, workers.ts, economy.ts, people.ts, events.ts, trade.ts, save.ts
  view/                   meshes for pieces (pieces/*.ts), walkers.ts, boats.ts, overlays.ts, effects.ts (storm, wave, fire, damage)
  ui/                     hud.ts, buildMenu.ts, infoPanel.ts, notifications.ts, tideClock.ts, overlaysToggle.ts, saveMenu.ts
  build/                  placement.ts (picking, ghost, validation → sim)
shaders/                  water, sky, terrain (verbatim from reference + new uniforms only)
test/                     smoke.ts (Playwright headless scenario), sim.test.ts (sim-only unit checks, no Babylon)
reference/                tidewater-study.html
```
