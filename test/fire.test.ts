// Fire, storms and the tsunami.
import { describe, expect, it } from "vitest";
import { TIDE_PERIOD } from "../src/config";
import { BUILDINGS, DRAWDOWN_LEVEL, DRAWDOWN_SECONDS, FIRE_BURN_SECONDS, FIRE_IGNITE_THRESHOLD } from "../src/sim/balance";
import { deserialize, serialize } from "../src/sim/save";

import { rollTsunami, sheltered, shielded, startStorm, startTsunami, tsunamiDue, warnTsunami, waveDirection } from "../src/sim/events";
import { ignite, repairDamage } from "../src/sim/fire";

import { tryPlace } from "../src/sim/economy";
import { maxOf } from "../src/sim/fields";
import { Grid } from "../src/sim/grid";

import { newGame } from "../src/sim/start";
import { Building, SimState } from "../src/sim/state";
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
    let sailed = false;
    for (let k = 0; k < TIDE_PERIOD * 20; k++) { tick(state, grid); if (state.storm.active && t.pier.atSea) sailed = true; if (!state.storm.active) break; }
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

  it("damaged walkways rebuild themselves for their base price when the purse allows", () => {
    const { state, grid, town: t } = town();
    const w = grid.buildingAt(t.walkways[0])!;
    const hut = t.huts[0];
    w.damaged = true; hut.damaged = true;
    state.resources.money = BUILDINGS[w.kind].cost.money + 1; state.resources.timber = 0;
    repairDamage(state);
    expect(w.damaged).toBe(false);
    expect(hut.damaged).toBe(true); // a house needs the repair fund and timber
    expect(state.resources.money).toBe(1);
    expect(state.log[state.log.length - 1]).toMatch(/Rebuilt 1 walkway for/);
    w.damaged = true;
    state.resources.money = 0;
    repairDamage(state);
    expect(w.damaged).toBe(true);
  });
});

