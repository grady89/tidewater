# Biomes — progress ledger

The truth for the biomes build (branch `biomes`). Statuses: TODO / IN PROGRESS / DONE / BLOCKED.
Update after every step. After a compaction: re-read CLAUDE.md, BIOMES.md and this file, continue at the first non-DONE item.

Rules that govern: build + test + smoke green before every commit; commit per step; push `biomes` after each stage;
never push `main`. Where BIOMES.md is silent, choose the simplest option and log it in `decisions.md`.

## Stage 0 — ledger
- [DONE] BIOMES.md in the repo root; docs/biomes/PROGRESS.md and decisions.md created.

## Stage 1 — base additions every biome needs
- [DONE] 1a goods registry `src/sim/goods.ts` (id, role, cap, company buy/sell); stockpiles keyed by good id; warehouses raise every cap; resource bar grouped by role, hides zero-stock goods this island cannot make.
- [DONE] 1b `SimState.world.biome` (default "tidewater"); save version bump with backfill; sector metadata carries it.
- [DONE] 1c cell materials beside classes (plain, lagoon, mangrove, lava, dune, oasis, vent, spring, fertile) set by the island generator, read by placement rules and colour.
- [DONE] 1d food variety: any food feeds; level 2 needs 2 food kinds in stock, level 3 needs 3 + one foreign luxury; favourite luxury adds happiness; residents eat across food kinds proportionally.
- [DONE] 1e Toolworks (base catalog, 2×2, 3 workers): consumes iron slowly, +20% output to production buildings in radius 8.
- [DONE] 1f Trade Company as carrier: with a harbor the ship sells any good this biome cannot make at company prices, buys luxuries at prices that fall with volume; purchase queue in the harbor's info panel.
- [DONE] 1g tests: registry, variety, luxury, favourite, leveling, Toolworks, company purchases; existing scenarios + smoke pass for Tidewater (level 3 needs a company purchase).

## Stage 2 — biome framework
- [DONE] 2a `src/sim/biomes/index.ts` Biome interface + `tidewater.ts` identity biome (seed 0 byte for byte).
- [DONE] 2b `src/view/biomes/index.ts` BiomeLook read through one accessor.
- [DONE] 2c `island(seed, biome)`; validation per biome; catalog = base ∪ unique − excluded; `start.ts` places a valid starter town for any biome/seed.
- [DONE] 2d snow line, aurora, lagoon tint as new uniforms on existing shaders (additive only).

## Stage 3 — Fjord (§3.3)
- [DONE] shaper, tide ×1.6, stockfish racks, whaling station + whale season, iron mine, ice house, sea ice + ice-breaker pier, avalanche, fauna, longboats, stave houses, hooded walkers, aurora, ambience, validation.

## Stage 4 — Atoll (§3.2)
- [DONE] ring shaper + lagoon + pass, tide ×0.6, dive platform + pearl house, coconut grove, reef nursery, cyclone, bleaching, turtle hatching, fauna, outriggers, round huts, straw hats, ambience, validation.

## Stage 5 — World wiring
- [DONE] new-sector flow lists biomes by band (BAND_GATING respected); faces tint and miniatures use the biome look; sector card shows the biome.

## Stage 6 — tests and tooling
- [DONE] scenario towns for Fjord and Atoll; smoke sections per biome; screenshots to shots/biomes/; fuzzer random biome per seed; quality.ts per biome.

## Stage 7 — balance pass
- [DONE] starter positive within 4 cycles; level 2 ~cycle 8 alone; level 3 ~cycle 15 with a company purchase; record in NOTES.md.

## Stage 8 — review and audit
- [DONE] side-by-side screenshots; fix rough spots; ARCHITECTURE.md, HANDOFF.md (Biomes section), NOTES.md; mark this file.

## Stage 9 — sea lanes (only if all DONE and nothing BLOCKED)
- [DONE, stopped here] `LANES_ENABLED = false` in config.ts; `sim/lanes.ts` (sim-only): `settleOnly` (one quiet
  settlement: the clock moves a cycle, `settleCycle({quiet})` skips ignitions, the biome's settle hook runs),
  `surplusOf` / `wantOf` (food keeps the town's reserve; other goods keep LANE_RESERVE_FRACTION of cap; a coast
  wants only goods it cannot make, up to LANE_WANT_FRACTION of cap), `flowLane` (one hop, one hold, wants first,
  overflow sails back), `lanesOf` (both faces built with a harbor, sharing an edge — the dodecahedron's own
  table, `globe/geometry.ts`, which has no Babylon), `settleWorld` (gated) / `settleWorldNow`: every built
  sea but the active one settles once, then every lane flows, then the settled sectors are written back.
  main.ts calls `settleWorld` at each peak autosave only when the flag is on. `test/lanes.test.ts` (7 tests).
- Where it stopped / not done: no view (no cargo ship on the World or a lane drawn between faces); no ledger
  UI (the sector card does not show what came or went, only a notification in the receiving sea); no company
  route (§4's "the Trade Company sails the lanes" — the ship still visits every harbor on its own timer);
  the active sea's own settlement is on its clock, so an idle World (player on the globe) settles nothing
  until a sea is entered; the price slide stays per visit (HANDOFF known-rough). Balance numbers
  (CARGO_HOLD 20, one ship per harbor, reserve 0.3 / want 0.5 of cap) are placeholders never played.

## Last thing that worked
- Stage 9: sea lanes v0 behind LANES_ENABLED (off): sim/lanes.ts + test/lanes.test.ts, main hook gated. Build+test+smoke green.
- Stages 6–8: scenario helpers (biomeTown, placeNear, joinByLine, growStreetAny; starterTown/growStreet/placeByWalkway hardened), console API (forceBiome, view.fauna, view.biome, clearSector, grantGood, orderGood), smoke sections per coast with shots to shots/biomes/, fuzzer coast per seed + new invariants, quality.ts per coast; balance probe recorded in NOTES.md; ARCHITECTURE.md, HANDOFF.md, NOTES.md updated. Build+test+smoke green.
