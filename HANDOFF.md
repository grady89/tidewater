# Tidewater — handoff

Where things stand after the overnight build (ROADMAP M0–M14 + backlog 1–7, all DONE, nothing BLOCKED) and the
daytime playtest session that followed it on 2026-09-26 — nine rounds of Grady's feedback, an art pass from
their Midjourney reference sheets, and the systems those turned up. Read CLAUDE.md first; NOTES.md has every
decision the brief didn't make, section by section (the playtest sections are at the end, before "Chunk merge");
PROGRESS.md has the per-milestone status and run log. This file is the summary. The 41 commits from `85f44e9`
(brief v2) to `c149d07` are local — nothing from either session has been pushed.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (5173 belongs to another project on this machine)
npm run build      # tsc --noEmit + vite build → dist/
npm run test       # vitest: 60 sim-only checks (no Babylon in src/sim, enforced by a test)
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
`load`, `saveJson`, `newTown`, `stressWalkers`, `placement`, and read-only `view.*` probes (boats, walkers,
porters, swimmers, fins, ship, ferry, burning, gulls, crabs, chunks, roofs, reflections, caustics, isleOpen,
achievementsShown, audio, sky, camera, category, pierMarker, hint).

## What exists

| Area | Where | What |
| --- | --- | --- |
| Ledger | `src/sim/` | One plain `SimState` (JSON, version 2 — `deserialize` rejects saves missing fields and fills the ones it can), fixed 1/20 s tick, seeded RNG. Grid index over buildings with landfill re-applied on attach; 64×64 fields for pollution, fish, shark risk, fire risk and service coverages. |
| Tide & day | `sim/tide.ts`, `sim/daylight.ts` | 120 s cycles, spring every 4th. A day is 2 tides: the sun rises at the day's start, noon at ¼, sets at ½, moon and stars after. |
| Buildings | `sim/balance.ts` | 33 kinds in one catalog (paths and the land tools are new); placement classes, floors (`stilts` snap to neighbours and take a player lift), network roles, service coverage. |
| Economy | `economy.ts`, `workers.ts`, `trade.ts`, `loan.ts` | Settlement at each peak: jobs, food reserve, market (warns when it sells nothing and why), wood → planks, smokehouse, shipyard, warehouse caps, taxes/upkeep, loan instalment, immigration, tourism, trade ship. Refunds on removal. |
| Hazards | `pollution.ts`, `sharks.ts`, `fire.ts`, `events.ts` | Waste → outfalls → oyster beds; fish waste → shark risk → incidents; fire; storms; the tsunami with breakwater/sea-wall shielding. |
| Land, districts, isle, achievements | `land.ts`, `districts.ts`, `isle.ts`, `achievements.ts` | Landfill / plant / clear; named clusters; the second island behind a harbor; nine milestones. |
| Placement | `src/build/` | Ghost with flood fate, drag-to-paint runs, deck lift with `[ ]`, dock access rule, connectivity caution, refund on right-click, pier-site marker. Camera in the Cities: Skylines mold (grab-pan, right-drag orbit, wheel to cursor, WASD/QE/RF, eased). |
| View | `src/view/` | Every asset rebuilt from `reference/` sheets: buildings from a small kit (gable/hip roofs, shuttered windows, blue doors, railings, lanterns…) merged per 8×8 chunk; thin instances for trees (three-tier conifers), walkers (hat, tunic, basket for porters), boats (with net floats while fishing), gulls with flapping wings, crabs, lanterns, fins, flames, smoke; the trade ship and the ferry. Reads the ledger, writes nothing. |
| World | `src/world/`, `shaders/` | The study's terrain/water/sky. Additions are uniforms and additive terms only: storm swell, tsunami crest, reflection (`reflectMix`), caustics, terrain `clipY` for the mirror pass, sky moon/stars. One fix to the study: the horizon clamp. Terrain keeps a height grid (landfill raises it) and exposes `heightAt`, which every prop uses through `view/ground.ts`. |
| UI | `src/ui/` | Resource bar, build menu (7 tabs incl. Land), tide clock, ledger line, order-planks and borrow buttons, info panel (district, "fishing N cells out"), notifications, 6-step walkthrough card that pulses the tab and tool, achievement popup, speed bar with mute and reflections, Town menu (3 slots). |
| Audio | `view/audio.ts` | Procedural only: surf, shift bell, tsunami thrum, a breathing pad, gull cries scaled by the flock, shipyard hammering. |
| Tests | `test/` | `sim.test.ts` (60), `scenario.ts` (shared scripted towns), `smoke.ts`. |

