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
| M10 Fire | IN PROGRESS | sub-task: starting (fire risk field, ignition/spread, damage + repair, fire watch, effects) |
| M11 Storms & tsunami | TODO | |
| M12 Camera, polish, saves | TODO | |
| M13 Audio | TODO | |
| M14 Ship it | TODO | |

## Current focus
M10 Fire — sub-task: starting. Last thing that worked: M9 green (build/test/smoke, 34 tests).

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
