# Tidewater — handoff

Where things stand after the overnight build (ROADMAP M0–M14 + backlog 1–7, all DONE, nothing BLOCKED) and the
daytime playtest session that followed it on 2026-09-26 — nine rounds of Grady's feedback, an art pass from
their Midjourney reference sheets, and the systems those turned up. Read CLAUDE.md first; NOTES.md has every
decision the brief didn't make, section by section (the playtest sections are at the end, before "Chunk merge");
PROGRESS.md has the per-milestone status and run log. This file is the summary. Everything through this commit
is pushed to `origin/main` (github.com/grady89/tidewater).

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (5173 belongs to another project on this machine)
npm run build      # tsc --noEmit + vite build → dist/
npm run test       # vitest: 75 sim-only checks in eight files (no Babylon in src/sim, enforced by a test)
npm run fuzz       # the sim fuzzer: 50 seeds × 2000 cycles of random actions, invariants every cycle (≈ an hour on 25 cores)
npm run monkey     # 15 minutes of random real input in headless Chrome; --minutes 1 for a quick pass
npm run quality    # the three quality presets measured on the software renderer (--gpu for the real one)
npm run check:dist # the built site under /tidewater/ loads with no 404s (what CI runs before publishing)
npm run smoke      # headless Chrome (the installed one, GPU on) plays every milestone, asserts, shoots shots/
```

The smoke takes about six minutes and ends with `smoke OK`. Its console lines are the quickest health check of
the whole game: starter-town economy, the walkthrough card, camera and drag-to-lay driven with real pointer
events, deck lift, spring tides, boats/porters/gulls/crabs, midnight and noon skies, the wood chain, pollution,
leveling and districts, sharks, trade, the isle and ferry, fire, storm and tsunami, the 300-building town with
reflections on, audio and gull cries, loans, landfill, caustics, achievements, reload.

Console API in dev builds: `window.__tidewater` — `sim` (the ledger), `grid`, `fields`, `place(kind, i, j)`
(kinds plus `boat`, `lanternPost`, `landfill`, `plantTree`, `clearTree`), `remove`, `select`, `blockerAt`,
`district`, `setTide`, `advance(cycles)`, `advanceTo(fraction)`, `tickSeconds`, `setSpeed`, `grant`, `orderPlanks`,
`takeLoan`, `ignite`, `forceStorm`, `forceTsunami`, `frameTown`, `frameAt(x, z, dist, yaw, beta)`, `screenOf`,
`groundAt`, `terrainHeight`, `setOverlay`, `setReflections`, `setCaustics`, `brightness`, `audioCry`, `save`,
`load`, `saveJson`, `newTown(seed)`, `stressWalkers`, `placement`, and read-only `view.*` probes (boats, walkers,
porters, swimmers, fins, ship, ferry, ferryTerminals, commuters, riders, burning, gulls, crabs, netFloats,
personScale, chunks, roofs, reflections, caustics, isleOpen, island, achievementsShown, audio, sky, camera,
category, pierMarker, hint).

## What exists

| Area | Where | What |
| --- | --- | --- |
| Ledger | `src/sim/` | One plain `SimState` (JSON, version 2 — `deserialize` rejects saves missing fields and fills the ones it can), fixed 1/20 s tick, seeded RNG. Grid index over buildings with landfill re-applied on attach; 64×64 fields for pollution, fish, shark risk, fire risk and service coverages. |
| Tide & day | `sim/tide.ts`, `sim/daylight.ts` | 120 s cycles, spring every 4th. A day is 2 tides: the sun rises at the day's start, noon at ¼, sets at ½, moon and stars after. |
| Buildings | `sim/balance.ts` | 33 kinds in one catalog (paths and the land tools are new); placement classes, floors (`stilts` snap to neighbours and take a player lift), network roles, service coverage. |
| Economy | `economy.ts`, `workers.ts`, `trade.ts`, `loan.ts` | Settlement at each peak: jobs, food reserve, market (warns when it sells nothing and why), wood → planks, smokehouse, shipyard, warehouse caps, taxes/upkeep, loan instalment, immigration, tourism, trade ship. Refunds on removal. |
| Hazards | `pollution.ts`, `sharks.ts`, `fire.ts`, `events.ts` | Waste → outfalls → oyster beds; fish waste → shark risk → incidents; fire; storms; the tsunami — "the sea is uneasy" a tide ahead, then the wave, with breakwater/sea-wall shielding and walkways rebuilt first. |
| Land, districts, isle, achievements, islands | `land.ts`, `districts.ts`, `isle.ts`, `achievements.ts`, `island.ts` | Landfill / plant / clear; named clusters; the second island behind a harbor; nine milestones; seeded main islands (validated for flats, pier/harbor sites and trees, rerolled until they pass; seed 0 is the original). |
| Placement | `src/build/` | Ghost with flood fate, stilt length and price (stilts size themselves to clear the tide), a door tab (buildings face the street on their own; R turns them), drag-to-paint runs, deck lift with `[ ]` above that height, dock access rule, connectivity caution, refund on right-click, pier-site marker. Camera in the Cities: Skylines mold (grab-pan, right-drag orbit, wheel to cursor, WASD/QE/RF, eased). |
| View | `src/view/` | Every asset rebuilt from `reference/` sheets: buildings from a small kit (gable/hip roofs, shuttered windows, blue doors, railings, lanterns…) merged per 8×8 chunk; thin instances for trees (three-tier conifers), walkers (hat, tunic, basket for porters), boats (with net floats while fishing), gulls with flapping wings, crabs, lanterns, fins, flames, smoke; the trade ship and the ferry. Reads the ledger, writes nothing. |
| World | `src/world/`, `shaders/` | The study's terrain/water/sky. Additions are uniforms and additive terms only: storm swell, tsunami crest, reflection (`reflectMix`), caustics, terrain `clipY` for the mirror pass, sky moon/stars. One fix to the study: the horizon clamp. Terrain keeps a height grid (landfill raises it) and exposes `heightAt`, which every prop uses through `view/ground.ts`. |
| UI | `src/ui/` | Resource bar, build menu (7 tabs incl. Land), tide clock, ledger line, order-planks and borrow buttons, info panel (district, "fishing N cells out"), notifications, 6-step walkthrough card that pulses the tab and tool, achievement popup, speed bar with mute, reflections and Quality…, Town menu (3 slots, island seed field + Random, the opt-in playtest log with notes and a JSON export), settings panel (High / Medium / Low, probe-chosen at first launch). |
| Audio | `view/audio.ts` | Procedural only: surf, shift bell, tsunami thrum, a breathing pad, gull cries scaled by the flock, shipyard hammering. |
| Tests | `test/` | 75 sim-only checks in six topic files (`sim`, `economy`, `fields`, `fire`, `town`, `world` `.test.ts`) plus `fuzz.test.ts` and `playtest.test.ts`; `scenario.ts` (shared scripted towns); `smoke.ts`; the QA tools `fuzz.ts` (+ `fuzzCore.ts`, `fuzzWorker.ts`), `monkey.ts`, `quality.ts`, `deploycheck.ts`. ARCHITECTURE.md maps the modules and the tick. |

## Measured

- Headless Chrome on an RTX 4060 Laptop: 165 fps (the display cap) everywhere, including the 300-building town
  with reflections on every frame. A 300-building town reloads in ~0.6 s. **Integrated graphics still unmeasured.**
- Starter town from 650$: pier, two boats, walkways, three huts, market, outfall — ends the build with 143$ under
  the stilt rule and nets +52$ over four cycles (136 / 133 / 160 / 195). First shipyard boat at cycle 10–11.

## Known-broken and rough edges

- **Wall colour** comes from the five-hex palette per building; the reference sheets lean on white walls with
  red/blue roofs, so a street is more varied than the sheets. Bias `PALETTE.walls` if you want the sheet look.
- **The ferry needs a bridged harbor.** Workers cross only once a raised walkway joins the harbor to the street
  (the same link its boat slots need); an unlinked harbor still opens the isle and the ferry still sails, empty.
  The deck riders and the walkers' two-leg commute are not synchronised with each other.
- **A district renames itself** when its oldest building goes (name hashed from the lowest id).
- **Tsunami damage is blunt**: every floor under `WAVE_HEIGHT` (1.4) not behind a wall; walkways are hit too but
  rebuild themselves for their base cost before anything else is repaired.
- **Old saves are not migrated** to the stilt rule: a pre-`rules` town keeps its 1.0 floors and old costs.
- **Landfill cells are permanent** (no un-fill) and the fill has a one-grid-step skirt; two adjacent fills
  read as one block, which is fine, but a fill next to the hill leaves a small ledge. A fill beside a pier
  leaves the pier on a cell that could not take one now (QA.md proposal).
- **The purse can go below zero**: upkeep is taken whether or not there is income, and only `canAfford` stops
  the bleeding. The ledger line shows the minus but nothing says why (QA.md proposal).
- **Pages is not switched on yet.** The CI workflow runs on GitHub (build, tests and the headless `check:dist`
  all green on `main`), but its deploy job fails until someone sets Settings → Pages → Source to "GitHub
  Actions" once; the workflow's own token cannot create the site (a 403 from `configure-pages` with
  `enablement: true`). After that flip, re-run the workflow (Actions → CI → Run workflow) or push, and
  https://grady89.github.io/tidewater/ goes live.
- Reflections skip walkers, lanterns, fins, flames, smoke, gulls; the mirror plane is the still-water level.

## Balance observations from the playtests

- The market's two silent failure modes — no walkway to a pier, no workers — were the #1 confusion in play
  ("I have a market, fish and residents and I'm losing money"). The game now says which. (The third, "under
  water at the peak", went with the stilt rule: buildings size their own stilts and never flood.)
- 500$ seed money was exact for the scripted start and cruel for a person; 650 leaves slack for two wrong
  walkways. The loan (300$, 360$ back over 15 tides) is the other way out; the "stuck" hint offers both.
- The stilt rule is still the whole game, now the other way round: every standard piece sizes its stilts to clear
  the tide (walkways the ordinary peak, buildings the spring peak) and pays 6$ per unit of stilt; only standard
  walkways on terrain under 0.35 flood, and only at a spring tide. The snap (`WALKWAY_SNAP` 1.2) keeps a run level
  and `[ ]` lifts a deck above its own height on purpose.
- Diffusion, not emission, is the sensitive knob in every field (NOTES M6/M8/M10 for the numbers).
- The island's flats hold ~160 filled jobs and ~260 buildings; the isle adds ~90 land cells.
- Boats must fish at least 7 cells out (`BOAT_MIN_RANGE`) or they never visibly leave the pier.

## The three things to do next

1. **Play the walkthrough end to end** with a mouse, no console. The card, the pier ring, the lift key and the
   market warnings have each been checked in isolation; nobody has followed all six steps cold.
2. **Measure on integrated graphics.** The 60 fps target has only been seen on a 4060 at the cap. If short: drop
   bloom, then reflections resolution, then walker count; the chunk merge is already in.
3. **Play the isle with the ferry.** Bridge the harbor, settle the isle, and watch whether the 10-cell crossing
   (`FERRY_COST`) sends the right people across; the two-leg walk and the deck riders were only checked headless.

## Ideas backlog

- Named districts the player can rename; un-fill for landfill.
- Reflect the swell; seasonal light on a longer cycle than the day.
- An achievement gallery in the Town menu; gulls following the trade ship in; the ferry timetable tied to the
  shift bell so the deck riders and the walking commuters are the same people.
- Real recorded ambience is a policy change (the brief says procedural) — the pad and gulls are where a sample
  pack would go if that changes.
