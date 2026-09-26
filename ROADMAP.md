# Tidewater — ROADMAP

Ordered milestones. Each has acceptance checks. Work them top to bottom; do not start a later milestone before the
earlier one's checks pass, except to unblock. PROGRESS.md tracks status per milestone: TODO / IN PROGRESS / DONE / BLOCKED(reason).

Definition of done for every milestone: `npm run build` passes, `npm run test` (sim unit checks) passes, `npm run smoke`
(headless Playwright scenario + screenshot to `shots/`) passes, committed, PROGRESS.md updated with a two-line status.

## M0 — Harness (do first, keep small)
- `npm run test`: vitest (or node's test runner) for `src/sim/**` only; sim must import nothing from Babylon.
- `npm run smoke`: Playwright launches headless Chromium (`executablePath` from the local Chrome or `npx playwright install chromium`),
  loads the dev server, waits for `window.__tidewater.ready`, runs a scenario via the console API, asserts, saves a PNG.
- `window.__tidewater` exposes: `sim` (state), `place(type, i, j)`, `remove(i, j)`, `setTide(level)`, `advance(cycles)`,
  `setSpeed(n)`, `fields`, `ready`. Every later milestone adds to the smoke scenario.
- Checks: both scripts run green on the current codebase.

## M1 — Ledger refactor
- Move all state into `src/sim/state.ts` as a plain JSON object; fixed-timestep tick; existing placement writes to the sim,
  view reads from it. Existing grid/network/tide become sim modules.
- Save/load: `save.ts` serializes state + grid; `load` rebuilds the view from it. Autosave each cycle to localStorage; "new town" clears.
- Checks: place 5 pieces, save, reload page, all 5 present; sim unit test advances 3 cycles deterministically twice with equal hashes.

## M2 — Money loop
- Resources bar; money; costs; hut/house; pier; first two boats purchasable; fish market; boats fish at high water (ledger
  only, no boat mesh movement yet); market sells fish; taxes and upkeep.
- Workers: population, jobs, nearest-first assignment over the network; output scales with filled fraction.
- Immigration: residents arrive when housing connected + food + happiness threshold (simple happiness: food + job).
- Checks: from a fresh town, scripted placement (pier, 2 boats, 3 huts, market, walkways) yields positive net money over 4 cycles;
  removing the walkway to the market stops sales.

## M3 — Tide splits the economy
- High-water vs low-water producers. Oyster bed and clam camp; shellfish; spring tides (bonus low, flooding high); deep dock; raised walkway.
- Ghost fate tint for tide-sensitive pieces. Tide clock shows next spring.
- Checks: oyster bed produces only in low-water phases; pier boats don't sail in low water; deep dock boats do; a standard
  walkway on terrain 0.1 is cut at spring high and workers beyond it don't count that phase.

## M4 — The town looks alive
- Walkers (thin instances) on the walkway graph at shift change, capped, idle loiterers at market square/beach.
- Boats as meshes: depart pier/dock at high water along a deep-water BFS path to their chosen ground, bob with the wave
  function, return before low water; sit heeled on the mud at piers at low water. Boats have a hull color and a sail.
- Day/night from the study's lerp; lanterns light at dusk.
- Checks: smoke screenshot at high water shows ≥ 3 boats away from docks; at low water ≥ 3 boats at docks; walker count > 0 at shift change; fps ≥ 60 in headless (measure with `engine.getFps()` averaged over 5 s; log it).

## M5 — Production chain
- Lumber camp (trees fell and regrow visibly), sawmill, planks, tall house, shipyard building boats automatically, warehouse caps, net loft, smokehouse → smoked goods.
- Build menu categories with prerequisites and reasons.
- Checks: scripted town reaches a shipyard-built boat within 12 cycles; caps enforced; tree count drops near camp then recovers.

## M6 — Pollution and the outfall
- Waste per house; outfall; pollution field with decay, diffusion, tide advection; treatment plant; overlays UI (pollution first, generic for all fields).
- Oyster beds die in pollution; fish density field with regen and depletion; boats choose richest ground in range.
- Checks: outfall next to oyster beds kills them within 4 cycles; with a treatment plant they survive; fish density near a fished ground drops then recovers; pollution field drifts shoreward on rising tide in the unit test.

## M7 — Happiness, services, leveling
- Full happiness formula; well/cistern, bathhouse, tavern, shrine, market square, lantern coverage; house leveling with visual change; info panel on click; notifications feed.
- Checks: a house with all coverages reaches level 3 within 8 cycles; removing the well drops happiness in the unit test.

## M8 — Beaches and sharks
- Beach derivation; swimmers at high water in daytime; shark risk field from market/docks; incidents; injuries; clinic; lifeguard tower; shark nets. Fin mesh that patrols risky water (view only).
- Checks: beach next to market with no lifeguard produces ≥ 1 incident over 10 cycles in the unit test (seeded); with lifeguard + nets, 0.

## M9 — Trade and tourism
- Harbor, trade ship path and berth, buying/selling at trade prices, plank purchase queue, inn, tourists that spend, lighthouse effect on cadence.
- Checks: with harbor + inn, tourists arrive and money from tourism > 0 over 6 cycles; the ship is visible entering and leaving in screenshots.

## M10 — Fire
- Fire risk field, ignition, spread along adjacent wooden pieces, burnt = damaged, fire watch, storm rain zeroes risk, burning/smoke effect (view).
- Repair system shared with M11 (auto-pay, damaged tint, tilted roof).
- Checks: seeded unit test: a smokehouse cluster with no fire watch burns within 30 cycles; with fire watch it doesn't; damaged buildings produce 0 until repaired.

## M11 — Storms and the tsunami
- Storm event: light/sky lerp, wave amplitude uniform, boats stay in, losses outside breakwater shelter, lighthouse protection. Breakwater and sea wall pieces with shielding logic.
- Tsunami: cooldown/chance, 20 s drawdown (tide plunge, boats heel), wave sweep uniform on the water shader (new uniform only), impact damage with shielding, notification.
- Checks: forced tsunami via console API damages unshielded flats buildings and spares those behind a sea wall; forced storm loses a boat at an unsheltered pier in the seeded test and none behind a breakwater.

## M12 — Camera, polish, save slots, tutorial
- Pan (drag + WASD), zoom limits that fit the town, three save slots with names, "new town", 5-step notification tutorial, speed controls polish, unaffordable/greyed states everywhere, empty-state hints.
- Performance pass: thin instances for all repeated props, merged static meshes per grid chunk (8×8), overlay rendering as one mesh.
- Checks: 300 buildings + 200 walkers + 30 boats scripted; fps ≥ 60 logged in headless; load of a saved 300-building town < 2 s.

## M13 — Audio
- Procedural surf, shift bell, tsunami thrum, mute, starts on first click.
- Checks: no console errors; audio context resumes on click.

## M14 — Ship it
- `npm run build` → dist/; a `README.md` with controls and a screenshot; HANDOFF.md fully rewritten: what exists, what's known-broken, balance notes, ideas backlog.

## If everything is DONE and time remains — backlog, in order
1. Planar reflections on the water (Babylon MirrorTexture) behind a quality toggle.
2. Caustics in the shallows (new uniform + noise in the water shader's shallow band — additive only).
3. Seagulls (thin instances circling docks), crabs on exposed flats at low water.
4. Building variety: 3 roof shapes per house level, randomized per placement (seeded).
5. Districts: name a cluster; district stats in the info panel.
6. Second island unlock via harbor (ferry).
7. Achievements/milestones popups (first boat, 50 residents, first trade).
