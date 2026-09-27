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
- [TODO] 1d food variety: any food feeds; level 2 needs 2 food kinds in stock, level 3 needs 3 + one foreign luxury; favourite luxury adds happiness; residents eat across food kinds proportionally.
- [TODO] 1e Toolworks (base catalog, 2×2, 3 workers): consumes iron slowly, +20% output to production buildings in radius 8.
- [TODO] 1f Trade Company as carrier: with a harbor the ship sells any good this biome cannot make at company prices, buys luxuries at prices that fall with volume; purchase queue in the harbor's info panel.
- [TODO] 1g tests: registry, variety, luxury, favourite, leveling, Toolworks, company purchases; existing scenarios + smoke pass for Tidewater (level 3 needs a company purchase).

## Stage 2 — biome framework
- [TODO] 2a `src/sim/biomes/index.ts` Biome interface + `tidewater.ts` identity biome (seed 0 byte for byte).
- [TODO] 2b `src/view/biomes/index.ts` BiomeLook read through one accessor.
- [TODO] 2c `island(seed, biome)`; validation per biome; catalog = base ∪ unique − excluded; `start.ts` places a valid starter town for any biome/seed.
- [TODO] 2d snow line, aurora, lagoon tint as new uniforms on existing shaders (additive only).

## Stage 3 — Fjord (§3.3)
- [TODO] shaper, tide ×1.6, stockfish racks, whaling station + whale season, iron mine, ice house, sea ice + ice-breaker pier, avalanche, fauna, longboats, stave houses, hooded walkers, aurora, ambience, validation.

## Stage 4 — Atoll (§3.2)
- [TODO] ring shaper + lagoon + pass, tide ×0.6, dive platform + pearl house, coconut grove, reef nursery, cyclone, bleaching, turtle hatching, fauna, outriggers, round huts, straw hats, ambience, validation.

## Stage 5 — World wiring
- [TODO] new-sector flow lists biomes by band (BAND_GATING respected); faces tint and miniatures use the biome look; sector card shows the biome.

## Stage 6 — tests and tooling
- [TODO] scenario towns for Fjord and Atoll; smoke sections per biome; screenshots to shots/biomes/; fuzzer random biome per seed; quality.ts per biome.

## Stage 7 — balance pass
- [TODO] starter positive within 4 cycles; level 2 ~cycle 8 alone; level 3 ~cycle 15 with a company purchase; record in NOTES.md.

## Stage 8 — review and audit
- [TODO] side-by-side screenshots; fix rough spots; ARCHITECTURE.md, HANDOFF.md (Biomes section), NOTES.md; mark this file.

## Stage 9 — sea lanes (only if all DONE and nothing BLOCKED)
- [TODO] behind `LANES_ENABLED=false`.

## Last thing that worked
- 1c: materials (sim/materials.ts, Island.materials, Grid.materialOk, BuildingDef.material, placement blocker); smoke not rerun for 1c (sim-only change, unit tests green).
