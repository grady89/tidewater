# Tidewater — handoff

Where things stand at the end of the overnight build of 2026-09-26. ROADMAP.md is finished: M0–M14 and all seven
backlog items are DONE, nothing is BLOCKED. Read CLAUDE.md first; NOTES.md has every decision the brief didn't
make, section by section; PROGRESS.md has the per-milestone status, commit hashes and fps. This file is the
summary. The 31 commits from `85f44e9` (brief v2) to `ee5c2f1` are local — nothing from this run has been pushed.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (5173 belongs to another project on this machine)
npm run build      # tsc --noEmit + vite build → dist/
npm run test       # vitest: 49 sim-only checks (no Babylon in src/sim, enforced by a test)
npm run smoke      # headless Chrome (the installed one, GPU on) plays every milestone, asserts, shoots shots/
```

The smoke takes about five minutes and ends with `smoke OK`. Its console lines are the quickest health check of
the whole game: starter-town economy, spring tides, boats/walkers/gulls/crabs, the wood chain, pollution,
leveling and districts, sharks, trade, the isle and ferry, fire, storm and tsunami, the 300-building town with
reflections on, audio, caustics, achievements, reload.

Console API in dev builds: `window.__tidewater` — `sim` (the ledger), `grid`, `fields`, `place(kind, i, j)`,
`remove`, `select`, `blockerAt`, `district`, `setTide`, `advance(cycles)`, `advanceTo(fraction)`, `tickSeconds`,
`setSpeed`, `grant`, `orderPlanks`, `ignite`, `forceStorm`, `forceTsunami`, `frameTown`, `frameAt`, `setOverlay`,
`setReflections`, `setCaustics`, `brightness(x, y, w, h)`, `save`, `load`, `newTown`, `stressWalkers`, and
read-only `view.*` probes (boats, walkers, swimmers, fins, ship, ferry, burning, gulls, crabs, chunks, roofs,
reflections, caustics, isleOpen, achievementsShown, audio).

## What exists

| Area | Where | What |
| --- | --- | --- |
| Ledger | `src/sim/` | One plain `SimState` (JSON, version 2), fixed 1/20 s tick, seeded RNG. Grid index over buildings; 64×64 fields for pollution, fish, shark risk, fire risk and service coverages, drifting with the tide. |
| Tide | `sim/tide.ts` | 120 s cycles, eased between extremes, every 4th a spring tide (0.85 / −0.55). High water > 0.25, low < 0. |
| Buildings | `sim/balance.ts` | 31 kinds in one catalog: footprint, placement class, terrain window, cost, jobs, residents, upkeep, floor rule, network role, service coverage, prerequisites. |
| Economy | `economy.ts`, `workers.ts`, `trade.ts` | Settlement at each peak: nearest-first jobs over the walkway graph, food reserve, market sales, wood → planks, smokehouse, shipyard, warehouse caps, net loft, taxes/upkeep, immigration, tourism and the trade ship. |
| Hazards | `pollution.ts`, `sharks.ts`, `fire.ts`, `events.ts` | Outfall waste drifting to oyster beds; fish waste → shark risk → incidents; fire risk → ignition/spread/repair; storms; the tsunami with breakwater/sea-wall shielding. |
| Districts, isle, achievements | `districts.ts`, `isle.ts`, `achievements.ts` | Named clusters derived on demand; a second island blended into the heightfield and locked until a harbor; nine milestones kept in the state. |
| View | `src/view/` | Buildings merged per 8×8 chunk (300 buildings → 15 meshes); thin instances for trees, walkers, boats, lanterns, fins, flames, smoke, gulls, crabs; the trade ship and the ferry; one overlay mesh. Reads the ledger, writes nothing. |
| World | `src/world/`, `shaders/` | The study's terrain/water/sky. The water shader's original math is intact; it gained uniforms for the storm swell, the tsunami crest, a planar reflection (`reflectMix`) and caustics (`caustics`). Day/night from the study's lerp. |
| UI | `src/ui/` | Resource bar, build menu with greyed reasons, tide clock, ledger line, info panel (with district), notifications, tutorial, achievement popup, speed bar with mute, reflections toggle and Town menu (3 save slots, new town). |
| Tests | `test/` | `sim.test.ts` (49), `scenario.ts` (shared scripted towns for both harnesses), `smoke.ts`. |

## Measured

- Headless Chrome on an RTX 4060 Laptop: 165 fps (the display cap) in every milestone's smoke, including the
  300-building / 30-boat / 200-walker town with reflections on every frame. A saved 300-building town reloads
  in ~0.6 s. **Integrated graphics are still unmeasured** — the whole 60 fps claim rests on one GPU.
- Before the chunk merge, reflections cost 311 draw calls a second time and dropped that town to 62 fps; the
  merge (15 chunk meshes + 2 lantern instance sets) is what made both the mirror and the headroom.
- Starter town (500$): pier, two boats, walkways, three huts, market, outfall — ends the build with ~4$ and nets
  about +50$ over four cycles. First shipyard boat at cycle 10–11. A serviced home reaches level 3 by cycle 7–8.

## Known-broken and rough edges

- **Shark-net floats sit at a fixed height** (y = 0.15) and hang in the air at spring low / drawdown.
- **Sky is black below the horizon** — `pow` of a negative in `skyFS`, inherited from the study; a one-character
  clamp fixes it if you are willing to touch that shader.
- **Sea wall is placed on any flat cell**, not the brief's "shore" class (NOTES M11 says why).
- **Outfalls need no walkway** (sewers assumed); docks in open water are "reached" by definition and only get crew
  when a raised walkway or pier touches them.
- **Tsunami damage is blunt**: every floor under 1.4 that isn't behind a wall, walkways included; a big town loses
  most of its street in one wave and the repair fund then eats money and timber for cycles.
- **Workers never cross the ferry.** The isle is a second town on its own pier sharing money, food and
  immigration; the ferry is decoration. Fine for a first foothold, wrong if you expected commuters.
- **A district renames itself when its oldest building goes** (the name is hashed from the lowest id). Storing
  names in the state would fix it; it was left derived on purpose.
- **Caustics are subtle** at the study's shallow-water alpha (0.34) — most of a shallow pixel is terrain. The
  smoke's A/B delta is ~1.5/255. Push `caustics * 1.1` in the shader if you want them to read from the default
  camera height.
- Reflections skip walkers, lantern spheres, fins, flames and smoke (by mesh name in `world/water.ts`), and the
  mirror plane is the still-water level: the swell and the tsunami crest are not reflected.
- The bell rings at every shift change including at night; there is no other sound design.
- Immigration and jobs: with only huts a town caps early; the tutorial nudges toward a market and houses but
  nothing tells the player that *jobs* are what unhappy idle residents want.

## Balance observations from the smoke runs

- The stilt rule is the whole game: standard walkways on terrain < 0.1 are under water at every settlement and
  their street is dead; 0.1–0.35 dies at spring peaks. Raised walkways (12$) on anything not "safe" is the only
  robust way to build on the shoreline, and every scripted town does exactly that.
- Diffusion, not emission, is the sensitive knob in every field. Pollution at 12 %/s spread to nothing; 3 %/s gives
  an outfall cell ≈1 and neighbours ≈0.4. Fire at 2 %/s never crossed the ignition threshold; 0.5 %/s lets three
  smokehouses reach ≈1.5. Shark risk wants the opposite: 8 %/s with slow decay so the plume reaches a beach.
- Markets must keep a food reserve, or they sell every fish at the peak and immigration (needs food > 0) stops.
- The no-outfall penalty must accumulate rather than land flat, or a fresh town never crosses the immigration bar.
- The main island's flats hold about 160 filled jobs and ~260 buildings; the isle adds ~90 land cells of flats
  with a small high knob — room for a second street, not a second city.
- Storms after cycle 6 take boats from unsheltered piers often enough that every scripted scenario shelters its
  harbours with one breakwater cell 2–3 out (a full ring walls the boats in — the sea BFS can't pass built cells).
- The boats' first landing settles on the third peak, not the second: the clock starts at high water so the
  first shift never fires. Anything that waits for "first catch" needs three cycles.

## The three things to do next

1. **Play it for an hour and retune by feel.** Every number came from making a check pass. Prices, upkeep,
   `IMMIGRANTS_PER_CYCLE`, the fire/shark/pollution diffusion rates and the tsunami's blunt damage are the first
   candidates, and the tutorial should say the word "jobs".
2. **Measure on integrated graphics.** The 60 fps target has only been seen on a 4060 at the 165 fps cap. If it
   falls short: drop bloom, then the mirror resolution, then walker count; the chunk merge is already in.
3. **Let the ferry carry people.** An edge from the harbor to the isle's pier in `distanceField` (cost = a few
   cells) would let isle homes staff mainland jobs and vice versa, and the ferry timetable could gate it.

## Ideas backlog (beyond ROADMAP)

- Named districts the player can rename (needs a text input and a `districts` table in the state).
- Reflect the swell: pass the wave height into the mirror plane or fake it with the normal offset already there.
- Seasonal light: the day/night lerp is a single slider; a longer cycle over many tides would give weather a
  mood without touching the shader math.
- Achievement gallery in the Town menu (the ids and titles are already in `sim/achievements.ts`).
- Ferry passengers as walkers on the deck; gulls following the trade ship in.
