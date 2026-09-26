# Tidewater

A coastal city-builder where the tide is the clock. Creative sandbox first, light survival pressure second.
This file is the project brief for Claude Code. Read it fully before touching code.

## The game in one paragraph
The player builds a stilt town on tidal flats. Twice per cycle the water rises and covers the flats; low ground floods, stilted buildings and walkways stand above it. The flats are the best land precisely because they flood. Beauty and survival come from the same decision: where and how high you build.

## Art direction (settled — do not relitigate)
- Flat-shaded low-poly geometry built from primitives in code. No textures, no imported models.
- Restrained palette: sand `#e6d3a1`, grass `#a8c97a` / `#79ad5e`, rock `#8d8a83`, wood `#5a4636`, planks `#8a6f52`,
  walls `#f2ece0 #f4d9c6 #d5e6ea #ece3c3`, roofs `#c9674f #4c5a66`, lantern `#ffb859`.
- Water is one plane with a custom shader: depth-graded color/alpha from a baked heightmap, faceted normals via screen-space derivatives,
  fresnel to sky, sun glint, crisp shore edge plus drifting foam rings. Tide = the plane's Y. Wet-sand band lags behind the water.
- Reference implementation: `reference/tidewater-study.html` (single-file Babylon.js demo). Port its shaders; do not rewrite them from scratch.
- Time of day exists in the study but is NOT in v1 scope. Fixed late-morning light.

## Stack
- Vite + TypeScript (strict) + Babylon.js 7. Browser target; Electron/Steam packaging is a later concern.
- No physics engine. No ECS library. Plain TS classes and a single game-state object.
- Procedural everything: terrain from a seeded noise function, buildings from primitives, textures none.

## v1 scope (the first playable slice — nothing beyond this)
World
- One fixed hand-tuned island (seeded noise, seed is a constant). Flats sit between tide low (-0.35) and tide high (+0.60).
- Build grid over the flats: 1.0 unit cells. Placement snaps to grid. Height of placed things is derived from the cell's terrain.

Player can place three things
- Stilt house (1 cell footprint, floor at +1.0, needs stilts down to terrain).
- Walkway (1 cell, floor at +0.95, connects orthogonally).
- Pier (2x1 cells at the deep-water edge; the "exit" of the network).

Rules
- A house is "reached" if a walkway path connects it to any pier.
- Tide runs on a fixed 80 s cycle. At high tide, any walkway or house whose floor is below water is "cut" (not destroyed) and breaks connectivity while submerged.
- Score = reached households at the moment of high tide. Shown once per cycle. That is the entire economy.

UI
- Build palette (3 buttons), a tide clock, a score readout. Nothing else. No menus, no citizens, no money.

Explicitly out of v1
- Freeform placement, citizens/agents, day-night, weather, economy, districts, save/load, sound.

## Questions v1 must answer (write findings in NOTES.md as you learn them)
1. Does watching the tide come in over the town feel tense, or merely decorative?
2. Does the connectivity rule produce interesting town shapes, or a single spine?
3. Is "build at low tide, wait for high tide" a satisfying rhythm or dead time?

## Code layout
```
src/
  main.ts            bootstrap engine, scene, loop
  world/terrain.ts   noise, heightfield mesh, heightmap texture
  world/water.ts     water mesh + shader material, tide state
  world/sky.ts       sky dome
  build/grid.ts      cell model, occupancy, placement validation
  build/pieces.ts    house / walkway / pier mesh factories
  sim/tide.ts        tide clock
  sim/network.ts     connectivity (BFS from piers), reached/cut state
  ui/hud.ts          palette, tide clock, score
shaders/             GLSL as .ts string exports (keep them readable)
reference/           tidewater-study.html (do not import; port from it)
```

## Working agreements
- Commit small. One system per commit.
- Keep the frame at 60 fps on integrated graphics; if a feature costs frames, cut it.
- When a rule is ambiguous, pick the simpler reading and note it in NOTES.md rather than asking.
- Don't add libraries without a one-line justification in the commit message.
