# PROGRESS

Live status. Update after every milestone (and mid-milestone if you compact). One line each.

| Milestone | Status | Notes |
|---|---|---|
| M0 Harness | DONE | c499b38 · `npm run test` 6 sim tests, `npm run smoke` places pier/walkways/houses, advances a cycle, asserts score, shots/m0.png · headless 165 fps |
| M1 Ledger refactor | DONE | f097110 · SimState plain object, Grid index over it, fixed 1/20 s tick, JSON save + autosave each cycle, determinism + round-trip tests, smoke reload keeps 15 pieces · headless 165 fps |
| M2 Money loop | DONE | 7bab958 · catalog in balance.ts, tryPlace pays, boats/market/taxes/upkeep, nearest-first workers via BFS field, immigration, resource bar + palette with costs; starter town nets +95$ over 4 cycles, cut market sells 0 · headless 165 fps |
| M3 Tide splits economy | DONE | 69e9016 · spring tide every 4th cycle (0.85/−0.55, continuous), walkways on stilts (terrain+0.5) with fate-tinted ghost, raised walkway, oyster bed, clam camp, deep dock (sails both tides), seeded start hut; 17 sim tests, smoke shots/m3.png at spring low · headless 165 fps |
| M4 Town looks alive | DONE | c76ee7d · boats (hull+sail thin instances, sea BFS paths, phase-progress trips, heel on the mud), walkers (thin-instance figures on BFS routes at shift change, market loiterers), day/night from the study lerp with lanterns; smoke: 4 boats out at high, 4 moored at low, 9 walkers, shots/m4-*.png · headless 165 fps |
| M5 Production chain | DONE | a83af92 · trees as a ledger field (fell/regrow, thin-instance view), lumber camp, sawmill, shipyard (boat at cycle 10 in the scripted town), warehouse caps, net loft, smokehouse, tall house w/ prereq, build menu by category with reasons; market food reserve fix · headless 165 fps |
| M6 Pollution | DONE | f5b3039 · fields.ts (decay/diffuse/tide-advect), waste → outfall emitters, treatment plant, oyster die-off (bed beside an outfall dies in 3 cycles; survives with a plant), fish density + richest-ground boats + depletion/regen, overlay mesh + toggle; 25 sim tests, shots/m6.png · headless 165 fps |
| M7 Happiness & services | DONE | 9aa1dcb · HAPPY formula w/ coverage layers (water/leisure/night/treatment…), well/bathhouse/tavern/shrine/market square, lantern posts on walkways, homes level 1→3 (+capacity, roof/chimney), info panel on click, accumulating waste backlog; 28 sim tests, shots/m7.png · headless 165 fps |
| M8 Beaches & sharks | DONE | 52adce6 · derived beaches, daytime swimmers at high water, shark-risk field (markets/docks, nets absorb), seeded incidents → injuries/shock, clinic + lifeguard + nets, fins + swimmers in the view, Sharks overlay; unguarded beach by a busy pier: incident by cycle 7 / with nets+lifeguard 0; 31 sim tests, shots/m8.png · headless 165 fps |
| M9 Trade & tourism | DONE | cdd020a (+ addCapped fix) · harbor (depth < −1.5), trade ship every 3 cycles (2 w/ lighthouse) buying smoked/surplus fish, plank orders, inn + tourists spending, ship view in/out along a ≥12-cell sea path; 34 sim tests, shots/m9-in.png + m9-out.png · headless 165 fps |
| M10 Fire | DONE | 2a81e62 · fire-risk field (smokehouse/tavern/lanterns), per-cycle ignition above a threshold, tick-wise spread, burn-out damage, auto-repair (money + timber), fire watch (damps + saves), damaged tint/lean, flames + smoke, Fire overlay; cluster burns / watched cluster never ignites; 37 sim tests, shots/m10-*.png · headless 165 fps |
| M11 Storms & tsunami | DONE | 5e2aceb · storms (12 %/cycle after 6, boats stay in, 50 % loss unsheltered, rain, dusk light + ×3 swell), tsunami (20 s drawdown to −1.2, crest sweep uniform, unshielded floors < 1.4 damaged, boats lost), breakwater + sea wall shielding along the wave axis, forceStorm/forceTsunami; 40 sim tests, shots/m11-*.png · headless 165 fps |
| M12 Camera, polish, saves | DONE | 8fb0af0 · middle-drag/WASD pan, pause/1×/2×/4×, three save slots + new town, 5-step tutorial + empty-state hints, greyed palette reasons; 300 buildings / 30 boats / 200 walkers at 164.8 fps headless, 300-building reload 615 ms (chunk merge skipped: target holds); 42 sim tests, shots/m12-bigtown.png · headless 165 fps |
| M13 Audio | DONE | 121ed07 · Web Audio surf (noise + low-pass, follows tide/storm), shift bell, tsunami thrum, mute (remembered); context created on first gesture, smoke asserts running after click and no console errors · headless 165 fps |
| M14 Ship it | DONE | 7d32ada · README (run, controls, how the town works, layout, screenshot), HANDOFF rewritten (what exists, known-broken, balance notes, next three, backlog), `npm run build` → dist/ · headless 164.8 fps |
| Backlog 1 Reflections | DONE | eddf8ae (+ chunk merge) · MirrorTexture through the water plane mixed into the fresnel sky term by `reflectMix`; speed-bar toggle, remembered, off by default; forced the M12 chunk merge (300 buildings → 15 meshes, lanterns thin-instanced) · headless 165 fps with it on in the big town |
| Backlog 2 Caustics | DONE | (see run log) · additive noise web in the 0.03–1.6 depth band scaled by a `caustics` uniform that follows daylight; smoke A/Bs viewport brightness over a beach · headless 165 fps |
| Backlog 3 Gulls & crabs | DONE | 5638fe2 · view/wildlife.ts: gulls circle harbours with boats (2 + 1/boat, ≤ 48), crabs on seeded flat cells near town while exposed; smoke M4: gulls > 0 and crabs = 0 at high water, crabs > 0 at low · headless 165 fps |
| Backlog 4 Roof variety | DONE | 6d7531c · pyramid / gable / hip per home, hashed from id + level; big-town smoke sees all three · headless 165 fps |
| Backlog 5 Districts | DONE | da96ee7 · clusters of 3+ touching buildings, named from the oldest member, stats in the info panel; 3 sim tests, smoke M7 reads the panel · headless 165 fps |
| Backlog 6 Second island | DONE | 56a188a · isle dome blended into the heightfield (main island's 750 land cells untouched), locked until a harbor, ferry steamer on the sea route; settleIsle scenario; 2 sim tests, smoke B6 · headless 165 fps |
| Backlog 7 Achievements | DONE | ee5c2f1 · nine ledger milestones checked once a second, kept in state.achievements (old saves tolerated), ★ log line + 6 s popup; 2 sim tests, smoke B7 + big-town fifty/hundred · headless 165 fps |

## Session A (overnight, branch `rules`) — all four tasks DONE, nothing BLOCKED

Four commits on `rules` (not pushed; nobody asked): db146ad → 841095e → 8a018b4 → e0ff042, each with `npm run build`,
`npm run test` and `npm run smoke` green first. 69 sim tests (was 60), smoke OK at 165 fps (the headless cap) after
every task. NOTES.md "Session A" holds every reading the brief left open; CLAUDE.md §6/§7/§9/§11/§13, README and
HANDOFF are updated to match.

| Task | Status | Notes |
|---|---|---|
| 1 Replace the stilt rule | DONE | db146ad · every standard piece sizes its stilts: floor = max(terrain + `STILT_MIN` 0.5, tide + `CLEARANCE` 0.1) — walkways clear `TIDE_HI`, houses/buildings clear `SPRING_HI`; only standard walkways flood, only at spring tides, only under terrain 0.35; raised walkway kept as the spring-proof street; cost = base + `STILT_COST_PER_UNIT` (6$) × stilt length, on the ghost with the length; `[ ]` lifts only above the auto height, `WALKWAY_SNAP` never below it; tsunami threshold `WAVE_HEIGHT` = SPRING_HI + CLEARANCE + 0.45, "the sea is uneasy" one cycle ahead, walkways rebuild themselves for base cost; the stuck hint's flood advice, the lift-the-deck tutorial step and the market's "under water" warning are gone. Starter town from 650: 143 after the build, +52 over 4 cycles (136 / 133 / 160 / 195) — no retune needed |
| 2 Known-broken hour | DONE | 841095e · `PERSON_SCALE` 0.4 (a quarter of a cell; hats, baskets, porters, swimmers' waterline follow); shark-net floats and buoys moved to the effects layer and placed on the water each frame (smoke: 0.95 lower at low water); shift bell only while `isSunUp` (smoke: rang on exactly the 4 daytime shifts of 8); sea wall on the brief's `shore` class |
| 3 Ferry carries workers | DONE | 8a018b4 · first attempt worked, ferry and isle stay. `distanceField` is a bucket queue with one weighted edge: a harbor the street reaches (a raised walkway bridges it) ↔ every pier/dock on the isle at `FERRY_COST` (10 cells); `assignWorkers` unchanged, so isle homes staff mainland jobs and mainland homes crew isle boats (sim test: 4 cross each way, isle hut = market→harbor + 10 + pier→hut; an unlinked or cut harbor carries nobody). View: cross commuters walk to their terminal, cross for 20 s, walk on from the far one; up to 8 riders on the ferry's deck (smoke B6: 4 commuters, 4 riders). `bridgeTo` scenario helper |
| 4 Seeded islands | DONE | e0ff042 · `islandHeight(seed)` + `island.ts`: ≥ 400 flats, contiguous flats ≥ 250, ≥ 3 pier sites, ≥ 1 harbor site, ≥ 60 trees on high cells (read as tree sites, not distinct cells — the original island's 70 sites share 45 cells); reroll via `candidateSeed(seed, k)` until valid, cap 32 then the original island stands in. Seed 0 reproduces the current island exactly (fingerprint `19bacd86` of all 4096 heights pinned in the tests). **Reroll rate, seeds 1..200: 114 of 200 rerolled at least once (57%), 269 rerolls in all (1.35 per island), worst seed 11, fallbacks 0; ~5 ms per candidate.** Ledger `world.seed` (old saves → 0), Town menu seed field + Random + New town; smoke drives the menu to island 7, reloads onto it, returns to 0 |

Not touched tonight (another session owns them): `test/fuzz*`, `.github/`, `src/ui/settings*`.

## Session B (QA, branch `qa`, from `rules` 9963c4e) — all six tasks DONE, nothing BLOCKED

Grady was awake and sent two requests mid-session; both were done first and are in NOTES "Session B": building
rotation (a building faces an adjoining street on its own, R turns it, the ghost shows a door tab) and the isle's
outline (warped rim, off-centre knob, tilted shelf — no more ring of light). Sim tests and the smoke cover both.

Commits: `3951b0c` Task 4 (the deploy files stand alone); `02a766f` the rest of the session in one commit, because
the live requests and tasks 1, 3, 5 and 6 all touch the same files (main.ts, grid.ts, state.ts, placement.ts, the
docs) and no per-task split of them leaves every intermediate tree green — see the commit message for what is in
it. Every commit was made with `npm run build`, `npm test`, `npm run smoke` and `npm run fuzz` green.
QA.md has every bug (3 fixed, each with a regression test) and every proposal.

| Task | Status | Notes |
|---|---|---|
| 1 Sim fuzzer | DONE | `npm run fuzz`: `test/fuzzCore.ts` plays ~6 random valid actions a cycle (every kind placed with random turn and lift, removals with boats out, boats, loans, plank orders, forced storms/tsunamis/fires, land tools, lanterns, save→load mid-storm and mid-wave, speed, grants) and checks every invariant at every cycle; esbuild bundles it for worker threads. `src/sim/money.ts` makes every purse change an audited entry (no number moved). **Final run: 50/50 seeds × 2000 cycles clean** (1797 s on 25 workers). Found on the way: QA #1 stale crew after a storm at the peak, QA #3 pollution past 1.0 (emitters, then the drift); QA #2 (stale tide flows after landfill / a load onto another island) came from reading the field code. Fire risk is held to finite ≥ 0, not [0,1]: its ignition threshold is 1.0 by design (proposal in QA.md). `test/fuzz.test.ts` keeps two short seeds in `npm test` |
| 2 UI monkey | DONE | `npm run monkey`: 15 minutes, 33,446 real inputs (clicks/drags with all three buttons, wheel, held keys, every visible button, the seed field, resizes, a reload in a tsunami and one in a storm) — zero console/page errors or unhandled rejections, both events survived their reload, no stuck modal, mean 159 fps, longest run under 30 fps 1.04 s (limit 2 s). Nothing to fix |
| 3 Quality presets | DONE | `ui/settings.ts` + the Quality… panel: High / Medium (no reflections) / Low (no bloom, reflections, caustics, gulls; half the walkers). A 3 s probe at High picks one on first launch (≥ 55 High, ≥ 35 Medium, else Low), remembered in localStorage; the smoke drives the probe (135 fps → High). `npm run quality` on SwiftShader: 14.7 / 12.0 / 14.6 fps — the software renderer is raster-bound, the presets are inside its noise; the 4060: 165 at all three (the cap). Numbers and the reading in QA.md |
| 4 Deploy | DONE | 3951b0c · `.github/workflows/ci.yml` (build + test + `check:dist` on every push, Pages from `main`), `base: "./"`, `test/deploycheck.ts` loads `dist/` under `/tidewater/` in headless Chrome with no 404s. Pushed at Grady's request: the build job is green on GitHub's runners (runs #2 and #3 on `main`); the deploy job fails until Pages is switched on once in Settings → Pages → Source: "GitHub Actions" (the workflow token cannot create the site — `enablement: true` got a 403, so it was taken out again in the last commit). Then re-run the workflow and https://grady89.github.io/tidewater/ is live |
| 5 Playtest log | DONE | `ui/playtest.ts` (pure, injected clock) + the Town menu's switch, notes and "Export playtest log" (Blob download); placements/removals with cycle and purse, every notification and non-default hint, walkthrough steps, money + population per cycle, 30 minutes then stops; off by default, local only. `test/playtest.test.ts` proves the export shape from a scripted session; the smoke drives the real switch, textarea and download |
| 6 Code health | DONE | dead exports removed (13), the three flow caches merged into `fields.flowFor`, lattice helpers into `sim/cells.ts`, no `any` anywhere (headless scripts type the console API), `stepDrift`/`updateNetwork` allocation-free with identical arithmetic (12-seed fuzz hashes identical before and after), the 1474-line test file split into six topic files → `npm test` 16 s alone (was 60 s+), ARCHITECTURE.md (module map, tick order, click → ledger → mesh). No TODOs existed. Smoke unchanged |

Not touched (another session owns them): `src/sim/balance.ts` rule logic, the stilt/floor code, the ferry. The
one balance file change is none; the three "clamp" fixes are in pollution.ts/fields.ts and change nothing in a
town that never saturates a cell.

For the morning: everything is pushed (`rules`, `qa`, and `main` fast-forwarded to them); flip Pages to "GitHub
Actions" in the repository settings and re-run the workflow to publish the site; the SwiftShader numbers
say nothing about a real integrated GPU, which is still the one machine unmeasured; QA.md's proposals (the purse
below zero, landfill beside a pier, fire risk not a fraction) are rule calls.

For the morning: the four Task 2 items are off HANDOFF's known-broken list; the ferry needs the harbor bridged to the
street before anyone crosses (an unbridged harbor still opens the isle); old saves keep their pre-rule floors and land
on island 0. The next thing to do is still HANDOFF's #1 — play the walkthrough cold with a mouse — now on a random island.

## Current focus
Nothing left on ROADMAP.md: M0–M14 and backlog 1–7 are DONE, nothing BLOCKED. Last thing that worked: achievements green (build/test/smoke, 49 tests, 165 fps). HANDOFF.md rewritten at the end of the run.

## Blocked
(milestone, why, what was tried, what would unblock)

## Run log
(one line per milestone completion: time, commit hash, fps measured)
- 2026-09-26 02:00 · M0 · c499b38 · headless 165 fps (Chrome headless on the RTX 4060 via --ignore-gpu-blocklist; SwiftShader gave 15.6)
- 2026-09-26 02:08 · M1 · f097110 · headless 165 fps
- 2026-09-26 02:20 · M2 · 7bab958 · headless 165 fps
- 2026-09-26 02:48 · M3 · 69e9016 · headless 165 fps
- 2026-09-26 03:15 · M4 · c76ee7d · headless 165 fps
- 2026-09-26 03:55 · M5 · a83af92 · headless 165 fps
- 2026-09-26 04:30 · M6 · f5b3039 · headless 165 fps
- 2026-09-26 05:20 · M7 · 9aa1dcb · headless 165 fps
- 2026-09-26 06:05 · M8 · 52adce6 · headless 165 fps
- 2026-09-26 06:45 · M9 · cdd020a · headless 165 fps
- 2026-09-26 07:25 · M10 · 2a81e62 · headless 165 fps
- 2026-09-26 08:10 · M11 · 5e2aceb · headless 165 fps
- 2026-09-26 08:55 · M12 · 8fb0af0 · headless 165 fps; big town 164.8 fps; reload 615 ms
- 2026-09-26 09:15 · M13 · 121ed07 · headless 165 fps
- 2026-09-26 09:30 · M14 · 7d32ada · headless 164.8 fps
- 2026-09-26 10:20 · Backlog 1 · eddf8ae + chunk merge · headless 165 fps, big town with reflections 165 fps
- 2026-09-26 10:45 · Backlog 2 · 988a2c6 · headless 165 fps
- 2026-09-26 11:05 · Backlog 3 · 5638fe2 · headless 165 fps
- 2026-09-26 11:25 · Backlog 4 · 6d7531c · headless 165 fps
- 2026-09-26 11:50 · Backlog 5 · da96ee7 · headless 165 fps
- 2026-09-26 12:30 · Backlog 6 · 56a188a · headless 165 fps
- 2026-09-26 12:55 · Backlog 7 · ee5c2f1 · headless 165 fps
- 2026-09-26 (daytime playtest session) · a34ec6e → c149d07 · save-shape guard, CS camera, placement rework, walkthrough card, art pass from reference/, level streets + dirt trails + hill homes, land tools, loans, sun/moon/night, ambient audio, porters · headless 165 fps throughout · 60 sim tests
- 2026-09-27 (overnight, branch `globe`, not merged) · 193878b (design stages 1–4) · b3be223 (sector model) · 9c4f3cc (the World: scene switch, rendering, input, UI, dive/return, tests) · a08b4d4 (detail pass) · the stage 7 commit (audit, the monkey's dialog bug, docs) · headless 165 fps in the World with twelve towns, boot 0.4–0.6 s, heap flat over 20 round trips, monkey 5 min clean · 86 sim tests · ledger in docs/globe/PROGRESS.md
- 2026-09-28 · sewers (streets and piers carry them, pipes anywhere else, cesspits, the Sewers overlay), capacity (wells nearest-first, plants per network) and upgrades (well, treatment plant, market, clinic, inn, fire watch; levels 1–3) · test/sewers.test.ts, fuzzer lays pipe and upgrades
