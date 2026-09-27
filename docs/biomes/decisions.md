# Biomes — decisions

Calls made where BIOMES.md is silent, or where the code's balance and BIOMES.md disagree. Numbered as they came up.

1. **Company prices for goods BIOMES.md leaves unpriced.** The registry (`sim/goods.ts`) keeps the trade ship's
   old numbers (smoked bought at 9, surplus fish at 5, planks delivered at 3) and prices the rest by role: foods
   delivered at 3–5, industrials at 3–8 (iron 6, glass 8), luxuries bought at 12–14 and delivered at 16–20,
   sponges bought at 6 and never carried. Caps: foods 100, luxuries 40, industrials 60, sponges 40 (base goods keep
   theirs). Numbers, not rules; Stage 7 may move them.
2. **The order book generalises the plank order.** `trade.orders` is a partial record of units per good;
   `orderPlanks` still exists and writes `orders.planks`. Version-2 saves fold `plankOrder` into it. Planks keep
   their old price constant (`TRADE_PLANK_PRICE`) so the Tidewater ledger is unchanged; every other good is
   delivered at the registry's `sells`.
3. **`world.biome` lives in the ledger from Stage 1** (save version 3, old saves read as `tidewater`); the biome
   registry `sim/biomes/index.ts` starts as ids and labels plus `makesOf` and grows into the Biome interface in
   Stage 2. `sectors.ts` re-exports the id type so the World keeps compiling.
4. **Food variety mechanics** (`sim/food.ts`): variety is the number of food kinds with any stock at the start of
   the settlement's meal; residents eat every kind in proportion to its stock (the brief's rule; Tidewater's
   shellfish now goes down with the fish instead of after it). The market sells every food above the town's
   reserve, kind by kind in registry order, keeping the reserve out of the first kinds first — the same arithmetic
   as the old fish-then-shellfish code, so Tidewater's sales are unchanged. Imported foods therefore sell too: a
   delivery is a few cycles of variety, not a permanent unlock.
5. **The luxury is consumed slowly.** BIOMES.md says "in stock"; a one-off purchase unlocking level 3 forever
   would make the order book pointless, so level-3 residents use `LUXURY_PER_RESIDENT` (0.02) of the first
   foreign luxury in stock per cycle. A 20-unit order lasts a small town a long while.
6. **Favourites:** Tidewater→coffee, Atoll→smoked, Delta→pearls, Cinder→indigo, Fjord→cocoa, Dunes→whale oil, the
   §2 ring read as "X's favourite is what the arrow into X carries". `HAPPY.favourite` = 0.05 while in stock.
7. **Toolworks:** 2×2 on flats or hill (`ground` floor), 220$ + 10 planks, 3 workers, upkeep 2. It burns
   `TOOLWORKS_IRON_PER_CYCLE` (0.5) × staffing at the settlement and, while it burnt any, every producer within
   `TOOLWORKS_RADIUS` (8) makes ×1.2: boats' catch, oyster beds, clam camps, the lumber camp's timber, the
   sawmill's planks, the smokehouse's smoked goods. Shipyards and markets are not "producers" here. No iron → the
   panel says "Idle: no iron" and nothing changes.
8. **What the company carries and buys** (`trade.ts`): it carries every registry good with a `sells` price that
   the island's biome does not make, plus planks always (the old plank order, kept at `TRADE_PLANK_PRICE` so the
   Tidewater ledger is unchanged); it buys the island's own goods that have a `buys` price (Tidewater: smoked
   goods and surplus fish) and never the cargo it delivered — so a foreign luxury bought for level 3 is not sold
   back at the next visit. The order book lives in the harbor's info panel (one button per carried good, +20 a
   click); the HUD's old "Order planks" button stays.
9. **Prices that fall with volume** are per visit: the first `COMPANY_FULL_PRICE_UNITS` (60) of a good sell at
   the registry price, the next `COMPANY_PRICE_SLOPE_UNITS` (120) slide linearly to `COMPANY_PRICE_FLOOR` (0.5).
   Surplus fish is flat. 60 is the base smoked cap, so a Tidewater town without warehouses earns exactly what it
   did; a cumulative (across visits) decay would have changed every trade cycle and is left for the lanes.
