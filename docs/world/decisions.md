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
2. **The Delta is an island whose river springs behind the levee.** BIOMES.md has the river "enter on the high
   edge", but a World face is an island (the rim test holds every coast's edge below −2, or the face seams and the
   water vanishes behind a cliff — the Fjord's bug), so the river rises in the levee's lee at the back of the
   island and cuts a gap through it. The stem runs to a split at z −6, two distributaries fan to the sea and a
   third leaves the western one. Channels −0.95 (stem) to −1.1 deep with noise; the levee is a ridge 0.7–1.35 high
   across the back, the only high ground; flats 0.16–0.4 rising gently toward the levee. Validation: the stem cuts
   the levee (80 % of its rows under water), ≥ 20 levee columns, ≥ 5 channel crossings on two sections, ≥ 60
   mangrove cells, thresholds flats 450, region 250, piers 6, treed 0 (the Delta's trees are mangroves on the flats).
3. **The spring-low bonus never paid, anywhere.** `shiftEnd` decided a spring low by the water level, which at the
   end of a low has risen back to the low-water mark, so the test was never true: Tidewater's oysters and clam
   camps, the Atoll's divers never had their spring bonus. It now asks whether the coming peak is a spring one
   (`isSpringCycle(cycle + 1)`), which is what CLAUDE.md §4 says. Tidewater's ledger moves with it (a fix, not a
   tuning).
4. **The Delta's boats land crab** (`Biome.catch`). BIOMES.md gives every coast exactly two foods so level 3 needs
   a lane; boats land fish everywhere, which would give the Delta three. Its sampans work crab lines; the crab pots
   add low-water crab.
5. **The river swell and the king tide** (`surge: every 6 from 6, +0.15, king +0.3`): a swell cycle's peak is
   0.15 higher, a swell on a spring peak 0.3 over the spring (1.15). On a surge coast every building clears the
   king tide (`Tides.floodHi`), and so do the fixed decks (piers, docks, the raised walkway, the sea pieces: their
   floors rise by the king rise), so nothing but standard walkways goes under — low ones at a king peak, which is
   the Delta's lesson. BIOMES.md's "unraised paddies": every paddy stands at the water, and a king tide washes out
   every standing crop (not damage); raising them is the Great Sluice capstone's (§7), not built.
6. **Fresh water:** the stem's water cells paint the water coverage layer 3 cells round (`Biome.coverage`), so
   homes along the river count as watered and paddies there grow; a paddy away from the river needs a well's reach.
7. **Rice grows at low water:** a watered, staffed paddy's crop grows at every low (it is planted at low water and
   flooded at high) and comes in after two (`RICE_CYCLES`), 14 rice at full staff; at a spring low every watered
   paddy comes in at once, ×1.25 — the rice harvest. Growing at the settlement instead left a parity trap: a paddy
   harvested the cycle before a spring never had a crop standing at the spring low.
8. **Indigo from the open flats:** "delta plants in radius" read as the wild indigo on every unbuilt flat cell
   within 6 (0.02 each a cycle at full staff, ~3 on open flats); the vats foul the water (3 pollution a cycle).
   Counting only the mangroves made the vats useless anywhere near a starting town.
9. **Salt pans** stand on the upper flats and the levee (class flat-or-high, ground 0.45–1.4), 4 salt a cycle,
   half during a storm. **Crab pots** are an edge piece (a channel's edge), 3 crab per low water.
10. **Crocodiles are the shark system** with the coast's name (`Biome.predator`); the warden tower is the
    lifeguard's role on the flats (the same coverage layer); the croc net is a net (`stopsPredators`), and the
    Delta's catalog swaps them for the lifeguard and the shark net.
11. **Fever season:** every 8th cycle from 8, a quarter (rounded up) of every home's residents fall sick (the
    injury mechanism: off work until a clinic or time heals them) unless a staffed, reached clinic stands within 10.
12. **Storms come half again as often** on the Delta (`storm.chance` 1.5, named "rainstorm"): "rain more often".
13. **One new hex:** indigo `#2e3f7f` for the vats' liquor and the dyed cloth; nothing in the palette is that blue.
14. **Mangroves** are tree sites on every mangrove cell: nothing is built on a standing tree, so they must be
    cleared (the Land tab), which gives no timber and stirs 0.4 pollution into the cell (`CLEAR_BY_MATERIAL`).
