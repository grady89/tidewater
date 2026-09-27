# QA log — Session B (branch `qa`)

Every bug found by the fuzzer, the monkey and the headless checks: fixed or deferred, with a repro. Proposals
that would change a gameplay rule or a balance number are listed as proposals, not made.

## Bugs

| # | Found by | What | Repro | Status |
|---|---|---|---|---|
| 1 | fuzzer, seed 10 cycle 228 | A pier kept 2 crew after the storm took its only boat: the storm roll runs after the settlement at the same peak, so `workers` (and the assignments) said 2 with 0 jobs until the next peak. Harmless to the purse (a boatless pier catches nothing) but the ledger contradicted itself and the walkers still marched to it. | `npm run fuzz -- --start 10 --seeds 1 --cycles 300` → "pier #134 workers 2 > jobs 0" | Fixed: `trimCrew` (workers.ts) drops the excess crew whenever a storm or the wave takes boats; regression test "QA regressions #1" |
| 2 | reading the field code for the perf pass | The tide-drift "flow" (which neighbour is uphill/downhill of each cell) was cached per Grid object in three copies (fire, pollution, sharks) and never rebuilt, but the game reuses its one Grid: after landfill, and after loading a save or starting a new town on another island, pollution, shark risk and fire risk kept drifting along the *old* terrain. The fuzzer missed it because it builds a fresh Grid on every load; in the game every load goes through `grid.attach`. | Fill a cell, tick: the pollution next to it still flows as if the cell were flat; new town on island 7: fields drift along island 0's slopes | Fixed: one `flowFor` in fields.ts keyed on `grid.terrainVersion` (bumped by `attach` and `applyLandfill`); regression test "QA regressions #2" |
| 3 | fuzzer, 50 × 2000: seeds 1, 7, 10, 24, 27, 29, 34, 39, 40, 41, 46 | The pollution field ran past 1.0 (1.02–1.04) on outfall cells of big late towns: the emitter add was unbounded, and with enough waste routed to one outfall it out-ran decay and diffusion. Every reader clamps in use (`min(1, …)` for happiness, `max(0, 1 − p)` for fish), so nothing visibly broke, but the field is a 0..1 fraction everywhere else (overlays, thresholds) and the invariant says so. | `npm run fuzz -- --only 40 --cycles 2000` → "field pollution[1114] = 1.024" at cycle 1977 | Fixed in two steps, pollution only: the outfall emitter add stops at 1; then, because the second full run still failed seeds 7, 40 and 41 (1.04–1.18 through the tide drift: several cells advect into one sink cell), `stepDrift` takes a ceiling and pollution passes 1. Mass above full is dropped, nothing else changes. Fire risk is *not* a fraction — a cluster ignites when its risk climbs past `FIRE_IGNITE_THRESHOLD` = 1.0 (clamping it silenced every fire and failed the M10 test) — so the fuzzer holds fire to finite and ≥ 0, and shark risk (never seen above 1) stays as it was. Regression test "QA regressions #3" in fields.test.ts |

## Proposals (rule or balance changes; not made)

- **The purse goes below zero.** `settleCycle` applies income − expenses unconditionally, so a town with upkeep and
  no sales runs a negative balance (the fuzzer's random towns sit below zero for 7–68 of 300 cycles; the HUD shows
  the minus). Nothing else breaks — `canAfford` blocks every purchase until the purse recovers — but a player has
  no way to know upkeep is what is draining it. Options: cap upkeep at what is in the purse (buildings go unpaid
  and "unmaintained" instead), or let the purse go negative but say so in the ledger line and the stuck hint. The
  fuzzer counts these cycles (`negativeMoneyCycles`) but does not fail on them.
