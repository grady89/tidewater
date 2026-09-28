DONE | `LANES_ENABLED = true` in config.ts, the flag kept (settleWorld is a no-op without it) |DONE | globe/lanes.ts (dashes through the edge gates, cargo ships, storm knots), the in-sea cargo ship, the ledger line, the card rows, the Trade panel — #30 |DONE | #29; money stays per sea (#26) |DONE | World storms (born, drift, seen a cycle early); eruption waves to built neighbours; `pending` for stored seas, applied on entry — #28 |DONE | #27 |DONE | consignments on shortest lane paths, a hop a settlement, split to the lane's hold and a hub's warehouse room; cargo ships from the shipyard — #25 |DONE | `tidewater.world`; the World clock in main (idle: every TIDE_PERIOD of wall time; in a sea: at its peaks, before the autosave); orderings tested (unit + fuzzer) — decision #24 |# The connected World — progress ledger (branch `world`)

The truth for the overnight build. Statuses: TODO / IN PROGRESS / DONE / BLOCKED. After any compaction, or
whenever unsure: re-read CLAUDE.md, BIOMES.md and this file, then continue from the first item that is not
DONE. Update after every step. Build + test + smoke green before every commit; commit per step; push `world`
after each stage; never push `main`. Calls BIOMES.md leaves open go in `docs/world/decisions.md`.

