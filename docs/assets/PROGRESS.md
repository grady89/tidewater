# Assets pilot — progress

The ledger for the headless-Blender pilot (brief: "ONE-SHOT PILOT, unattended", branch `assets-pilot` from main).
Decisions the brief left open are in decisions.md; the report is pilot.md. Re-read this after any compaction and
continue from the first item not DONE.

| Step | Status | Notes |
|---|---|---|
| 0 Find Blender | DONE | Blender 5.2.2 LTS at C:\Program Files\Blender Foundation\Blender 5.2\blender.exe (decision #1: 4.x read as a minimum) |
| 1a palette.ts → palette.json | DONE | 27 / 21 / 22 hexes (Tidewater / Fjord / Atoll); committed; run.ts fails if it changes uncommitted |
| 1b lib.py, build.py, run.ts (`npm run assets`) | DONE | budgets enforced (the longboat hit 916/900 and was trimmed); a full build is ~11 s |
| 2 Six assets (dory, outrigger, longboat ×3 looks; whale, turtle, palm) | DONE | 12 GLBs (508 KB), 12 turntables; every PNG looked at; fixed in the scripts: the spout (a stack of hexagons → one plume), the coconuts (inside the knot) |
| 3 Loader (src/view/assets.ts, USE_BLENDER_ASSETS) | TODO | |
| 4 Comparison (view.assetCompare, smoke shots) and quality numbers | TODO | |
| 5 Report (pilot.md), HANDOFF, ARCHITECTURE | TODO | |