- **Landfill beside a pier.** A pier's edge class needs a flat cell beside it; filling that cell turns it high and
  strands the pier on a cell that could not take one now. The building stands and works (`updateNetwork` and
  `sailsIn` don't recheck the class), so the fuzzer judges buildings on their own cells and lets it pass. Either
  `landfillBlocker` refuses the fill ("a pier lands here") or the pier is accepted as historically valid. A rule
  call either way.
- **Fire risk is not in [0, 1].** The brief's invariant says every field is; the fire field's own rule
  (`FIRE_IGNITE_THRESHOLD` = 1.0, ignition above it) puts its working range at roughly 0–2. Making it a fraction
  would mean moving the threshold and the ignition chance (balance numbers), so the fuzzer checks fire for finite
  and ≥ 0 instead. If a 0..1 fire field is wanted, the change is: threshold 0.5, `FIRE_IGNITE_CHANCE` scaled ×2,
  and a cap on the field.
- **Two remembered switches for the water reflections** disagreed on load (the old toggle key and the new quality
  preset); the toggle is live-only now (not a rule change — noted here because it changed what a saved preference
  does).

## Measurements

All on the RTX 4060 laptop (32 logical cores), Chrome headless with the GPU on unless said otherwise.

- **Sim fuzzer, 50 seeds × 2000 cycles** (`npm run fuzz`, 25 worker threads, ~14 min per seed, ~30 min a run,
  ~12,000 actions and ~1,100 successful placements per seed; every fifth seed on a generated island):
  - run 1 (after QA #1): 39/50 clean; the 11 failures were all the pollution field over 1.0 late in big towns
    (QA #3, first half).
  - run 2 (emitters capped): 47/50 clean; seeds 7, 40, 41 still over 1.0 through the drift (QA #3, second half).
  - run 3 (pollution's drift ceiling, fire and shark left unbounded): **50/50 clean** in 1797 s (mean 878 s per
    seed on 25 workers), ~12,000 actions and ~1,100 placements a seed, every kind placed, 20 to 5,620 times.
  - Every seed's purse went below zero at some point (mean 334 of 2000 cycles) — the fuzzer's random towns don't
    earn; counted, not failed (proposal above).

- **Quality presets** (`npm run quality`: the 300-building, 30-boat town, 5 s per preset, the camera framing the
  whole town):

  | Renderer | High | Medium | Low |
  |---|---|---|---|
  | SwiftShader, `--disable-gpu` (software; the brief's worst-case proxy) | 14.7 fps | 12.0 fps | 14.6 fps |
  | RTX 4060 Laptop (D3D11) | 164.6 fps | 164.6 fps | 165.0 fps (the display cap) |

  Read: the software renderer is bound by rasterising the scene itself, so the presets are within its noise
  (Medium under High is noise), and no preset makes it playable — the first-launch probe would land on Low
  there (14 fps < 35). The 4060 is capped at every preset, so the presets can't be told apart on it either. The
  machine the presets are for — an integrated GPU — is still unmeasured; SwiftShader is far slower than any
  real iGPU, so these numbers bound the floor, not the typical laptop.
- **Test suite** (`npm test`, 8 files in parallel): 14.3 s on a quiet machine (31 s with the fuzz holding 25
  cores); before Task 6 the one-file suite took 60 s+. With the World's two files (Session C): 10 files, 86
  checks, 17 s.
- **UI monkey, 15 minutes** (`npm run monkey`, seed 1, while the 50-seed fuzz held 25 cores): 33,446 actions
  (7,454 left clicks, 2,727 right clicks, 677 middle clicks, 3,547 left drags, 2,660 right drags, 2,005 middle
  drags, 3,357 wheel steps, 5,334 keys, 4,704 button presses, 665 seed-field entries, 316 resizes, a reload in a
  tsunami and one in a storm). Zero console errors, page errors or unhandled rejections; both events survived
  their reload; the Town menu closed at the end. Mean 159 fps; the longest run under 30 fps was 1.04 s (a chunk
  rebuild after a burst of placements), inside the 2 s limit. A one-minute pass earlier: 2,350 actions, 149 fps,
  worst 1.19 s, clean.

## Session C — the World (branch `globe`, 2026-09-27)

The World's own numbers, all from `npm run smoke` on the 4060 unless said otherwise (docs/globe/review.md and
audit.md have the full set):

- Boot into the World: 0.38–0.39 s empty, 0.56–0.58 s with twelve towns, 0.33 s with the 300-building town
  (its reload lands in the World in 0.52 s wall and cuts into the island in 0.62 s more).
- Draw calls: 15 with no towns (12 seas, edges, clouds, sky), 39 with twelve one-hut towns, 63 at most.
- 165 fps (the display cap) in the World with twelve towns; the island's checks unchanged at 165.
- Heap: twenty World → sea → World round trips across three seas, after GC: −1.3 to −1.7 % (73.5 → 72.5 MB).
- Storage: twelve 300-building towns are 4.04 M JSON characters (8 MB of UTF-16, over the 5 MB quota some
  browsers give an origin); LZW-packed they are under 2.6 M code units (`test/sectors.test.ts` measures it).
  Twelve fresh towns: 25 keys, 20 k units.
- Dive 1.41 s, return 1.20 s (the designed 1.4 / 1.2 s flights); with reduced motion 78 / 22 ms.
- **UI monkey, 5 minutes from the World** (`npm run monkey -- --minutes 5`, seed 1): the first run's two
  failures ("the tsunami / the storm did not survive the reload") were one bug — the World's DOM stayed
  clickable while it faded for the dive, so "Clear the sea?" could open mid-flight and be confirmed from the
  island of that very sea, which then had no sector to save into and no way back (docs/globe/review.md #13;
  fixed, with a smoke check). Third run: 14,863 actions, mean 161 fps, worst slow run 0.47 s, both events
  survived their reload, zero errors or rejections, nothing left open.
- **Quality presets, World** (`npm run quality`, SwiftShader `--disable-gpu`; the 300-building town on one
  face, eleven uncharted seas, 17 draw calls): High 18.1 fps, Medium 18.5 fps, Low 23.6 fps — lighter than
  the island at every preset on the software renderer (14.1 / 11.6 / 13.9 in the same run), and Low is a third
  faster than High there. On the 4060 the World is at the 165 fps cap with twelve towns. Integrated graphics
  remain unmeasured for both scenes.

