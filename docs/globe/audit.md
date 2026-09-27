# The World — final audit (stage 7)

The brief's rules and the mission's constraints, each checked against the code and the runs on 2026-09-27.
The checks are `npm run build`, `npm test`, `npm run smoke`, `npm run monkey -- --minutes 5`, `npm run quality`
and `npm run check:dist` on branch `globe`; results are at the end.

## Launch checklist

| # | Requirement | Status | Where / how it was checked |
|---|---|---|---|
| 1 | The World is the first thing on every launch; the island scene stays resident (no create/dispose lifecycle); a second Scene on the same engine; switching = which scene renders + which DOM shows + `adopt()` | done | main.ts boot (`showWorld(); world.enter()`), `mode`, `body[data-mode]`; the smoke's launch check; the heap check (20 round trips, −1.5 %) |
| 2 | Island loop, tick and autosave pause in the World | done | the render loop returns after `world.render()`; `save()` only runs from the island's peaks and the return |
| 3 | Dodecahedron standing on a face: polar top/bottom, 5 temperate, 5 tropical; each face a sector with seed, biome, name, SimState, metadata | done | geometry.ts (`FACES`, bands), sectors.ts (`SectorMeta`, `SectorRecord`); test/globe.test.ts, test/sectors.test.ts |
| 4 | Per-face ocean with the water shader and a per-face heightmap; built = miniature of the real island (height + landfill, terrain shader, roofs as thin instances coloured from the real buildings, water at the real tide); unbuilt = fogged sea | done | world.ts `buildFace`/`setSector`; the smoke's roof counts (1 → 2 after a hut, 222 for the big town) and `level` 0.6 vs 0 |
| 5 | Free spin with inertia, idle drift, small zoom; hover lifts/lights a face and shows its card; click dives; arrows rotate, Enter dives, Escape returns | done | ArcRotateCamera inputs + main.ts pointer/keyboard; the smoke's keyboard path; touch unverified headless |
| 6 | Only Tidewater exists; the new-sector flow lists biomes by band, the rest uncharted and unselectable; `BAND_GATING` in config.ts default false | done | sectors.ts `BIOMES_BY_BAND`, `biomesFor`; the smoke's card text ("Delta uncharted", "Dunes uncharted") |
| 7 | Save slots replaced by sectors: 12 × "tidewater.sector.N" (+ ".meta"), budget for twelve 300-building towns, migration of autosave + slots, autosave → active sector | done | sectors.ts, compress.ts (LZW, justified in decisions.md #11); tests: budget (12 × 337 k chars → < 2.6 M units), migration; the smoke's migration reload |
| 8 | window.confirm/prompt replaced by in-page dialogs | done | ui/dialog.ts; grep of src finds none; the smoke drives rename/delete/new-town/bad-file |
| 9 | Quality presets apply to the World (bloom, cloud count) | done | `world.setQuality(bloom, preset)` from `applyQuality`; 40 / 24 / 8 clouds |
| 10 | Same fonts (Instrument Serif titles, IBM Plex Sans UI), palette, sky, fog, lighting as the island | done | index.html `.world-title h1`, `.card-name`; rails `#b9a377`/`#e6d3a1`, clouds `#f7f3e8`, roofs from `ROOF_COLOURS` + `#4c5a66`; no new hex; `createSky`/`createLights`/`computeLighting` reused |
| 11 | Shaders extended by uniforms only (`frame`, `fogNear`, `fogFar`), the island bit-identical with the defaults | done | shaders/water.ts, shaders/terrain.ts headers; every island smoke check (caustics A/B, reflections, night/noon sky) unchanged and green |
| 12 | The sim never imports Babylon; the view writes no numbers | done | sectors.ts, compress.ts, miniature.ts, roofs.ts, geometry.ts are Babylon-free (vitest loads them); the World reads records and writes nothing into any state — main.ts writes sectors through `writeSector` only |
| 13 | 60 fps | done on the 4060 | 165 fps (the cap) with twelve towns; SwiftShader (the worst-case proxy) below |
| 14 | No new runtime dependency | done | package.json unchanged; the LZW packer is ~90 in-house lines |
| 15 | `npm run test`, smoke, monkey, quality, check:dist all green; smoke starts by creating and entering a sector, then every existing check unchanged; new checks; shots/globe wide + narrow; quality.ts measures the World | done | results below |
| 16 | Title text "Tiny Tides" only (no renames) | done | index.html title stays "Tidewater"; the World's h1 says Tiny Tides |
| 17 | Push `globe` after each stage; never push `main` | done | 193878b (1–4), b3be223 (5b), 9c4f3cc (5), then stage 6 and 7 commits; `main` untouched |
| — | Touch on a real device | open | pinch/drag through Babylon's inputs, tap through the click path; not verified |
| — | Integrated graphics | open | as for the island |

## Results

- `npm run build`: green (tsc strict over src/ and test/, Vite bundle 5.29 MB / 1.20 MB gzip — Babylon).
- `npm test`: 10 files, 86 checks, ~17 s.
- `npm run smoke`: green — every island check unchanged, then the World's checks; shots in shots/globe/
  (world-first-launch, island-after-dive, world-wide, world-narrow, world-twelve, world-night).
- `npm run check:dist`: green (31 meshes at load, no 404s, no errors).
- `npm run monkey -- --minutes 5` from the World: green on the third run, after a real fix (below).
- `npm run quality` (SwiftShader, island and World): numbers below.

### Monkey, 5 minutes from the World

The first run (14,913 actions, mean 163 fps, worst slow run 0.38 s, no console or page errors, no unhandled
rejection, no stuck menu or dialog) failed its two event-survives-reload checks. An instrumented second run
showed the island had no active sea at both reloads: the World's fading DOM stayed clickable during the dive,
so a random click had opened "Clear the sea?" mid-flight, the island came up under it, and a random Enter
confirmed it — deleting the sea the player stood on (review.md #13). Fixed: a dive is refused while a dialog
is open, the fading DOM is inert, a scene switch cancels open dialogs, the World's actions re-check the mode,
and a sea-less town can still return. Third run, clean: 14,863 actions in 5 minutes (3,302 left clicks, 1,200
right, 294 middle, 1,594 left drags, 1,117 right, 875 middle, 1,544 wheel steps, 2,364 keys, 2,119 button
presses, 318 seed-field entries, 136 resizes, a reload in a tsunami and one in a storm — both events survived,
saved into sea 6), mean 161 fps, worst slow run 0.47 s, no console or page errors, no unhandled rejections,
ended on the World with the menu and every dialog closed.

### Quality presets, World

`npm run quality` (SwiftShader, `--disable-gpu`: software rendering, the brief's worst-case proxy; the
300-building town on one face, eleven uncharted seas, the camera on the orbit):

| Renderer | High | Medium | Low |
|---|---|---|---|
| SwiftShader — island (as in QA.md) | 14.1 fps | 11.6 fps | 13.9 fps |
| SwiftShader — World | 18.1 fps | 18.5 fps | 23.6 fps (17 draw calls) |
| RTX 4060 Laptop — World (smoke, twelve towns) | 165 fps (the cap) | — | — |

Read: the World is lighter than the island on the software renderer at every preset, and Low (no bloom,
eight clouds) is a third faster than High there. The 30 fps floor motion.md hoped for on the software proxy
is not met, as it is not met by the island either; SwiftShader is far slower than any real integrated GPU,
and that machine is still the one to measure (HANDOFF.md, "things to do next").

## On waking

1. Read HANDOFF.md "The World" and docs/globe/review.md.
2. `npm run dev`, play the World with a mouse and, if possible, a phone: spin, hover, begin, dive, build, Escape
   back, rename/delete/export/import.
3. Merge `globe` into `main` when it feels right — CI deploys `main` to Pages.
