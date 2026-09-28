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
18. **The Cinder's view:** the lava glow is one additive term in the terrain shader (`glowMat`, `glowColor`,
    `glowAmount`: new uniforms, the study's colour math untouched), 0.55 by day, up to full with the lanterns. The
    material code is now read from the nearest texel of the height texture: bilinear filtering blended two codes
    into a third (a plain/fertile border read as lava and glowed; every coast had faint seams of a wrong tint). The
    tremors shiver the view by `camera.targetScreenOffset` (the target never moves; off with reduced motion).
19. **The Dunes' shape:** along z, a mainland of dry sand and dune crests (high, above the tide) at the back, a
    band of tidal flats (the town's ground), a lagoon 0.75 deep, three sandbars (dune crests, flats down their
    flanks and in the troughs), then the sea; the headland (the only rock above 2) on the mainland's east end.
    The oases are low plates at 0.72 on the mainland (high class, green): the draft's hollows filled and drained
    with the sea's tide, which no oasis does. They are the only fresh water: coverage radius 3 from their cells
    (the ground-coverage hook the Delta's river uses). Date palms stand only round them.
20. **The Dunes' kinds:** date grove 2×2 on an oasis (5 dates); coffee terrace 2×1 beside one (2.5 coffee); sponge
    divers' hut 1×1 on the lagoon's edge (1.5 sponges each low water); great cistern 3×3 on the flats, water
    radius 16, 300$ (wells here reach 3: `serviceRadius`); the salt pan from the Delta (4 salt, no storm penalty —
    a sandstorm brings no rain). The dredger is 1×1 on a deep cell touching the harbor (`touches`), 220$ and no
    planks (the Dunes make none). BIOMES.md's "the harbor capacity halves" is read as the catch: silted, the piers,
    docks and harbor bring in half (`harbourFactor`), the same as half the boats working.
21. **The Dunes' weather:** the sandstorm is the storm variant (no rain, fire risk ×2, fog 0.75 for the view); at
    its end the harbour silts for 4 cycles unless a staffed dredger clears it at the next settlement. The drought
    comes every 10th cycle from 10: wells give nothing, the great cistern half ("cisterns drain"), and a home with
    no water coverage loses 0.3 happiness that cycle. The night market is decided at the settlement before a
    night (the settlements fall at dawn and dusk): a tavern and a market square in business and no storm → that
    night's tourist spending (collected at the dawn settlement) is doubled.
22. **Timberless coasts and the harbor:** the Atoll, the Delta, the Cinder and the Dunes make no planks, and the
    harbor costs 60. Until Stage 4 lanes bring planks the company's visit waits on the old plank order (which needs
    the harbor it pays for); Stage 5 decides.
23. **The Dunes' view:** `stars` on the look's sky drives a new sky uniform (`starField`: a second, denser, fainter
    layer of stars, additive; 0 elsewhere). The sandstorm's `fog` (0.75) is the haze: the terrain and water fog pull
    in (near ×0.4, far ×0.55 at full) and tint toward the sand, and the scene fog carries the same haze to the
    pieces, trees and boats only while it blows (so nothing floats clear of a hazed ground). The night market
    crowds the square and the tavern with six walkers each for the night. The island's outline is a superellipse
    with a ragged edge (the first cut was a hard box).
24. **The World ledger** lives beside the sectors (`tidewater.world`, `sim/lanes.ts`): the World's cycle, its own
    32-bit RNG (storms), the consignments at sea, the storms, events waiting for seas not being played, the
    company's route positions and recent purchases, and the last settlement's traffic per face. The World's clock:
    with the World up, every built sea settles once per TIDE_PERIOD of wall time (the World has no speed control);
    inside a sea, the World settles at each of that sea's peaks, just before the autosave (so what sailed is saved
    with the sea that sent it). The order the stored seas settle in is a parameter and never changes the result:
    every later step walks faces, goods and consignments in a fixed order (tested both ways, and in the fuzzer).
25. **Routing:** each settlement, for each good (registry order) and each harbor that wants it (face order), the
    nearest sea with a surplus (lane distance, then face) loads up to the want, the surplus and the first lane's
    room; the path is the shortest lane path. A consignment sails one hop a settlement. A lane out of a sea carries
    its cargo ships × CARGO_HOLD shared over its lanes (a harbor sails CARGO_SHIPS_PER_HARBOR; the shipyard builds
    up to CARGO_SHIPS_MAX more for 60$ + 30 planks + 10 iron once every fishing berth is full). A hub holds
    through-cargo overnight: HUB_BASE_PASS (5) units of a good a cycle on the quay, plus WAREHOUSE_CAP (100) per
    warehouse; what does not fit waits, split to what fits. Cargo whose lane has gone sails home; cargo that
    would overflow its destination's cap sails home. A cleared sea's cargo is lost with it.
26. **Money stays per sea.** BIOMES.md §4's "one treasury" is not in the stage list and would change every sea's
    ledger and the fuzzer's money audit; each sea keeps its purse, and the lanes move goods and people only.
27. **Migration:** a sea whose happiness is under IMMIGRATION_HAPPINESS, or that is full while content, sends up to
    MIGRANTS_PER_CYCLE residents (the unhappiest homes first) to the nearest connected sea that is content, has
    food and has connected homes free; they sail as passengers (outside the hold) and move in on landing.
