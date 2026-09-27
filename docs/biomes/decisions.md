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
