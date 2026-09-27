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
