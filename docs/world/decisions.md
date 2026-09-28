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
15. **The Cinder's shape:** a cone of radius 17 peaking at 8.6 with seven radial ridges and a crater 2.6 across,
    an apron of black flats 3.2 wide round its foot that widens by 6.5 into a bay on the far side from the lava
    flank, then a shelf that drops to −4.2 within 3.5 cells ("deep water fast"). Materials: the lava field is a
    band 0.2 rad either side of the lava direction from the crater to just past the shore (a flow levee a little
    proud of the slope, its toe a black tongue into the sea); the fertile band is every cone cell between 1.7 and
    4.2; three 2×2 vent sites at 0.62 of the cone's radius (low enough for a path to climb to: at 0.42 no walkable
    route reached them); a 3×3 hot spring on the bay's shore flats. Validation: ≥ 30 cells above 4, lava ≥ 25,
    fertile ≥ 40, vents ≥ 8 cells, spring ≥ 4; thresholds flats 180, region 70, treed 12 (48 trees on the lower
    slopes and above the band, none on it: the terraces go there).
16. **The Cinder's kinds:** taro and cocoa terraces (2×2 on the fertile band, 6 taro / 2.5 cocoa a cycle at full
    staff, half under ash); sulfur works (1×1 on a vent, 3 sulfur); the glassworks (2×2 flats, 3 glass a cycle,
    each burning 0.5 sulfur or, with none left, 1 timber; fire risk 5); the hot-spring bathhouse (2×1 on the
    spring, leisure radius 14 — the widest on the World — and ×1.5 on what tourists spend while it is staffed).
    BIOMES.md puts the hot spring on the "shore" class; the spring sits on the bay's flats, so its class is flat
    with the spring material. Basalt is not a good: it is `costs.seaWall` with half the timber (1.5).
17. **The eruption:** rolled at a settlement from cycle 12, 8 % a cycle, 16 apart; the roll books it two cycles
    out (the tremors: the tide clock says so, the view shakes and the vents steam), then at that settlement the
    lava flow runs from the crater down the lava direction (three cells wide, wandering with the ledger's RNG)
    until it is four half-steps into the sea; every building on its cells is damaged; every unbuilt, non-high
    cell it crosses becomes landfill that stays lava (unbuildable, glowing) for three cycles (`state.newLand`,
    `Grid.coolNewLand`), then opens. Ash falls the next cycle: every home −0.15, the terraces make half. The wave
    for the neighbours goes into the sea's outbox (`state.outbox`) for the World's event bus (Stage 4).
