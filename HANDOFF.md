# Tidewater — handoff

Where things stand after the overnight build of 2026-09-26 (brief v2, ROADMAP M0–M14). Read CLAUDE.md first;
NOTES.md has every decision the brief didn't make, milestone by milestone; PROGRESS.md has the per-milestone
status, commit hashes and fps. This file is the summary.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (5173 belongs to another project on this machine)
npm run build      # tsc --noEmit + vite build → dist/
npm run test       # vitest: 42 sim-only checks (no Babylon in src/sim, enforced by a test)
npm run smoke      # headless Chrome (the installed one, GPU on) plays every milestone, asserts, shoots shots/
```

The smoke takes about four minutes and ends with `smoke OK`. Its console lines are the quickest health check of
the whole game: starter-town economy, spring tides, boats and walkers, the wood chain, pollution, leveling, sharks,
trade, fire, storm and tsunami, the 300-building town, audio.

Console API in dev builds: `window.__tidewater` — `sim` (the ledger), `grid`, `fields`, `place(kind, i, j)`,
`remove`, `select`, `setTide`, `advance(cycles)`, `advanceTo(fraction)`, `tickSeconds`, `setSpeed`, `grant`,
`orderPlanks`, `ignite`, `forceStorm`, `forceTsunami`, `frameTown`, `frameAt`, `setOverlay`, `save`, `load`,
`newTown`, `stressWalkers`, and read-only `view.*` probes (boats, walkers, swimmers, fins, ship, burning, audio).

## What exists

Everything in ROADMAP M0–M14 is DONE; nothing is BLOCKED. The backlog beyond M14 is untouched (see the end).

| Area | Where | What |
| --- | --- | --- |
| Ledger | `src/sim/` | One plain `SimState` (JSON-serializable), fixed 1/20 s tick, seeded RNG. Grid index over buildings; 64×64 fields for pollution, fish density, shark risk, fire risk and six service coverages, all drifting with `fields.stepDrift`. |
| Tide | `sim/tide.ts` | 120 s cycles, eased between extremes, every 4th a spring tide (0.85 / −0.55). High water > 0.25, low < 0. |
| Buildings | `sim/balance.ts` | 31 kinds in one catalog: footprint, placement class, terrain window, cost, jobs, residents, upkeep, floor rule, network role, service coverage, prerequisites. |
| Economy | `sim/economy.ts`, `workers.ts`, `trade.ts` | Settlement at each peak: nearest-first jobs over the walkway graph, food reserve, market sales, wood → planks, smokehouse, shipyard, warehouse caps, net loft, taxes/upkeep, immigration, tourism and the trade ship. |
| Hazards | `pollution.ts`, `sharks.ts`, `fire.ts`, `events.ts` | Waste → outfalls → drifting pollution that kills oyster beds; fish waste → shark risk → incidents/injuries; fire risk → ignition/spread → damage → auto-repair; storms; the tsunami. |
| View | `src/view/` | One merged mesh per building (rebuilt when level/lantern/damage changes); thin instances for trees, walkers, boats, fins, flames, smoke; the trade ship; one overlay mesh; effects. Reads the ledger, writes nothing. |
| World | `src/world/`, `shaders/` | The study's terrain/water/sky, byte-identical fragment shaders; the water vertex shader gained `waveAmp` and a Gaussian crest for storms/tsunami. Day/night from the study's lerp. |
| UI | `src/ui/` | Resource bar, build menu by category with greyed reasons, tide clock (spring, ship, events), ledger line, info panel, notifications, tutorial + empty-state hints, speed bar with mute and Town menu (3 save slots, new town). |
| Tests | `test/` | `sim.test.ts` (42), `scenario.ts` (shared scripted towns, imported by both harnesses), `smoke.ts`. |

## Measured

- Headless Chrome on an RTX 4060 Laptop: 165 fps in every milestone's smoke, 164.8 fps with 300 buildings, 30
  boats and 200 walkers; a saved 300-building town reloads in ~0.6 s. Integrated graphics are unmeasured.
- Starter town (500$): pier, two boats, walkways to the free hut, two huts, market, outfall — ends the build
  with ~4$ and nets about +50$ over the first four cycles. First shipyard boat at cycle 10–11 with a camp,
  sawmill and second pier. A home with well, shrine and lanterns reaches level 3 by cycle 7–8.

## Known-broken and rough edges

- **Shark-net floats sit at a fixed height** (y = 0.15) and hang in the air at spring low / drawdown.
- **Sky is black below the horizon** — `pow` of a negative in `skyFS`, inherited from the study; a one-character
  clamp fixes it if you are willing to touch the shader.
- **Lantern spheres** are one small mesh per building (not instanced); fine at 300 buildings, untested beyond.
- **The per-chunk static merge** from M12 was not done: the fps target held without it. If integrated graphics
  fall short, that and instanced lanterns are the first two moves.
- **Sea wall is placed on any flat cell**, not the brief's "shore" class (see NOTES M11 for why).
- **Outfalls need no walkway** (sewers assumed); docks in open water are "reached" by definition and only get crew
  when a raised walkway or pier touches them.
- **Tsunami damage is blunt**: every floor under 1.4 that isn't behind a wall, including walkways; a big town
  loses most of its street in one wave and the repair fund then eats money and timber for cycles.
- Immigration and jobs: with only huts, a town caps early; the tutorial nudges toward a market and houses but
  nothing tells the player that *jobs* are what unhappy idle residents want.
- No sound design beyond the three procedural voices; the bell rings at every shift change including at night.

## Balance observations from the smoke runs

- The stilt rule is the whole game: standard walkways on terrain < 0.1 are under water at every settlement and
  their street is dead; 0.1–0.35 dies at spring peaks. Raised walkways (12$) on anything not "safe" is the only
  robust way to build on the shoreline, and every scripted town does exactly that.
- Diffusion, not emission, is the sensitive knob in every field. Pollution at 12 %/s spread to nothing; 3 %/s gives
  an outfall cell ≈1 and neighbours ≈0.4. Fire at 2 %/s never crossed the ignition threshold; 0.5 %/s lets three
  smokehouses reach ≈1.5. Shark risk wants the opposite: 8 %/s with slow decay so the plume reaches a beach.
- Markets must keep a food reserve, or they sell every fish at the peak and immigration (needs food > 0) stops.
- The no-outfall penalty must accumulate rather than land flat, or a fresh town never crosses the immigration bar.
- The island's flats hold about 160 filled jobs and ~260 buildings; anything beyond that is breakwaters.
- Storms after cycle 6 take boats from unsheltered piers often enough that every scripted scenario shelters its
  harbours with one breakwater cell 2–3 out (a full ring walls the boats in — the sea BFS can't pass built cells).

## The three things to do next

1. **Play it, with a controller in hand, for an hour.** Nothing above was tuned by feel; every number came from
   making a check pass. The first playtest will want `IMMIGRANTS_PER_CYCLE`, prices and upkeep moved.
2. **Instance the lanterns and merge per chunk**, then measure on integrated graphics; that is the stated target
   and it has not been seen.
3. **Give the tsunami and storms a fair warning and a fair repair**: a cycle of notice, walkways exempt from wave
   damage or cheap to rebuild, and a repair queue the player can see.

## Backlog (ROADMAP, in order) — not started

1. Planar reflections on the water (MirrorTexture) behind a quality toggle.
2. Caustics in the shallows (new uniform + noise in the water shader's shallow band, additive only).
3. Seagulls (thin instances circling docks), crabs on exposed flats at low water.
4. Building variety: 3 roof shapes per house level, randomized per placement (seeded).
5. Districts: name a cluster; district stats in the info panel.
6. Second island unlock via harbor (ferry).
7. Achievements/milestones popups (first boat, 50 residents, first trade).