## Measured

- Headless Chrome on an RTX 4060 Laptop: 165 fps (the display cap) everywhere, including the 300-building town
  with reflections on every frame. A 300-building town reloads in ~0.6 s. **Integrated graphics still unmeasured.**
- Starter town from 650$: pier, two boats, walkways, three huts, market, outfall — ends the build with ~175$ and
  nets +50$ over four cycles. First shipyard boat at cycle 10–11.

## Known-broken and rough edges

- **Shark-net floats sit at a fixed height** (y = 0.15) and hang in the air at spring low / drawdown.
- **People are still a touch large** (0.62 → ≈0.37 of a cell; Cities: Skylines is ≈0.22). `PERSON_SCALE` in
  `view/walkers.ts`. Everything else about them (hats, baskets) scales with it.
- **Wall colour** comes from the five-hex palette per building; the reference sheets lean on white walls with
  red/blue roofs, so a street is more varied than the sheets. Bias `PALETTE.walls` if you want the sheet look.
- **Workers never cross the ferry.** The isle is a second town on its own pier; the ferry is decoration.
- **A district renames itself** when its oldest building goes (name hashed from the lowest id).
- **Tsunami damage is blunt**: every floor under 1.4 not behind a wall, walkways included.
- **Sea wall is placed on any flat cell**, not the brief's "shore" class (NOTES M11).
- **Landfill cells are permanent** (no un-fill) and the fill has a one-grid-step skirt; two adjacent fills
  read as one block, which is fine, but a fill next to the hill leaves a small ledge.
- Reflections skip walkers, lanterns, fins, flames, smoke, gulls; the mirror plane is the still-water level.
- The bell rings at every shift change including at night.

## Balance observations from the playtests

- The market's three silent failure modes — under water at the peak, no walkway to a pier, no workers — were the
  #1 confusion in play ("I have a market, fish and residents and I'm losing money"). The game now says which;
  the fix for the first is `]` to lift the deck or a raised walkway.
- 500$ seed money was exact for the scripted start and cruel for a person; 650 leaves slack for two wrong
  walkways. The loan (300$, 360$ back over 15 tides) is the other way out; the "stuck" hint offers both.
- The stilt rule is still the whole game: standard walkways on terrain < 0.1 flood every tide, 0.1–0.35 at
  springs; the snap (`WALKWAY_SNAP` 1.2) keeps a run level on the way down, and `[ ]` lifts it on purpose.
- Diffusion, not emission, is the sensitive knob in every field (NOTES M6/M8/M10 for the numbers).
- The island's flats hold ~160 filled jobs and ~260 buildings; the isle adds ~90 land cells.
- Boats must fish at least 7 cells out (`BOAT_MIN_RANGE`) or they never visibly leave the pier.

## The three things to do next

1. **Play the walkthrough end to end** with a mouse, no console. The card, the pier ring, the lift key and the
   market warnings have each been checked in isolation; nobody has followed all six steps cold.
2. **Measure on integrated graphics.** The 60 fps target has only been seen on a 4060 at the cap. If short: drop
   bloom, then reflections resolution, then walker count; the chunk merge is already in.
3. **Let the ferry carry workers** (an edge harbor → isle pier in `distanceField`), and give the tsunami a
   cycle of warning and walkways an exemption or a cheap rebuild.

## Ideas backlog

- Named districts the player can rename; un-fill for landfill; a shark-net float that follows the water.
- Reflect the swell; seasonal light on a longer cycle than the day.
- An achievement gallery in the Town menu; ferry passengers on the deck; gulls following the trade ship in.
- Real recorded ambience is a policy change (the brief says procedural) — the pad and gulls are where a sample
  pack would go if that changes.
