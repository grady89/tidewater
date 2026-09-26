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
| Backlog 6 Second island | IN PROGRESS | sub-task: isle in the heightfield, locked until a harbor, ferry view |

## Current focus
Backlog 6 Second island — sub-task: sim/isle.ts + heightfield blend. Last thing that worked: districts green (build/test/smoke, 45 tests, 165 fps).

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