28. **Weather and the event bus:** from the World's 6th cycle a storm is born on a random built face at 6 % a
    cycle; it blows there, then each settlement drifts to the neighbour it chose the settlement before, for four
    cycles. The sea it will reach next has `stormComing` and its tide clock says so a cycle early. A storm reaching
    the sea being played starts there at once (the settlement is its peak); one reaching a stored sea blows through
    it quietly (boats kept in, no losses: absence stays safe). An eruption's wave (a sea's outbox) goes to every
    built neighbour: the sea being played is warned at once ("the sea is uneasy", the wave at its next peak); a
    stored one holds it in the ledger until it is entered, then the same. Local storm rolls are unchanged.
29. **The company on the lanes:** every connected group of two or more harbors is one route, sorted by face; the
    ship calls at one harbor a cycle, in turn (`trade.routed`; a sea off every route keeps its own ship's clock).
    What it bought lately World-wide slides its prices: ×1 / (1 + bought / 60), the bought units fading ×0.85 a
    cycle. On a route it also buys a coast's favourite luxury beyond the town's own want line, at ×1.5.
30. **The World's view:** a lane is a dashed line of lantern light from one face through the edge's gate into the
    next; a cargo ship sails each leg with cargo on it through the World's cycle; a storm is a grey knot over its
    face, leaning toward its next. Inside a sea, the lanes' cargo ship (the trade ship in rust red, berthed further
    out) sails in the high water a consignment lands, and the ledger says "From <sea>: …". The card lists the
    sea's lanes and last tide's cargo in and out; the Trade panel lists every lane, what is at sea, the company's
    next calls and its slid prices, and the storms.
31. **Balance, the lanes (Stage 5):** measured with `test/balance.test.ts` (BALANCE=1), two things kept goods off
    the lanes entirely: the market sells every food above the town's reserve at each settlement, and the company
    bought a sea's whole stock of its own goods at every call. Now a sea sends a quarter of each food it grows
    itself (LANE_FOOD_SHARE: the neighbours want the variety; its market sells that much less); a luxury sails
    from the first unit (its maker has no use for it: level 3 wants a foreign one), a hub passing on only what is
    above its own want; on a lane route the company buys a sea's own goods only above half their cap. BIOMES.md
    §4's "surplus above the island's reserve" stays the rule for everything else.
32. **Background seas work their shifts.** A stored sea's quiet settlement now runs the cycle's high-water and
    low-water shifts first (boats land their catch, the flats, pots and paddies are worked; nothing is lost, no one
    swims), so a sea's fish and shellfish keep coming while another is played; before, only settlement-time
    producers ran and a stored sea starved of its own catch.
33. **Timberless harbors:** the Atoll, the Delta, the Cinder and the Dunes build their harbor for 780$ and no planks
    (600$ + the 60 planks at the company's plank price), through the coasts' `costs` hook; otherwise their first
    company purchase and their first lane waited on planks only a harbor could order.
34. **The Dunes' first oasis** sits just behind the flats where the town starts (x within 4 of the middle, z −7.5),
    so the dates are the first thing a new town can reach; the draft's oases were 12 cells back and the line to
    them cost more than the grove. The great cistern is 200$ (was 300): at 300 a town without it could not afford
    it before its second drought. Level 2 on the Dunes now lands at cycles 10–11.
35. **The packer, faster (Stage 6 audit):** a World settlement with eleven stored seas took ~2 s, nearly all of it
    in `compress` building phrase strings. The LZW dictionary is now keyed by (phrase code, next character) —
    the same phrases, the same codes, byte-identical output (checked against the old packer on random text and
    real saves), about ten times faster. The same settlement now takes ~100 ms.
36. **The World settlement runs as a job** (`worldJob`, a generator that yields after each stored sea is settled
    and after each is written): main runs it at most 4 ms a frame, so a peak never stalls the frame however many
    seas are built. Anything that reads or writes the stored seas or the ledger (entering or leaving a sea,
    founding, importing or clearing one, the console's `settle`, the page closing) finishes it first; the played
    sea is saved again when the job lands (what sailed from and to it).
37. **Audit fixes (Stage 6):** the island HUD's heading was the old game name on every coast; it is now the sea's
    name (set on entry and on rename). The Dunes' headland is a plateau with cliffs round it (the rock band takes
    the steep sides; its rock is the palette's sandy `#b9a98a`, so it stays pale). The globe's cargo ships are a
    little larger. A reload with twelve seas stalls one frame for ~2.2 s on this branch and on the original main
    alike (measured both); the monkey's slow runs near its forced reloads come from it — noted, not fixed here.
    (Profiled after the merge: it is the page load, not a stall in play — main.ts's startup builds all twelve
    globe miniatures synchronously, ~1.2 s of ~2.6 s. A follow-up in HANDOFF.md's backlog: build them one a frame.)
38. **Pirates v0 (Stage 8), behind `PIRATES_ENABLED = false`:** the World ledger keeps a presence (0..1) on every
    unbuilt face beside a lane (a neighbour of either end that nobody has built); each cycle it fades ×0.9 and grows
    by 0.004 per unit of cargo that sailed the lane. A hop's raid chance is the strongest presence beside it × 0.35,
    × 0.5 for a staffed fort at either end; a raid takes the whole consignment (the flow counts it as `raided`, so
    the conservation check still holds) and both seas hear of it. The fort is a base kind (2×2, flats or hill,
    300$, 3 workers) kept out of every catalog while the flag is off. **Where it stops:** no patrol ships, no Haven
    and no company reputation, nothing drawn on the World (presence, raids), no UI, no balance pass; the presence
    rules and numbers are first guesses. `settleWorldNow(…, { pirates: true })` runs it for tests.
