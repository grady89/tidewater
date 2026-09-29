// Fire, storms and the tsunami.
import { describe, expect, it } from "vitest";
import { TIDE_PERIOD } from "../src/config";
import { BOAT_COST, BOAT_CREDIT_EVERY, BUILDINGS, DRAWDOWN_LEVEL, DRAWDOWN_SECONDS, FIRE_BURN_SECONDS, FIRE_IGNITE_THRESHOLD, FIRST_WAVE_REACH, MEND_PER_HAND, STORM_LOSS_FIRST_CYCLE, TSUNAMI_FIRST_CYCLE } from "../src/sim/balance";
import { deserialize, serialize } from "../src/sim/save";

import { rollTsunami, sheltered, shielded, startStorm, startTsunami, tsunamiDue, warnTsunami, waveDirection } from "../src/sim/events";
import { freeHands, ignite, mendByHand, repairCost, repairDamage, repairWork } from "../src/sim/fire";
import { upkeepOf } from "../src/sim/upgrades";

import { creditBoat, totalBoats, tryPlace } from "../src/sim/economy";
import { maxOf } from "../src/sim/fields";
import { Grid } from "../src/sim/grid";

import { newGame } from "../src/sim/start";
import { Building, population, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";

import { growStreet, placeByWalkway, placeEdge, starterTown } from "./scenario";

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

describe("fire (M10)", () => {
  /** A town with three smokehouses side by side and the people to run them. */
  function smokeTown(withWatch: boolean) {
    const { state, grid } = town(11);
    state.resources.money += 6000;
    growStreet(state, grid, 8);
    placeByWalkway(state, grid, "house", 6);
    const houses = placeByWalkway(state, grid, "smokehouse", 3);
    expect(houses.length).toBe(3);
    let watch: Building | null = null;
    if (withWatch) {
      watch = placeByWalkway(state, grid, "fireWatch", 1)[0] ?? null;
      expect(watch).not.toBeNull();
      for (const s of houses) expect(s.cells.some(c => Math.abs(c.i - watch!.cells[0].i) <= 8 && Math.abs(c.j - watch!.cells[0].j) <= 8)).toBe(true);
    }
    return { state, grid, houses, watch };
  }

  it("a smokehouse cluster with no fire watch burns within 30 cycles; with one it doesn't", () => {
    const open = smokeTown(false);
    let burntAt = -1;
    for (let c = 1; c <= 30; c++) { advanceCycles(open.state, open.grid, 1); if (open.state.burnt > 0) { burntAt = c; break; } }
    expect(maxOf(open.state.fields.fire)).toBeGreaterThan(FIRE_IGNITE_THRESHOLD);
    expect(burntAt).toBeGreaterThan(0);
    expect(open.state.log.some(m => /burnt out/.test(m))).toBe(true);

    const safe = smokeTown(true);
    for (let c = 1; c <= 30; c++) advanceCycles(safe.state, safe.grid, 1);
    expect(safe.watch!.workers).toBeGreaterThan(0);
    expect(safe.state.burnt).toBe(0);
    expect(safe.state.fires).toBe(0);
  });

  it("damaged buildings produce nothing until they are repaired", () => {
    const { state, grid, houses } = smokeTown(false);
    advanceCycles(state, grid, 3);
    const s = houses[0];
    state.resources.fish = 80;
    s.damaged = true;
    state.resources.money = 0; state.resources.timber = 0;
    advanceCycles(state, grid, 1);
    expect(s.damaged).toBe(true);
    expect(s.output).toBe(0);
    state.resources.money += 1000; state.resources.timber += 50;
    advanceCycles(state, grid, 1);
    expect(s.damaged).toBe(false);
    expect(state.log.some(m => /Repaired the smokehouse/.test(m))).toBe(true);
    // Production settles before repairs do, so the smokehouse works again from the following cycle.
    state.resources.fish = 100;
    advanceCycles(state, grid, 1);
    if (s.workers > 0) expect(s.output).toBeGreaterThan(0);
  });

  it("a fire spreads to the neighbours and burns out in FIRE_BURN_SECONDS", () => {
    const { state, grid, houses } = smokeTown(false);
    advanceCycles(state, grid, 1);
    ignite(state, houses[0]);
    expect(houses[0].fire).toBe(FIRE_BURN_SECONDS);
    for (let k = 0; k < FIRE_BURN_SECONDS * 20 + 1; k++) tick(state, grid);
    expect(houses[0].fire).toBe(0);
    expect(houses[0].damaged).toBe(true);
    expect(state.fires).toBeGreaterThanOrEqual(1);
  });
});

describe("storms and the tsunami (M11)", () => {
  it("a forced storm takes boats from an unsheltered pier and none from one behind a breakwater", () => {
    const run = (shelter: boolean) => {
      const { state, grid, town: t } = town(5);
      state.resources.money += 3000; state.resources.planks += 100;
      t.pier.boats = 2;
      const dock = placeEdge(state, grid, "pier", t.pier.cells[0], 3)!;
      dock.boats = 2;
      if (shelter) {
        let walls = 0;
        for (const h of [t.pier, dock]) for (const c of h.cells) for (const n of grid.neighbors(c)) {
          if (grid.classAt(n) === "deep" && !grid.buildingAt(n) && tryPlace(state, grid, "breakwater", n)) walls++;
        }
        expect(walls).toBeGreaterThan(0);
        expect(sheltered(grid, t.pier) && sheltered(grid, dock)).toBe(true);
      }
      state.tide.cycle = STORM_LOSS_FIRST_CYCLE; // before it a storm takes nothing
      startStorm(state, grid);
      return { boats: t.pier.boats + dock.boats, active: state.storm.active };
    };
    const open = run(false);
    expect(open.active).toBe(true);
    expect(open.boats).toBeLessThan(4);
    const safe = run(true);
    expect(safe.boats).toBe(4);
  });

  it("boats stay in and rain kills fire risk while a storm blows", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 2);
    state.fields.fire[0] = 5;
    startStorm(state, grid);
    tick(state, grid);
    expect(maxOf(state.fields.fire)).toBe(0);
    // Boats already out when the storm breaks come home with the shift; no new trip starts while it blows.
    let sailed = false, wasOut = t.pier.atSea;
    for (let k = 0; k < TIDE_PERIOD * 20; k++) { tick(state, grid); if (state.storm.active && t.pier.atSea && !wasOut) sailed = true; wasOut = t.pier.atSea; if (!state.storm.active) break; }
    expect(sailed).toBe(false);
    expect(state.storm.active).toBe(false); // it blew through by the next peak
  });

  it("a forced tsunami draws the water down, then damages unshielded flats buildings and spares those behind a sea wall", () => {
    const { state, grid, town: t } = town(3);
    state.resources.money += 3000; state.resources.timber += 100;
    growStreet(state, grid, 6);
    const homes = placeByWalkway(state, grid, "house", 4);
    expect(homes.length).toBeGreaterThanOrEqual(2);
    const dir = waveDirection(grid);
    // Wall off one home: sea walls go on the shore (a flat cell against the hill), so the guarded home stands on
    // the ground behind the wall along the wave axis — on the hill, where the shore is the last of the flats.
    let guarded: Building | null = null, wall: Building | null = null;
    for (let i = -30; i < 30 && !wall; i++) for (let j = -30; j < 30 && !wall; j++) {
      const c = { i, j };
      if (!grid.classOk("shore", [c]) || grid.buildingAt(c)) continue;
      const behind = { i: Math.floor(c.i + 0.5 + dir.x * 1.5), j: Math.floor(c.j + 0.5 + dir.z * 1.5) };
      if (!grid.canPlace("hut", [behind]) || !grid.classOk("shore", [c])) continue;
      const w = tryPlace(state, grid, "seaWall", c);
      if (!w) continue;
      const h = tryPlace(state, grid, "hut", behind);
      if (h && shielded(grid, dir, behind)) { wall = w; guarded = h; }
    }
    expect(wall).not.toBeNull();
    expect(grid.canPlace("seaWall", [homes[0].cells[0]])).toBe(false); // not on open flats
    expect(shielded(grid, dir, guarded!.cells[0])).toBe(true);
    const exposed = homes.filter(h => h !== guarded && !h.cells.some(c => shielded(grid, dir, c)));
    expect(exposed.length).toBeGreaterThan(0);

    state.tsunami.count = 1; // not the town's first wave (that one spends itself on the seafront): it goes all the way
    startTsunami(state, grid);
    expect(state.tsunami.stage).toBe("drawdown");
    for (let k = 0; k < DRAWDOWN_SECONDS * 20 + 2; k++) tick(state, grid);
    expect(state.tsunami.stage).toBe("wave");
    expect(state.tide.level).toBeCloseTo(DRAWDOWN_LEVEL, 1);
    for (let k = 0; k < 40 * 20; k++) { tick(state, grid); if (!state.tsunami.stage) break; }
    expect(state.tsunami.stage).toBeNull();
    expect(state.tide.override).toBeNull();
    expect(guarded!.damaged).toBe(false);
    for (const h of exposed) expect(h.damaged).toBe(true);
    expect(t.pier.boats).toBe(0); // unsheltered boats are gone
  });

  it("a rolled tsunami announces itself one tide ahead and starts at the next settlement", () => {
    const { state, grid } = town();
    advanceCycles(state, grid, 2);
    const cycle = state.tide.cycle;
    warnTsunami(state);
    expect(tsunamiDue(state)).toBe(true);
    expect(state.tsunami.due).toBe(cycle + 1);
    expect(state.tsunami.stage).toBeNull();
    expect(state.log[state.log.length - 1]).toMatch(/uneasy/);
    rollTsunami(state, grid); // not yet: the wave is booked for the next settlement, not this one
    expect(state.tsunami.stage).toBeNull();
    advanceCycles(state, grid, 1);
    expect(state.tsunami.stage).toBe("drawdown");
    expect(state.tsunami.due).toBe(-1);
    expect(tsunamiDue(state)).toBe(false);
    const old = JSON.parse(serialize(state)) as SimState;
    delete (old.tsunami as Partial<SimState["tsunami"]>).due;
    expect(deserialize(JSON.stringify(old)).tsunami.due).toBe(-1);
  });

  it("no wave comes to a small town; the first a town sees damages only the seafront", () => {
    const { state, grid } = town(3);
    state.resources.money += 3000;
    growStreet(state, grid, 8);
    placeByWalkway(state, grid, "house", 6);
    // A hamlet: however many tides pass, the sea never gets uneasy.
    state.tide.cycle = TSUNAMI_FIRST_CYCLE;
    expect(population(state)).toBeLessThan(30);
    for (let k = 0; k < 300; k++) rollTsunami(state, grid);
    expect(state.tsunami.due).toBe(-1);
    // The first wave: nothing further along its axis than FIRST_WAVE_REACH past the first building it meets is damaged.
    startTsunami(state, grid);
    const reach = state.tsunami.reach!;
    expect(reach).toBeDefined();
    while (state.tsunami.stage) tick(state, grid);
    const pos = (b: Building) => Math.min(...b.cells.map(c => (c.i + 0.5) * state.tsunami.dir.x + (c.j + 0.5) * state.tsunami.dir.z));
    const bs = Object.values(state.buildings);
    const front = Math.min(...bs.map(pos));
    expect(reach).toBeCloseTo(front + FIRST_WAVE_REACH, 5);
    const damaged = bs.filter(b => b.damaged);
    expect(damaged.length).toBeGreaterThan(0);
    for (const b of damaged) expect(pos(b)).toBeLessThanOrEqual(reach + 1e-6);
    expect(bs.some(b => !b.damaged && pos(b) > reach && b.floorY < grid.tides.waveHeight)).toBe(true); // spared: it would have been hit
    expect(state.log.some(m => /The wave damaged \d+ building/.test(m))).toBe(true);
    // The next wave goes all the way.
    startTsunami(state, grid);
    expect(state.tsunami.reach).toBeUndefined();
  });

  it("nothing damaged pays upkeep, and the free hands mend it for nothing, streets and earners first", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 3);
    const market = t.market!, hut = t.huts[0];
    expect(upkeepOf(market)).toBeGreaterThan(0);
    market.damaged = true; hut.damaged = true;
    expect(upkeepOf(market)).toBe(0);
    // The market's crew are free hands now (their workplace is broken), with everyone else not at work.
    const hands = freeHands(state);
    expect(hands).toBeGreaterThan(0);
    state.resources.money = 0;
    mendByHand(state);
    expect(market.mend).toBe(Math.min(repairWork(market), hands * MEND_PER_HAND)); // the market first: it earns
    expect(hut.mend ?? 0).toBe(Math.max(0, hands * MEND_PER_HAND - repairWork(market)));
    expect(repairCost(state, market).money).toBeLessThan(Math.round(BUILDINGS.market.cost.money * 0.5) + 30); // the purse pays only what is left
    let k = 0;
    while ((market.damaged || hut.damaged) && k++ < 40) { state.resources.money = 0; mendByHand(state); }
    expect(market.damaged || hut.damaged).toBe(false);
    expect(market.mend).toBeUndefined();
    expect(state.resources.money).toBe(0); // for nothing
    expect(state.log.some(m => /Free hands mended/.test(m))).toBe(true);
  });

  it("a town with no boat and no money gets one on credit, at most once every BOAT_CREDIT_EVERY tides", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 2);
    t.pier.boats = 0;
    state.resources.money = 5;
    expect(creditBoat(state)).toBe(true);
    expect(totalBoats(state)).toBe(1);
    expect(state.loan.owed).toBe(BOAT_COST);
    expect(state.loan.perCycle).toBeGreaterThan(0);
    t.pier.boats = 0; // the sea takes it straight away
    expect(creditBoat(state)).toBe(false);
    state.tide.cycle += BOAT_CREDIT_EVERY;
    expect(creditBoat(state)).toBe(true);
    expect(state.loan.owed).toBe(2 * BOAT_COST);
    // Not while a boat floats, nor for a town that can buy its own.
    expect(creditBoat(state)).toBe(false);
    t.pier.boats = 0; state.tide.cycle += BOAT_CREDIT_EVERY; state.resources.money = BOAT_COST;
    expect(creditBoat(state)).toBe(false);
  });

  it("damaged walkways rebuild themselves for their base price when the purse allows", () => {
    const { state, grid, town: t } = town();
    const w = grid.buildingAt(t.walkways[0])!;
    const hut = t.huts[0];
    w.damaged = true; hut.damaged = true;
    state.resources.money = BUILDINGS[w.kind].cost.money + 1; state.resources.timber = 0;
    repairDamage(state);
    expect(w.damaged).toBe(false);
    expect(hut.damaged).toBe(true); // a house needs the repair fund
    expect(state.resources.money).toBe(1);
    expect(state.log[state.log.length - 1]).toMatch(/Rebuilt 1 walkway for/);
    w.damaged = true;
    state.resources.money = 0;
    repairDamage(state);
    expect(w.damaged).toBe(true);
  });

  it("a repair buys the timber the store is short of, and mends the landings and workplaces before the homes", () => {
    const { state, town: t } = town();
    const hut = t.huts[0], pier = t.pier;
    hut.damaged = true; pier.damaged = true;
    state.resources.timber = 0;
    const c = repairCost(state, pier);
    expect(c.timber).toBe(0);
    expect(c.bought).toBeGreaterThan(0);
    state.resources.money = c.money + 1; // the pier's repair, with a dollar over
    repairDamage(state);
    expect(pier.damaged).toBe(false);
    expect(hut.damaged).toBe(true); // it waits: the purse went to the pier first
    expect(state.resources.money).toBe(1);
    // With timber in store, the repair takes it and buys none.
    state.resources.timber = 50;
    const d = repairCost(state, hut);
    expect(d.bought).toBe(0);
    expect(d.timber).toBeGreaterThan(0);
    state.resources.money = d.money;
    repairDamage(state);
    expect(hut.damaged).toBe(false);
    expect(state.resources.timber).toBe(50 - d.timber);
  });
});

