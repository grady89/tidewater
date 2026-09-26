# PROGRESS

Live status. Update after every milestone (and mid-milestone if you compact). One line each.

| Milestone | Status | Notes |
|---|---|---|
| M0 Harness | DONE | c499b38 · `npm run test` 6 sim tests, `npm run smoke` places pier/walkways/houses, advances a cycle, asserts score, shots/m0.png · headless 165 fps |
| M1 Ledger refactor | DONE | f097110 · SimState plain object, Grid index over it, fixed 1/20 s tick, JSON save + autosave each cycle, determinism + round-trip tests, smoke reload keeps 15 pieces · headless 165 fps |
| M2 Money loop | DONE | 7bab958 · catalog in balance.ts, tryPlace pays, boats/market/taxes/upkeep, nearest-first workers via BFS field, immigration, resource bar + palette with costs; starter town nets +95$ over 4 cycles, cut market sells 0 · headless 165 fps |
| M3 Tide splits economy | DONE | 69e9016 · spring tide every 4th cycle (0.85/−0.55, continuous), walkways on stilts (terrain+0.5) with fate-tinted ghost, raised walkway, oyster bed, clam camp, deep dock (sails both tides), seeded start hut; 17 sim tests, smoke shots/m3.png at spring low · headless 165 fps |
| M4 Town looks alive | IN PROGRESS | sub-task: starting (sim: fishing ground + phase progress; view: boats thin instances, walkers, day/night) |
| M5 Production chain | TODO | |
| M6 Pollution | TODO | |
| M7 Happiness & services | TODO | |
| M8 Beaches & sharks | TODO | |
| M9 Trade & tourism | TODO | |
| M10 Fire | TODO | |
| M11 Storms & tsunami | TODO | |
| M12 Camera, polish, saves | TODO | |
| M13 Audio | TODO | |
| M14 Ship it | TODO | |

## Current focus
M4 Town looks alive — sub-task: sim helpers (ground choice, phase progress). Last thing that worked: M3 green (build/test/smoke, 17 tests).

## Blocked
(milestone, why, what was tried, what would unblock)

## Run log
(one line per milestone completion: time, commit hash, fps measured)
- 2026-09-26 02:00 · M0 · c499b38 · headless 165 fps (Chrome headless on the RTX 4060 via --ignore-gpu-blocklist; SwiftShader gave 15.6)
- 2026-09-26 02:08 · M1 · f097110 · headless 165 fps
- 2026-09-26 02:20 · M2 · 7bab958 · headless 165 fps
- 2026-09-26 02:48 · M3 · 69e9016 · headless 165 fps
