# The connected World — decisions

Calls made where BIOMES.md is silent, or where BIOMES.md and the code disagree on a number (the code's balance
wins and is noted). Numbered as they came up; the code cites them.

1. **The later coasts plug in as data and hooks on the Biome, never as branches on an id.** New optional Biome
   fields: `producers` (per-kind land production at the settlement), `shiftEnd` (low- or high-water work), `surge`
   (a river swell every `every` cycles from `first`, `rise` over an ordinary peak, `king` over a spring one; the
   tide clock carries a copy in `TideState.surge`), `predator` (the shark role's name), `coverage` (service coverage
   the ground gives, e.g. a river's fresh water), `serviceRadius` and `serviceStrength` (wells that reach 3, a drought
   that dries them), `costs` (a coast's own price for a kind; `costOf(kind, biome)` is the one accessor), a per-home
   `homeHappiness`, `harbourFactor` (share of a harbour's boats that can work), and `force` (named moments for the
   console API). The storm profile gained `rain`, `fire`, `fog` and `chance`. The catalog gained `nearMaterial`,
   `pollution`, `fireRisk` and `stopsPredators` (the shark net has it). `CLEAR_BY_MATERIAL` says what clearing a tree
   on a material yields. `Tides.floodHi` is the highest water (spring, or a king tide): buildings clear it, and the
   dry line and the wave height follow it. Tidewater, the Fjord and the Atoll set none of these, and a fuzz of eight
   seeds across the three (150 cycles each) gives the same end-state hashes before and after.
