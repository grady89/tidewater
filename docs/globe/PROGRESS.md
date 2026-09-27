# The World — progress ledger (branch `globe`)

This file is the truth for the overnight build. After any compaction: re-read CLAUDE.md and this file, then
continue from the first item that is not DONE. Update after every step. Commit per step; push after each stage.

Last thing that worked: branch `globe` created from `main` (d50685a); all required files read.

## Stages

| # | Stage / step | Status | Notes |
|---|---|---|---|
| 1 | Creative direction — docs/globe/direction.md | DONE | written |
| 2 | Experience architecture — docs/globe/experience.md | DONE | written |
| 3 | Hero design — docs/globe/hero.md | DONE | written; numbers are the build's targets |
| 4 | Motion system — docs/globe/motion.md | DONE | written; values are what the code uses |
| 5a | Scene switch: createWorldScene, main.ts owns the active scene + DOM root, island loop/tick/autosave pause in the World, boot into the World, Playwright heap check (20 round trips, < 10 % growth) | TODO | |
| 5b | Sector save model in src/sim (sim-only): 12 sectors "tidewater.sector.N" (+ ".meta"), storage budget with twelve 300-building towns, migration of autosave + slots, autosave → active sector; sim tests for model, migration, export, import | TODO | |
| 5c | src/globe rendering: dodecahedron with bands, per-face ocean (water shader, per-face uniforms), miniatures from real saves, roof instances, clouds, night side, fog, sky reuse; draw-call count logged | TODO | |
| 5d | Input: drag with inertia, idle drift, face hover picking, click, keyboard, touch, zoom | TODO | |
| 5e | UI: title, sector card, new-sector flow, Town menu "World" button, rename, delete, export, import, reduced motion, in-page dialogs replacing window.confirm/prompt, quality preset applied to the World | TODO | |
| 5f | Entrance, dive and return sequences per stages 3–4 | TODO | |
| 5g | Tests: enterSector / world.* probes / newSector; smoke starts by creating + entering a sector then every existing check; new World checks; screenshots shots/globe wide + narrow; quality.ts measures the World | TODO | |
| 6 | Detail upgrade + docs/globe/review.md, smoke re-run, screenshots refreshed | TODO | |
| 7 | Final audit + docs/globe/audit.md, monkey 5 min from the World, ARCHITECTURE.md + HANDOFF.md World sections | TODO | |

## Blocked
(none)

## Run log
- 2026-09-27 · start · branch globe from d50685a
