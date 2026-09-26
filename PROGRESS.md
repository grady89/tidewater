# PROGRESS

Live status. Update after every milestone (and mid-milestone if you compact). One line each.

| Milestone | Status | Notes |
|---|---|---|
| M0 Harness | DONE | c499b38 · `npm run test` 6 sim tests, `npm run smoke` places pier/walkways/houses, advances a cycle, asserts score, shots/m0.png · headless 165 fps |
| M1 Ledger refactor | IN PROGRESS | sub-task: starting |
| M2 Money loop | TODO | |
| M3 Tide splits economy | TODO | |
| M4 Town looks alive | TODO | |
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
M1 Ledger refactor — sub-task: starting (state.ts, fixed timestep, sim-owned grid/network/tide, save/load). Last thing that worked: M0 harness green.

## Blocked
(milestone, why, what was tried, what would unblock)

## Run log
(one line per milestone completion: time, commit hash, fps measured)
- 2026-09-26 02:00 · M0 · c499b38 · headless 165 fps (Chrome headless on the RTX 4060 via --ignore-gpu-blocklist; SwiftShader gave 15.6)
