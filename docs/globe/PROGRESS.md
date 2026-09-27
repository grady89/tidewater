# The World — progress ledger (branch `globe`)

This file is the truth for the overnight build. After any compaction: re-read CLAUDE.md and this file, then
continue from the first item that is not DONE. Update after every step. Commit per step; push after each stage.

Last thing that worked: everything. Stage 7 complete — build, vitest (86), smoke (fifth run, with the dialog
regression check), monkey (5 min, clean), quality and check:dist all green; docs updated; the stage 7 commit
is the last one on `globe`. Nothing is BLOCKED. Next (for a person): play it with a mouse, then merge `globe`.

## Stages

| # | Stage / step | Status | Notes |
|---|---|---|---|
| 1 | Creative direction — docs/globe/direction.md | DONE | 193878b |
| 2 | Experience architecture — docs/globe/experience.md | DONE | 193878b |
| 3 | Hero design — docs/globe/hero.md | DONE | 193878b; numbers are the build's targets |
| 4 | Motion system — docs/globe/motion.md | DONE | 193878b; values are what the code uses |
| 5a | Scene switch: `World` (src/globe/world.ts) is a second Scene on the engine; main.ts owns `mode`, the DOM root (`body[data-mode]`, `#world`), the island loop/tick/autosave pause in the World, boot into the World; heap check (20 round trips across 3 seas, < 10 % after GC) in the smoke | DONE | boot into the World 393 ms (empty) / 558 ms (twelve towns); heap after 20 round trips: −1.4 % (69.6 → 68.7 MB) |
| 5b | Sector save model in src/sim (sim-only): 12 sectors "tidewater.sector.N" (+ ".meta"), storage budget with twelve 300-building towns, migration of autosave + slots, autosave → active sector; sim tests for model, migration, export, import | DONE | b3be223 — LZW packer (src/sim/compress.ts) because twelve plain towns are 8 MB of UTF-16; test/sectors.test.ts |
| 5c | src/globe rendering: dodecahedron with bands, per-face ocean (water shader, per-face uniforms), miniatures from real saves, roof instances, clouds, night side, fog, sky reuse; draw-call count logged | DONE | geometry.ts, miniature.ts, world.ts, view/roofs.ts, shader `frame`/fog uniforms; draw calls: 15 empty, 39 with twelve one-hut towns (max 63 with every roof shape on every face); 165 fps (the cap) |
| 5d | Input: drag with inertia, idle drift, face hover picking, click, keyboard, touch, zoom | DONE | ArcRotateCamera inputs + main.ts pointer/keyboard; the smoke drives the keyboard path; touch (pinch, tap) only through Babylon's inputs — unverified headless |
| 5e | UI: title, sector card, new-sector flow, Town menu "World" button, rename, delete, export, import, reduced motion, in-page dialogs replacing window.confirm/prompt, quality preset applied to the World | DONE | src/globe/ui.ts, src/ui/dialog.ts, saveMenu.ts rewritten, index.html; the smoke drives rename / export / delete (cancel + confirm) / import / a bad file / reduced motion; no window.confirm or prompt left in src |
| 5f | Entrance, dive and return sequences per stages 3–4 | DONE | world.ts (rise, fog, swell, surfacing; flyTo/flyBack) + main.ts (enterSector/returnToWorld); dive 1416 ms, return 1200 ms, cuts of 78 / 22 ms with reduced motion |
| 5g | Tests: enterSector / world.* probes / newSector; smoke starts by creating + entering a sector then every existing check; new World checks; screenshots shots/globe wide + narrow; quality.ts measures the World | DONE | smoke: launch with no saves, create, dive, place, return (roof shown), reload, twelve seas round trip + reload, export → delete → import, migration from the old keys (once), reduced motion, keyboard, heap; shots/globe/*.png; quality.ts measures the World per preset |
| 6 | Detail upgrade + docs/globe/review.md, smoke re-run, screenshots refreshed | DONE | twelve fixes from a frame-by-frame reel (rails at the centre, fog bands, the sea-floor square, shade floor, clouds on flights, card after the entrance, horizon tilt, return orbit, narrow layout, disc spokes, a dive during the entrance); review.md; hero/motion notes updated to the code; smoke green, shots/globe refreshed |
| 7 | Final audit + docs/globe/audit.md, monkey 5 min from the World, ARCHITECTURE.md + HANDOFF.md World sections | DONE | audit.md (checklist + results); the monkey found one real bug (a confirm outliving its scene → the sea deleted under the player; fixed, smoke check added, third run clean: 14,863 actions, 161 fps, 0 failures); quality: World 18 / 18.5 / 23.6 fps on SwiftShader; ARCHITECTURE.md "The World", HANDOFF.md "The World" + run/API/measured/next, README, NOTES, QA.md, root PROGRESS.md updated |

## Blocked
(none)

## Run log
- 2026-09-27 · start · branch globe from d50685a
- 2026-09-27 · stages 1–4 written (193878b)
- 2026-09-27 · 5b sector model + tests (b3be223)
- 2026-09-27 · 5a/5c/5d/5e/5f coded; scratch run: boot into the World 381 ms, 15 draw calls, dive 1440 ms, return ok, roofs follow placements, no errors. First-run visual fixes: miniature rebuilt on CreateGround (winding), camera 340, clouds sized, moonlit night floor, `clockOverride`. Water disc re-triangulated (five subdivided triangles, equal areas) after the noon shot showed spokes from the sliver fan at the centre.
- 2026-09-27 · build + vitest green (86 checks); smoke green with the World checks (second run — the first failed only its last check, which read the card before the return flight had landed)
- 2026-09-27 · stage 5 committed (9c4f3cc) and pushed
- 2026-09-27 · stage 6: a zoomed shot showed the "spokes" were the edge rails at the globe's centre (Vector3.normalize in place); reel of entrance/dive/return frames → twelve fixes (docs/globe/review.md); build + vitest green; the third smoke run failed on the card-after-entrance timing in the migration check and exposed that a dive during the entrance left the globe half-risen (fixed: the flight lands the globe first); fourth run green; committed a08b4d4, pushed; CI green on 9c4f3cc
- 2026-09-27 · stage 7: monkey run 1 failed both event-survives-reload checks; an instrumented run 2 showed the island had no sea (a "Clear the sea?" confirm opened on the fading World DOM mid-dive and confirmed from the island) → fixes in main.ts / dialog.ts / index.html, a smoke check, smoke run 5 green, monkey run 3 clean, quality measured (World 18 / 18.5 / 23.6 fps on SwiftShader), check:dist green; audit.md, HANDOFF, ARCHITECTURE, README, NOTES, QA, root PROGRESS updated; committed and pushed