10. **The tide multiplier scales everything that was a tide constant** (`sim/tides.ts`): the four levels, the
    high/low water marks, the dry line, the spring-flood line, the wave height, the beach band, the landfill
    height, the fixed deck heights (pier 1.0, raised walkway 1.2) and every `terrain` window in the catalog are
    Tidewater's numbers × the biome's `tide`, about mean sea level. The Grid carries the active `Tides`; the clock
    keeps `TideState.scale` (saved, backfilled to 1). Scaling only the water would have flooded every standard
    building at a Fjord spring (CLAUDE.md §6 says buildings clear the spring peak), so the rule itself scales.
11. **Biome registry:** `sim/biomes/registry.ts` holds the interface and the map; `index.ts` re-exports it and
    imports every biome file (they register themselves), which keeps the import graph acyclic. `biomeOf` falls
    back to Tidewater for an id that is not charted, so an old sector never breaks.
12. **Island cache keyed by `${biome}:${seed}`;** a biome's validation is the base thresholds (overridable per
    biome) plus its own `validate(stats)`; stats now count cells per material, deep-enough cells and cells above
    4.0 for the biomes' rules. Seed 0 only bypasses validation for Tidewater.
13. **The look is data, the kits stay where they were** (`view/biomes/index.ts`): a `BiomeLook` carries the
    water and terrain tints, material tints, sky fog/aurora, walls, roofs, accents, house/boat/hat/tree kit
    names, fauna picks and ambience levels; `lookFor(state)` is the one accessor. `main.applyLook` pushes it into
    the terrain and water materials (uniforms), the building palette (a mutable `PALETTE` read at build time;
    chunks rebuild on `views.clear()`), the roof palette, and `setLook` on walkers, boats, trees, wildlife and
    audio, each rebuilding its base meshes only when its kit changes.
14. **Shader additions are uniforms with the study's values as defaults:** terrain bands (five vec3), `snowLine`
    / `snowColor`, `matTints[9]` / `matMix[9]` read against the material code carried in the height texture's
    blue channel (it was always 0), `tideScale`; water `shallow/mid/deep`, `lagoonTint/lagoonMix` (code 1 in the
    same channel), `depthScale`; sky `aurora/auroraTime`. With the defaults every fragment computes what it did.
15. **The World's miniatures read each sector's own look** (terrain and water uniforms per face, roofs from the
    sector's palette), so Stage 5's face tinting is already half done.
16. **Fjord numbers not in BIOMES.md:** racks dry 6 fish a cycle at full staff, 0.2 salt per fish, unsalted output
    ×0.5; whale season every 10 cycles from cycle 4 for 3 cycles, station 6 oil + 10 fish (the meat) a cycle
    with a boat and full hands (its jobs are its own six plus the boat's crew: `jobsAt` now adds both for a kind
    with `workers` and `slots`); iron mine 3 iron a cycle, fire rate 4 (between the tavern and the smokehouse);
    ice house ×2 fish cap; sea ice every 6th cycle from cycle 6, one cycle, boats stay in except at an
    ice-breaker pier (2 slots, 300$ + 20 planks, sails at high water like a pier) and the ship turns back for a
    cycle; avalanche after a storm: each undamaged land building on ground ≥ 2.0 with a standing tree within 3
    cells and ≥ 1.0 higher is buried with chance 0.5; aurora +0.03 happiness on every non-storm settlement.
17. **Sharks per biome:** `Biome.sharks = false` (the Fjord) zeroes the risk field and skips incidents; shark nets
    and the lifeguard are excluded from its catalog.
18. **The Fjord shaper** (`fjordHeight`): a cross-section in |x| (channel floor −3.6 → bank shelf 0.6 → crest
    5.8 → outer sea) swept along z, the channel filling to flats past the head at z ≈ −12, ledges pulsing along
    the banks, crests and channel wandering with the seed, the mouth open at +z, the head's back climbing to a
    col at the top edge. Tree sites 150 between 1.6 and 3.9. Validation on top of the base: ≥ 120 deep-enough
    cells (the channel) and ≥ 40 cells above 4.0 (the ridges); thresholds flats 260, region 150, piers 6.
19. **Per-biome counters live in `state.biomeState`** (a flat Record<string, number>, saved; old saves get {}):
    whaleSeason, seaIce, avalanches. The view reads them for spouts, ice on the water and the horn.
20. **Import-order traps:** `island.ts` reads the biome registry (`biomes/registry.ts`), never the index that
    loads the biome files; `fields.ts` builds its neighbour table at load and so imports the lattice from
    `cells.ts`, not from `grid.ts`, which sits in the biome import cycle; the view's looks are registered by
    `view/biomes/index.ts` itself, not on their own import.
21. **Atoll numbers not in BIOMES.md:** dive platform 1.2 pearls per low-water shift at full staff, graded only
    while an active pearl house stands within 8 (the pearl house itself makes nothing: "graded pearls" stay the
    one good `pearls`); coconut grove 0.6 coconuts per grown palm within 6 per cycle; reef nursery 1 worker on a
    lagoon cell, −0.15 bleach a cycle within 5 while its own cell's pollution is under 0.3; bleaching +0.2 a cycle
    on lagoon cells over 0.25 pollution, −0.05 back in clean water, and a bleached cell holds (1 − bleach) of its
    fish; cyclone = the storm with ×2 swell (view) and ×1.5 boat-loss chance (`Biome.storm`); turtles hatch the
    cycle after every spring peak (the spring peak is always a dawn on this clock: a day is two cycles and springs
    come every fourth, so "a spring night" is the night half that follows), lanterns within 4 of a beach cell go
    dark through that cycle (night coverage skips them, the view unlights them), +0.1 tourism per hatching up to
    +0.5. No shellfish bonus at springs: the Atoll makes no shellfish.
22. **The Atoll shaper** (`atollHeight`): a profile in the distance from the ring's crest (motu crest 0.55–1.4,
    reef flats either side, lagoon −0.25 → −0.75 toward the middle, open sea to −4), swept round an ellipse with
    two harmonics; one pass always, a second on odd seeds; the isle blends in at ×0.6. Lagoon material = water
    inside the ring, passes and the isle excluded. Validation: ≥ 200 lagoon cells, ≥ 40 deep-enough cells (a
    pass), thresholds flats 300, region 120, treed 30 (palms 0.5–1.5).
