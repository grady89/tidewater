# Tidewater — handoff

State of the project after sessions 1–2 (2026-09-26). Read CLAUDE.md first; NOTES.md holds every decision that
CLAUDE.md didn't cover. This file is the "where are we" summary.

## Run it

```bash
npm install
npm run dev
```

Opens on http://localhost:5180 (port 5173 is taken by another project on this machine; `strictPort` is on).
`npm run build` typechecks then bundles to `dist/`.

Controls: **1 / 2 / 3** or the palette buttons pick House / Walkway / Pier. **Click** a cell to place, **right-click**
to remove, **drag** to orbit, **scroll** to zoom. In dev builds `window.__tidewater` exposes
`{ engine, scene, tide, grid, placement }` for console poking; `placement.place({ i, j })` places at a cell directly.

## What exists (all of CLAUDE.md v1 scope)

| System | File | Notes |
| --- | --- | --- |
| Constants | `src/config.ts` | SIZE, TIDE_LO/HI, TIDE_PERIOD, TERRAIN_SEED, floor heights, WET_SAND_DRY_RATE |
| Terrain | `src/world/terrain.ts` | seeded noise, 170-subdivision flat-shaded heightfield, 16-bit heightmap texture |
| Water | `src/world/water.ts` | one plane, study shader verbatim, tide = plane Y |
| Sky | `src/world/sky.ts` | dome with the study shader |
| Lighting | `src/world/lighting.ts` | late-morning constants baked from the study's dusk=0.15 |
| Trees | `src/world/trees.ts` | 70 trees on high ground, merged to one mesh |
| Flat mesh helpers | `src/world/flatMesh.ts` | vertex-colour tint + merge → one draw call per prop |
| Grid | `src/build/grid.ts` | 64×64 cells, deep/flat/high classes, occupancy, footprint + validation |
| Pieces | `src/build/pieces.ts` | house / walkway / pier factories, lantern lit/dark materials |
| Placement | `src/build/placement.ts` | floor-plane picking, ghost preview, click/right-click |
| Tide | `src/sim/tide.ts` | 80 s cycle, wet-sand lag, peak detection, clock helpers |
| Network | `src/sim/network.ts` | BFS from piers through walkways; cut + reached flags |
| HUD | `src/ui/hud.ts` + `index.html` | palette, tide dial, score readout |
| Shaders | `shaders/*.ts` | byte-identical to `reference/tidewater-study.html` |

Rules as implemented: houses and walkways go on flat cells (terrain between −0.35 and +0.60); piers go on a deep
cell touching the flats and extend one cell seaward; a house is reached if a chain of walkways (or direct adjacency)
connects it to an un-cut pier; anything with its floor below the water is cut; score = reached houses on the frame
the tide peaks, shown until the next peak. Lanterns light on reached houses.

## Verified

- Renders at 165 fps in Chrome on an RTX 4060 Laptop (session 1, before gameplay; gameplay adds ~1 draw call per piece).
- Placement, footprint rules, removal, network BFS, lantern feedback: exercised programmatically and with real clicks.
- Severing: isolating a house drops it to unreached and darkens the lantern.
- Cut rule: forcing the water to 0.97 cuts every walkway (floor 0.95) but no house or pier (floor 1.0) and zeroes
  reached houses. **At the shipped TIDE_HI = 0.60 nothing is ever cut** — see the open question below.
- Picking: ghost lands within half a cell of the cursor at every sampled screen position and tool.

## Open design questions (yours to decide)

1. **The tide never threatens anything.** High tide +0.60 vs lowest floor 0.95. Options: raise TIDE_HI past 0.95
   so walkways flood but houses don't; add an occasional spring/storm tide; or keep v1 as pure sandbox. The
   0.05 gap between walkway and house floors is only meaningful with a tide above 0.95.
2. Nothing can be built on high ground. Intentional reading of "build grid over the flats"; revisit if the town
   wants to climb the hill.
3. Sky is black below the horizon (`pow` of a negative in `skyFS`, inherited from the study). One-character fix
   (`clamp(d.y, 0.0, 1.0)`) when you're ready to touch shaders.

## Not done / next

- Play a few cycles and answer the three v1 questions in NOTES.md (tension, town shapes, rhythm).
- No camera panning. Orbit + zoom only; the whole island fits at the default radius.
- Performance on integrated graphics is unmeasured. If it drops below 60, cut bloom first
  (`pipe.bloomEnabled` in `src/main.ts`).
- Dev-environment gotcha: writing a source file with a shell redirect can make Vite cache an empty transform
  (watcher fires on truncate). Symptom: blank page, no errors, `fetch('/src/main.ts')` returns ~160 bytes.
  Fix: touch the file.

## Commits (session 2)

Build grid → Pieces → Network + tide peak → Placement → HUD → loop wiring / trees replace decoration → notes + handoff.
