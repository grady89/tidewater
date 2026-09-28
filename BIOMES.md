# Tiny Tides — BIOMES

The design bible for the six biomes, how sectors on the World connect, and what flows between them.
Companion to CLAUDE.md (rules and the base catalog) and the World (globe) build. Nothing here changes the base
game's rules; a biome is a *delta* on the base catalog, never a second catalog.

---

## 0. Principles

1. **One world, one era, one catalog.** Sail-age coastal towns everywhere. Every biome runs the same ledger, the same
   tide clock, the same placement rules, the same stilt rule. A biome changes palette, terrain shape, tide range, what
   grows and swims, a handful of unique buildings and goods, one signature hazard, one signature moment.
2. **Asymmetry is the point.** Sectors only matter to each other when they make different things. Every biome has two
   natural foods, one luxury, one industrial good, and at least one thing it cannot make at all.
3. **The delta is small and the same shape for every biome:** ~12 palette swaps, 1 terrain shaper, 1 tide multiplier,
   3–4 unique buildings, 1–2 unique goods, 1 house/boat/walker variant set, 3 fauna props, 1 hazard, 1 event, 1 ambience.
   If a biome needs more than that to feel distinct, the distinctiveness is in the wrong place.
4. **Your absence is safe.** Islands you are not looking at keep producing and trading but never suffer hazards. Bad
   things happen on screen.
5. **Latitude is real.** The World stands on a face: two polar faces, a temperate ring of five, a tropical ring of
   five. Biome eligibility follows the band. Repeats are allowed and useful.

## 1. The World map

```
            [P0 Fjord]                     polar        (1 face)
   T1   T2   T3   T4   T5                  temperate    (5 faces, upper ring)
     R1   R2   R3   R4   R5                tropical     (5 faces, lower ring, staggered)
            [P1 Fjord]                     polar        (1 face)
```

- Adjacency is the dodecahedron's: each face touches five. A polar face touches all five of its ring; a ring face
  touches its two ring neighbours, one polar face, and two faces of the other ring.
- **Band eligibility:** polar → Fjord. Temperate → Tidewater, Delta, Dunes. Tropical → Atoll, Cinder, Delta.
  (Delta exists at both latitudes. BAND_GATING in config turns this on; off, any biome anywhere, card still shows band.)
- **Sea lanes** run along shared edges between two built sectors that each have a Harbor. A lane is the only way goods,
  people and weather cross. Unbuilt faces are open sea: nothing crosses them except weather and pirates.
- **Connected** = reachable through a chain of lanes. Two built sectors with an unbuilt face between them are not
  connected until that face is built with a harbor, or until they touch each other.

## 2. Goods

Base goods (exist today): money (global), fish, shellfish, smoked goods, timber, planks, boats.

New goods, by role. Foods feed residents and drive house levels; luxuries drive level 3; industrials feed buildings.

| Good | Role | Made in | Wanted by |
|---|---|---|---|
| rice | food (staple) | Delta | everyone (food variety) |
| coconut | food | Atoll | food variety |
| dates | food | Dunes | food variety |
| crab | food | Delta | food variety |
| stockfish | food (preserved) | Fjord (needs salt) | food variety; ships' stores |
| pearls | luxury | Atoll | Delta favourite; any L3 |
| cocoa | luxury | Cinder | Fjord favourite; any L3 |
| indigo | luxury | Delta | Cinder favourite; any L3 |
| whale oil | luxury + industrial | Fjord | Dunes favourite; lanterns anywhere burn brighter |
| coffee | luxury | Dunes | Tidewater favourite; any L3 |
| smoked goods | luxury (already exists) | Tidewater | Atoll favourite; any L3 |
| salt | industrial | Delta, Dunes | Fjord stockfish racks; Tidewater smokehouse +yield |
| iron | industrial | Fjord | Toolworks anywhere: +20% output radius; shipyards' larger hulls |
| glass | industrial | Cinder (sand + fuel) | Lighthouse upgrade; lantern night coverage +; tall house windows |
| sulfur | industrial | Cinder | glassworks fuel; fireworks event |
| sponges | minor trade | Dunes, Atoll | trade ship only |

**Food variety rule** (replaces the single food pool): a house needs 1 food kind to be fed, 2 distinct kinds to reach
level 2, 3 distinct kinds to reach level 3. Every biome makes exactly 2 natively, so level 2 is reachable alone and
level 3 needs a lane.