23. **Coral bleaching is a ledger field** (`fields.bleach`, saved; old saves get zeros) rather than biome-state,
    because it is spatial — CLAUDE.md §3 says fields are the mechanism. It rides to the water shader in the height
    texture's alpha channel (alpha = 1 − bleach), which nothing read before.
24. **World listing with gating off:** a face lists its band's coasts first (Tidewater first wherever it is a
    guest), then every other biome; charted means registered in `sim/biomes`, so Delta, Cinder and Dunes stay
    greyed "uncharted" until their files exist. `newSector` falls back to Tidewater for an uncharted id.
25. **Visual tweak after the first shots:** the Fjord's crests stand at 5.1 (from 5.8) and the look's snow line
    at 4.2 (BIOMES.md says 4.0; the validation still counts cells above 4.0), so the snow reads as a cap rather
    than a slab. The resource bar wraps at half the viewport now that a coast can show eight goods.
26. **Where the starting hut looks for its flats is the biome's call** (`Biome.startNear`): the island's centre
    for Tidewater and the Atoll (the inner reef flat), the head of the fjord for the Fjord — the centre of a
    fjord is the channel, and the first towns kept landing on a narrow bank ledge with no room for a market.
27. **Balance (Stage 7) only touched new numbers:** unsalted racks 0.5 → 0.6, stockfish 5$ → 6$ at the market
    and 6 → 7 from the company, coconut 0.6 → 1.0 per palm. Level 2 lands at cycle 13–14 on every coast because
    the base happiness needs a well before it crosses 0.8; the base numbers stand (NOTES.md "Session D").
28. **The scenario helpers grew up with the coasts** (test-only code): paths count as street, the street may grow
    off the market when its walkways are boxed in, `biomeTown`/`joinByLine`/`growStreetAny` put a coast's own
    kinds down. Tidewater's scripted towns are unchanged where the old behaviour succeeded, since every new path
    is a fallback taken only when the old one placed nothing.
29. **The smoke's caustics check pins the quality preset to High** before measuring: the first-launch probe can pick
    Low on a loaded machine (a vitest run alongside the smoke did exactly that), and Low turns caustics off.
30. **Sea lanes v0 (Stage 9, off):** the World ledger is a function over the sector store, not a running clock:
    each peak of the active sea settles every other built sea exactly once (`settleOnly`: no ticks between, no
    ignitions, the biome's settle hook still runs so seasons and bleaching keep pace). Cargo is a per-cycle hop
    along each lane: an island offers what it holds above its reserve (food: the town's reserve; else 30% of
    cap), a neighbour takes what it cannot make up to 50% of its cap, wants largest first, one hold of 20 per
    harbor split across its lanes, overflow sails back. Adjacency is read from `globe/geometry.ts` (pure
    math, no Babylon; the hygiene test allows `globe/`) rather than a copy of the table in the sim.