Last thing that worked: Stage 6 — review and audit (shots, sheets, the four-sea World, the faster packer, the World job, the sea's name on the HUD); build, test, smoke green.

## Stages

| # | Stage / step | Status | Notes |
|---|---|---|---|
| 0 | Ledger: this file, decisions.md | DONE | |
| 1a | Shared hooks the three coasts need, as data on the Biome and the catalog (no biome-id branches): per-kind producers and a shift hook, tide surge (river swell / king tide) with the building clearance following it, predator naming and a net flag, static coverage sources, service-radius overrides, per-coast costs, storm variants (rain, fire, fog, chance), per-kind pollution and fire emitters, console force events, material rules on clearing | DONE | 890cd4e; eight fuzz seeds over the three coasts: identical hashes |
| 1b | Delta, sim (BIOMES.md §3.4): shaper (river on the high edge, braided channels, flats, mangrove, levee), swell every 6th cycle and the king tide, rice paddy / crab pots / salt pan / indigo vats / warden tower / croc net, crocodiles in the shark role, fever season, the rice harvest, mangrove clearing, rain more often, validation; tests | DONE | decisions #2–#14; also fixed the spring-low bonus that never paid (#3) |
| 1c | Delta, view: look, sampans, reed stilt houses with wide eaves, conical hats, mangroves, flamingos / herons / crocodiles / fireflies, the kinds' meshes, frogs / insects / rain; smoke section; shots | DONE | view/fauna.ts holds every later coast's creatures; view/pieces/ the coasts' meshes; the look's `bands` shift brings the reeds down the flats |
| 2a | Cinder, sim (§3.5): shaper (cone, radial ridges, black flats, lava band, fertile band, vents, springs), taro / cocoa terraces, glassworks, sulfur works, hot-spring bathhouse, basalt sea walls, the eruption (tremors, ash, lava flow, new land cooling three cycles), a tsunami queued for the neighbours; validation; tests | DONE | decisions #15–#17; the wave goes to `state.outbox` for the World event bus (4d) |
| 2b | Cinder, view: look, dugouts, flat-roofed basalt houses, bandanas, iguanas / boobies / glowing plankton, lava glow, tremor shake and steam, ash, rumble / hiss; the kinds' meshes; smoke; shots | DONE | the glow is one additive term on a material code (uniforms only); the material code is read from the nearest texel, so a blend of two codes is no third material (it drew seams on every coast) |
| 3a | Dunes, sim (§3.6): shaper (sandbars, lagoon, dunes, headland, oases), date grove, coffee terrace, sponge divers' hut, Great Cistern, dredger, wells cover 3, sandstorm (no rain, fire up, harbor silts), drought, night market; validation; tests | DONE | decisions #19–#22; the oases are dry plates, not tidal hollows; the salt pan is shared with the Delta |
| 3b | Dunes, view: look, dhows, domed cube houses, head wraps, pelicans / dolphins / ghost crabs, sandstorm haze, the clearest stars, dry wind and sand; meshes; smoke; shots | DONE | the haze reaches the pieces through the scene fog while it blows; the island's outline is a ragged rounded box |
| 4a | World ledger: the world clock (idle World settles every built sea once per TIDE_PERIOD; in a sea, at the active peaks), the World record, order-independent settlement; test that two orderings give one hash | TODO | |
| 4b | Routing: consignments on shortest lane paths, a hop a cycle, lane throughput = cargo ships × CARGO_HOLD, hub caps, cargo ships from the shipyard (planks + iron) | TODO | |
| 4c | People: migration from unhappy or full seas to connected seas with room, on a cargo ship | TODO | |
| 4d | Weather and the event bus: storms born on a face drift to a random neighbour each cycle; a sea sees one a cycle early; eruptions queue tsunamis for adjacent built faces; pending events per sector, applied at its next settlement or on entry | TODO | |
| 4e | The Trade Company sails the lanes: one route per connected component, one harbor a cycle, the price slide persisting, the favourite-coast premium; unconnected seas keep the standalone visit | TODO | |
| 4f | View: lanes on the World, cargo ships travelling them, the storm knot; in a sea a cargo ship from the deep edge and a ledger line "from <sea>: …"; the card's connections, imports and exports; a World Trade panel | TODO | |
| 4g | LANES_ENABLED = true (flag kept) | TODO | |
| 4h | Tests (multi-hop + hub limit, migration, storm drift, eruption across faces, company route, idle World), smoke (adjacent harbors trade within three cycles, the lane and a ship on the World, an eruption warns its neighbour), fuzzer World mode (goods conserved across a hop, no negative stock, hash-stable ordering) | DONE | test/lanes.test.ts (15), fuzz.test.ts World run (two orderings, one hash), fuzzWorker plays a three-sea World on every seventh seed; the smoke's lanes section |
| 5 | Balance: each new coast's starter positive in 4 cycles, level 2 ~8, level 3 ~15 with a company purchase; two connected seas reach level 3 without purchases by ~20; a hub without a warehouse throttles; NOTES.md | DONE | decisions #31–#34; test/balance.test.ts (BALANCE=1) is the probe; the numbers are in NOTES.md (Session F) |
| 6 | Review and audit: each new coast beside Tidewater at noon and dusk (biomeShots.ts), cohesion audit, the World with four seas, two lanes and a ship; fixes; monkey 5 min from the World with lanes on | DONE | shots/biomes/ (noon, dusk, night per coast; sheet-noon.png and sheet-dusk.png beside Tidewater), shots/globe/world-four-seas.png; the packer 10× faster and the World settlement a job (#35–#36); audit fixes #37; monkey 5 min from the World: one run passed (worst slow run 1.84 s), one flagged 2.08 s at a forced reload (pre-existing boot stall, #37), one lost its page to a dev-server reload while I edited |
| 7 | Docs: ARCHITECTURE.md, HANDOFF.md (World section), BIOMES.md deviations, NOTES.md, this file | TODO | |
| 8 | Only if everything above is DONE and nothing BLOCKED: pirates v0 behind PIRATES_ENABLED = false | TODO | |

## Blocked
(none)

## Run log
- 2026-09-28 · start · branch `world` from main 879b19e (World polish two, the dive hand-over, the Fjord's back shore)
- 1a committed 890cd4e (fuzz hashes unchanged); a smoke worktree at ../tidewater-smoke (node_modules linked) runs each smoke on a mirror of the working files so work continues meanwhile
- 1b: Delta ledger; 151 unit tests, smoke green (129 s)
- 1c: Delta view; the first 1c smoke failed on the harvest (its well was off the street: no coverage), fixed in the smoke; green (131 s)
- 2a: Cinder ledger; 157 unit tests, smoke green (131 s)
- 2b: Cinder view; the first smoke failed (terraces unreached: a steep join), placeJoined now tries the next nearest street; green
- 3a: Dunes ledger; 164 unit tests, smoke green
- 3b: Dunes view; smoke green (153 s)
- 4: sea lanes; the first smokes failed on the card (it showed the wrong face) and on a ship hidden under the miniature's water; green
- 5: balance; smoke green (154 s)
- 6: review and audit; smoke green (154 s); monkey 5 min: 8806 actions (2.08 s slow run at a reload), rerun seed 2: 5798 actions, pass