**Luxury rule:** level 3 also needs any one foreign luxury in stock. A biome's *favourite* luxury gives +happiness on top.
The favourites form a ring so every luxury has a home:
Tidewater →(smoked goods)→ Atoll →(pearls)→ Delta →(indigo)→ Cinder →(cocoa)→ Fjord →(whale oil)→ Dunes →(coffee)→ Tidewater.

**Cannot make:** Atoll and Delta have no timber (palms and mangroves don't mill); Dunes has neither timber nor much
fresh water; Fjord has little flat land; Cinder has little soil except one band; Tidewater has no luxury crop.

## 3. The biomes

Every biome section has the same headings so the build prompt can iterate over them.

### 3.1 Tidewater — temperate (exists)
- **Character:** the game as it is. Grey-green water, sand flats, conifers on the hill, red and slate roofs.
- **Terrain shaper:** the current generator.
- **Tide:** ×1.0.
- **Native foods:** fish, shellfish. **Luxury:** smoked goods. **Industrial:** timber, planks.
- **Unique buildings:** none beyond the base; this is the base. (Toolworks and the luxury/variety rules are added to the base for all.)
- **Fauna:** gulls, crabs, sharks.
- **Hazard:** storms. **Event:** the tsunami (random, or sent by a Cinder eruption on an adjacent face).
- **Variants:** dory boats, gable roofs, knit caps.
- **Ambience:** surf and gulls (exists).

### 3.2 Atoll — tropical
- **Character:** a ring of low motu around a shallow turquoise lagoon. Palms, white sand, thatched round huts, outriggers. The brightest water on the World.
- **Palette:** water shallow `#9fe8dc` / mid `#3fc4c8` / deep `#1a6fa0`; sand `#f4ecd4`; foliage `#5faa5a`, `#8cc46a`; thatch `#c9a86a`; walls `#f7f1e3`; accents `#e0705a`.
- **Terrain shaper:** ring: land where |r − 0.62| is small; inside the ring a *lagoon* (deep class, but −0.9..−0.3 so it is shallow, bright and pier-friendly); outside the ring the drop to true deep. Few high cells (palm motu 0.7–1.4). Lots of flats. One or two passes through the ring for ships.
- **Tide:** ×0.6. Springs expose the reef flats: bonus shellfish and the turtle event.
- **Native foods:** fish, coconut. **Luxury:** pearls. **Industrial:** none (imports planks). Minor: sponges.
- **Unique buildings:** Dive platform (lagoon edge, 1×1, 2 workers → pearls at low water, needs a Pearl house within radius to grade them); Pearl house (flat 2×1, 2 workers, pearls → graded pearls for trade); Coconut grove (flat cells with palms, roams like the clam camp); Reef nursery (lagoon cell, restores fish density and coral health in radius, needs pollution below threshold).
- **Fauna:** sea turtles (beach at night, lagoon by day), reef fish shoals as colour patches, frigatebirds instead of gulls.
- **Hazard:** cyclone (a storm with ×2 swell; breakwaters matter more; palms bend). Coral bleaching: pollution above threshold turns lagoon cells pale and drops fish density hard; nurseries recover it.
- **Event:** turtle hatching: on a spring night, hatchlings cross the beach; every lantern within radius 4 of a beach cell must be off (auto) or the town loses happiness; success gives a lasting tourism bonus.
- **Variants:** outrigger canoes; round thatched huts (cone roofs); straw hats. Houses level up by adding a verandah, then a second storey.
- **Ambience:** birds, softer surf, wind in palms.

### 3.3 Fjord — polar
- **Character:** dark steep water between two ridges, pines to the shoreline, stave-style dark timber houses with steep roofs, a huge tidal range that empties the head of the fjord twice a cycle. Aurora at night.
- **Palette:** water shallow `#7fb7b0` / mid `#2b6f78` / deep `#10303f`; sand `#a9a08a` (grey shingle); rock `#6b6a66`; foliage `#2f5e3a`, `#3f7346`; walls `#3d2e26`, `#5a4636`, `#8a3f33`; roofs `#2b2b2b`, `#5d6d7a`; snow on high cells above 4.0 `#eef2f5`.
- **Terrain shaper:** elongated island with a deep channel down the middle; steep ridges either side (high 3–9); flats only at the head of the fjord and on a few ledges; deep water hugs the shore, so deep docks are cheap and piers rare. Dense trees on slopes.
- **Tide:** ×1.6. Springs are brutal (walkway flooding is the Fjord's constant lesson) and the low exposes the largest flats on the World.
- **Native foods:** fish, stockfish (rack needs salt; without salt it makes plain dried fish at half value). **Luxury:** whale oil. **Industrial:** iron (mine on high cells), timber.
- **Unique buildings:** Stockfish racks (flat 2×1, 2 workers, fish + salt → stockfish; works in cold air, i.e. any time); Whaling station (edge 3×2, 6 workers, needs a boat slot; only in whale season; whale oil + meat as food); Iron mine (high 2×2, 4 workers, iron; raises fire risk nearby); Ice house (flat 1×1, keeps fish from spoiling: doubles fish cap).
- **Fauna:** seals on the shingle at low water, whale spouts in season, puffins on the cliffs.
- **Hazard:** sea ice: every Nth cycle the harbor freezes for one cycle (no boats, no lanes); an Ice-breaker pier (unique, expensive) keeps one lane open. Avalanche on the steepest treed slopes after storms damages what is below.
- **Event:** whale season: three cycles when the whales pass; the station runs, spouts everywhere, a bell. Aurora on clear nights (happiness).
- **Variants:** longboats; steep-pitched dark stave houses; hooded coats.
- **Ambience:** wind, distant ice creak, a low horn.

### 3.4 Delta — temperate or tropical
- **Character:** a braided river mouth: low reed islands between channels, mangroves, stilt houses with reed thatch, sampans, rice paddies on the flats that flood with the tide. Fireflies and frogs at night, flamingos by day.
- **Palette:** water shallow `#b8c9a8` (silty) / mid `#5f8f7a` / deep `#2c5a5e`; sand `#cfc3a0` (mud); reeds `#a9b56a`; mangrove `#3e6b4a`; thatch `#b89a63`; walls `#e9dfc0`, `#d9c9a5`; roofs `#8a6f52`, `#4c5a66`.
- **Terrain shaper:** almost no high ground (a levee 0.7–1.2 along one edge where the river enters); many channels (deep class, −0.6..−1.5) braiding through a wide field of flats; *mangrove* cells (flat cells with trees; must be cleared to build; clearing raises pollution briefly); river inflow on the high edge.
- **Tide:** ×1.0 plus a river level that swells every 6th cycle; when a river swell meets a spring tide it is a **king tide** (+0.3 on top of spring).
- **Native foods:** rice, crab. **Luxury:** indigo. **Industrial:** salt.
- **Unique buildings:** Rice paddy (flat 2×2, 3 workers; planted at low water, flooded at high, harvested every 2 cycles; needs fresh water coverage from the river side); Crab pots (channel-edge 1×1, 1 worker); Salt pan (flat 2×2 above high tide, 2 workers; sun-dried salt, halved in storms); Indigo vats (flat 2×1, 3 workers, indigo from delta plants in radius; a pollution emitter, so place it downstream).
- **Fauna:** flamingos on the flats, herons, crocodiles (the shark role, in channels), fireflies at night.
- **Hazard:** crocodiles at any channel edge near houses (nets and a warden tower, the lifeguard role). King tide floods low standard walkways and unraised paddies. Fever season every 8th cycle: productivity down unless clinic coverage.
- **Event:** rice harvest at spring low: every paddy harvests at once, walkers stream out, the market floods with rice; the best trade cycle of the Delta.
- **Variants:** sampans; reed-thatched stilt houses with wide eaves; conical hats.
- **Ambience:** frogs, insects, water birds, rain more often.

### 3.5 Cinder — tropical
- **Character:** a volcanic cone rising from black sand, steam vents, hot springs, basalt houses with flat roofs, a fertile green band on the mid-slope where cocoa grows. The sea glows orange at night where the lava reaches it.
- **Palette:** water shallow `#6fbfb8` / mid `#2a8e96` / deep `#123f57`; sand `#2e2a2a` (black); rock `#4a4644`; lava field `#1c1a1a` with glow `#ff6a2a`; foliage `#3f8a4a`, `#79ad5e`; walls `#5a5350`, `#8d8a83`; roofs `#c9674f`, `#3d3a3a` (flat basalt).
- **Terrain shaper:** central cone (high, 5–9) with radial ridges; narrow black flats around the base; deep water fast. A *lava field* material band on one flank (rock, unbuildable, glows). A fertile band on the mid-slope (high cells that allow the Cocoa terrace).
- **Tide:** ×1.0.
- **Native foods:** fish, taro (a terrace crop on the fertile band). **Luxury:** cocoa. **Industrial:** glass (glassworks: black sand + sulfur or timber fuel), sulfur (vents on high cells), basalt (a cheap stone for sea walls: half timber cost).
- **Unique buildings:** Cocoa terrace (fertile high 2×2, 3 workers); Glassworks (flat 2×2, 4 workers, sand is free, needs sulfur or timber, fire risk source); Sulfur vent works (high 1×1 on a vent site, 2 workers); Hot-spring bathhouse (shore 2×1 on a spring site: the strongest leisure building on the World; tourism magnet).
- **Fauna:** iguanas on the black sand, boobies, glowing plankton at night in the shallows.
- **Hazard:** eruption: foreshadowed for two cycles by tremors (screen shake, steam), then ash falls (happiness down, paddies/terraces halved for a cycle) and a lava flow runs down one flank into the sea, damaging what it crosses **and creating new land** (free landfill cells that become buildable after three cycles of cooling). An eruption also sends a tsunami to every adjacent built face, arriving next cycle with the existing warning.
- **Event:** the cooled flow: three cycles after an eruption, the new black land opens; the town grows onto ground that did not exist before.
- **Variants:** dugouts with a single sail; flat-roofed basalt houses; bandanas.
- **Ambience:** low rumble, steam hiss, surf on gravel.

### 3.6 Dunes — temperate
- **Character:** a desert coast: long sandbars and a lagoon behind them, dunes with no trees, whitewashed cube houses with small domes, lateen-sailed dhows, date palms only at the oases. The clearest night sky on the World.
- **Palette:** water shallow `#a6dcd0` / mid `#3aa3a8` / deep `#1d5f86`; sand `#efe2b8`; dune `#e2cf9a`; rock `#b9a98a`; palm `#6d9c55`; walls `#f6f1e6`; roofs `#d9c9a5` (domes) and `#4c5a66`; accents `#2f6f8f` (doors).
- **Terrain shaper:** parallel sandbars (flats and low high cells 0.6–1.6 that are sand, not treed) with a shallow lagoon behind; a rocky headland at one end with the only high rock; two or three *oasis* sites (the only fresh-water cells).
- **Tide:** ×0.8.
- **Native foods:** dates, fish. **Luxury:** coffee (grown at oases). **Industrial:** salt. Minor: sponges.
- **Unique buildings:** Date grove (oasis 2×2, 2 workers); Coffee terrace (oasis-adjacent 2×1, 3 workers); Sponge divers' hut (lagoon edge 1×1); Great cistern (flat 3×3, the water building: coverage radius 16, without it wells cover radius 3; the Dunes' first real purchase); Dredger (harbor add-on: clears silt each cycle).
- **Fauna:** pelicans, dolphins in the lagoon, ghost crabs on the sandbars at night.
- **Hazard:** sandstorm (a storm variant: no rain, fire risk *up*, visibility down, and the harbor silts: capacity halves until dredged). Drought every 10th cycle: cisterns drain, uncovered houses lose happiness fast.
- **Event:** the night market: on clear nights with a tavern and a market square, walkers gather under lanterns; tourism doubles that cycle.
- **Variants:** dhows with lateen sails; cube houses with domes; head wraps.
- **Ambience:** dry wind, sand hiss, distant dhow bells.

## 4. What crosses a lane

- **Goods.** Each cycle the World ledger computes surplus (stock above the island's reserve) and deficit per good per
  island, then moves goods along shortest lane paths. Throughput per lane = cargo ships assigned to it (each Harbor
  contributes CARGO_SHIPS_PER_HARBOR; the Shipyard builds more with iron) × hold size. One cycle of delay per hop.
  An intermediate island's warehouse cap limits what can pass through it, so hubs need warehouses.
- **People.** Slow migration from unhappy or full islands to connected islands with free connected housing.
- **Money.** One treasury. Building anywhere spends it; every market and trade ship on every island fills it.
- **Weather.** A storm is born on a face and drifts to an adjacent face each cycle, visible on the World as a cloud
  knot; islands see it coming a cycle early. Cinder eruptions send tsunamis to adjacent built faces.
- **Pirates (later phase).** Unbuilt faces adjacent to a lane host a pirate presence that grows with the lane's traffic.
  Raids take a cargo ship's hold. A Fort on either end and Patrol ships cut raid chance; a Haven building allies with
  them at the cost of Trade Company reputation, which raises the company's buying prices when high.
- **The Trade Company.** The existing trade ship becomes the company's ship: it visits every harbor on a route across
  connected faces, buys luxuries at prices that fall as you export more of the same, and pays a premium for a
  luxury's *favourite* biome delivering it.

## 5. Visual and ledger deltas the engine must support

- `SimState.world.biome` (id) beside `seed`. Sector metadata carries it; the World's faces tint by it.
- Terrain shaper per biome in `sim/island.ts` (a function of seed and biome); validation thresholds per biome
  (Atoll needs a lagoon and a pass; Fjord needs a channel; Delta needs a river edge; Cinder needs a cone; Dunes needs an oasis).
- Cell *materials* beside classes: lagoon, mangrove, lava, dune, oasis, vent, spring, fertile. Classes stay deep/flat/high
  for every rule; materials gate unique buildings and colour.
- Tide multiplier per biome; Delta's river swell; Fjord's ice cycles; Dunes' drought.
- Catalog = base ∪ biome unique − biome excluded (lumber camp where no trees, oyster bed → reef/lagoon variants, etc.).
- Palette per biome consumed by terrain, water, sky fog, buildings, walkers, boats, trees. One `biome.ts` per biome
  under `src/sim/biomes/` (ledger side: goods, buildings, hazards, tide) and `src/view/biomes/` (palette, variants, fauna, ambience).
- Fauna and variants are thin-instance kits with a per-biome pick, not new systems.
- Ambience is the existing procedural audio with per-biome parameters.

## 6. Build order (each step playable)

1. **Base additions for every biome:** food variety, luxury rule with favourites, Toolworks (iron), house levels reading them, cell materials, biome id in state and on the World's faces.
2. **Fjord and Atoll.** Maximum contrast, both remaining bands, both make things Tidewater cannot. Trade has something to carry.
3. **Sea lanes:** harbors, cargo ships, surplus/deficit flow, hop delay, hub warehouses, the company's route. Storm drift across faces.
4. **Delta and Cinder.** The eruption-makes-land mechanic and the king tide are the two most memorable systems on the list; they land once lanes exist to carry what those islands make.
5. **Dunes**, then pirates, then the capstones below.

## 7. Capstones (one per biome, very expensive, globe-visible)

A capstone is the biome's wonder; it shows on the World's face and gives a world-wide bonus. Great Lighthouse (Tidewater:
no boats lost to storms anywhere connected), Pearl Temple (Atoll: +tourism everywhere), Whalebone Hall (Fjord: +1 cargo
ship per harbor), Great Sluice (Delta: king tides do no damage on connected faces), Observatory (Cinder: eruptions and
storms foreseen two cycles out everywhere), Great Cistern of the Coast (Dunes: droughts end). Filling the World and
raising all six is the long game.

## 8. As built (where the build departs from the above; docs/world/decisions.md has the reasons)

- **Delta:** rice grows at low water and the harvest comes at a spring low (the spring-low bonus never paid before
  this build: decisions #3); the river swell is +0.15 every sixth cycle, the king tide +0.30 on a spring peak; indigo
  counts open flats near the vats, not mangroves; fever season every eighth cycle lays a quarter of the residents up
  away from a clinic.
- **Cinder:** the hot-spring bathhouse stands on the spring's flat cells (the design said shore); basalt is not a good
  but a cheaper sea wall (half the timber); the eruption rolls from cycle 12 at 8 % a cycle, 16 apart; the flow's new
  land stays unbuildable three cycles; ash the cycle after halves the terraces and costs every home 0.15.
- **Dunes:** the oases are low plates above the tide (not tidal hollows) and the first sits just behind the starting
  flats; the great cistern costs 200$; "the harbor capacity halves" is half the catch while silted; the drought dries
  the wells and halves the cistern; the night market is decided at the dusk settlement.
- **Timberless coasts** (Atoll, Delta, Cinder, Dunes) build their harbor for 780$ and no planks.
- **§4 What crosses a lane:** goods — foods by a share (a quarter of what a sea grows, the market having sold the rest
  above the reserve), a maker's luxury from the first unit, everything else above 0.3 of its cap; a hub passes 5 units
  of a good a cycle plus 100 per warehouse. People — up to 2 a cycle from an unhappy or full sea. **Money — not
  shared:** each sea keeps its purse. Weather — World storms are born on built faces (6 % a cycle from the sixth World
  cycle), blow four cycles, and a stored sea only keeps its boats in; the local storm roll is unchanged. Eruptions
  send a wave to every built neighbour (a stored one gets it on entry). The company visits one harbor a cycle along
  each connected group; its price slide is World-wide and lasting (×1 / (1 + recently bought / 60), fading ×0.85 a
  cycle); the favourite premium is ×1.5 for a luxury sold by the coast whose favourite it is.
- **Pirates** are a v0 in the World ledger behind `PIRATES_ENABLED` (off): presence on unbuilt faces beside busy
  lanes, raids that take a cargo ship's hold, and the Fort (half the chance at either end). No patrol ships, Haven or
  reputation yet.
- **Not built:** the capstones, one treasury.
