// The second island and the ferry, Session B's regressions, rotation, and seeded islands.
import { describe, expect, it } from "vitest";
import { TIDE_HI } from "../src/config";
import { BUILDINGS, FERRY_COST, ISLAND_MIN_TREED, STORM_LOSS_FIRST_CYCLE } from "../src/sim/balance";
import { deserialize, serialize } from "../src/sim/save";
import { addLandfill } from "../src/sim/land";

import { ISLE, isleWeight } from "../src/sim/isle";
import { candidate, candidateSeed, island, islandFailures, rerollRate } from "../src/sim/island";
import { islandHeight, terrainHeight } from "../src/sim/heightfield";
import { startCell } from "../src/sim/start";
import { TREE_SITES } from "../src/sim/trees";
import { startStorm, startTsunami } from "../src/sim/events";

import { removeBuilding, tryPlace } from "../src/sim/economy";
import { buildFlow, flowFor } from "../src/sim/fields";
import { cellIndex, Grid } from "../src/sim/grid";
import { crossCommuters, distanceField } from "../src/sim/network";
import { stateHash } from "../src/sim/save";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";

import { assignWorkers, employed, jobsAt } from "../src/sim/workers";

import { bridgeTo, growStreet, placeByWalkway, placeEdge, placeHarbor, settleIsle, starterTown } from "./scenario";

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

/** An open flat cell with room round it, at least 4 cells from any in `skip`. */
function openFlat(grid: Grid, skip: Cell[] = []): Cell {
  for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
    const c = { i, j };
    if (skip.some(s => Math.abs(s.i - i) < 4 && Math.abs(s.j - j) < 4)) continue;
    const cells = [c, ...grid.neighbors(c), { i: i + 1, j: j + 1 }, { i: i + 1, j: j - 1 }];
    if (cells.length === 7 && cells.every(x => grid.classAt(x) === "flat" && !grid.buildingAt(x)) && !grid.onIsle(cells)) return c;
  }
  throw new Error("no open flat");
}
/** The side of a cell (0 = −z, 1 = −x, 2 = +z, 3 = +x) whose ground one to three cells out is lowest. */
function lowestSide(grid: Grid, c: { i: number; j: number }): number {
  const h = (i: number, j: number) => (i >= -32 && i < 32 && j >= -32 && j < 32 ? grid.heightAt({ i, j }) : -5);
  const steps = [{ i: 0, j: -1 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }];
  const mean = steps.map(d => [1, 2, 3].reduce((n, r) => n + h(c.i + d.i * r, c.j + d.j * r), 0));
  let best = 0;
  for (let k = 1; k < 4; k++) if (mean[k] < mean[best]) best = k;
  return best;
}

describe("second island (backlog 6)", () => {
  it("adds a low isle of flats in the south-east and leaves the main island, its start and its trees alone", () => {
    const { grid } = newGame(1);
    let isleLand = 0, mainLand = 0, isleHigh = 0;
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "deep") continue;
      if (grid.onIsle([c])) { isleLand++; if (grid.classAt(c) === "high") isleHigh++; } else mainLand++;
    }
    expect(mainLand).toBe(750); // the class map before the isle existed
    expect(isleLand).toBeGreaterThan(80);
    expect(isleHigh).toBeGreaterThan(0);
    expect(isleHigh).toBeLessThan(isleLand / 3);
    expect(grid.onIsle([startCell(grid)])).toBe(false);
    for (const s of TREE_SITES) expect(isleWeight(s.x, s.z)).toBe(0);
    // Not a circle: at the mean radius the rim is inside in some directions and outside in others.
    const weights: number[] = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; weights.push(isleWeight(ISLE.x + Math.cos(a) * ISLE.r * 0.95, ISLE.z + Math.sin(a) * ISLE.r * 0.95)); }
    expect(Math.min(...weights)).toBeLessThan(0.3);
    expect(Math.max(...weights)).toBeGreaterThan(0.9);
  });
  it("is locked until a harbor stands, then takes a pier, walkways and huts", () => {
    const { state, grid, town: t } = town();
    const isleFlat = { i: 22, j: 17 };
    expect(grid.classAt(isleFlat)).toBe("flat");
    expect(grid.canPlace("hut", [isleFlat])).toBe(false);
    const stray = placeEdge(state, grid, "pier", { i: 22, j: 22 }); // the nearest legal site is off the isle
    expect(stray === null || !grid.onIsle(stray.cells)).toBe(true);
    state.resources.money += 5000; state.resources.planks += 200;
    const harbor = placeHarbor(state, grid, t.pier.cells[0]);
    expect(harbor).not.toBeNull();
    expect(grid.isleOpen()).toBe(true);
    expect(state.log[state.log.length - 1]).toMatch(/ferry/);
    expect(grid.canPlace("hut", [isleFlat])).toBe(true);
    const isle = settleIsle(state, grid);
    expect(isle.pier).not.toBeNull();
    expect(grid.onIsle(isle.pier!.cells)).toBe(true);
    expect(isle.walkways.length).toBeGreaterThan(0);
    expect(isle.huts.length).toBeGreaterThan(0);
    state.tide.override = TIDE_HI;
    tick(state, grid);
    expect(isle.huts.every(h => h.reached)).toBe(true);
    const round = new Grid(JSON.parse(JSON.stringify(state)) as SimState);
    expect(round.isleOpen()).toBe(true);
  });
  it("the ferry carries workers: isle homes staff mainland jobs and mainland homes staff isle boats, a crossing apart", () => {
    const { state, grid, town: t } = town();
    state.resources.money += 5000; state.resources.planks += 200;
    const harbor = placeHarbor(state, grid, t.pier.cells[0])!;
    growStreet(state, grid, 6);
    const smokehouse = placeByWalkway(state, grid, "smokehouse")[0];
    expect(smokehouse).toBeDefined();
    const houses = placeByWalkway(state, grid, "house", 2); // empty until the second half
    expect(houses.length).toBe(2);
    const isle = settleIsle(state, grid);
    for (const h of [...t.huts, ...isle.huts]) h.residents = BUILDINGS.hut.residents;
    state.tide.override = TIDE_HI;
    tick(state, grid);
    // An unlinked harbor is no terminal: nobody can walk to it, so nobody crosses.
    const isleHome = isle.huts[0];
    const at = (field: Int32Array, b: Building) => Math.min(...b.cells.map(c => field[cellIndex(c.i, c.j)]));
    expect(at(distanceField(grid, t.market!), isleHome)).toBe(-1);
    assignWorkers(state, grid);
    expect(crossCommuters(state, grid)).toBe(0);
    // Bridged to the street, the harbor joins the isle's pier to the walk: market → harbor, the crossing, pier → hut.
    expect(bridgeTo(state, grid, harbor).length).toBeGreaterThan(0);
    tick(state, grid);
    const field = distanceField(grid, t.market!);
    const toHarbor = at(field, harbor), pierToHome = at(distanceField(grid, isle.pier!), isleHome);
    expect(toHarbor).toBeGreaterThan(0);
    expect(pierToHome).toBeGreaterThan(0);
    expect(at(field, isleHome)).toBe(toHarbor + FERRY_COST + pierToHome);
    // Mainland: 6 residents, 8 jobs (crew 4, market 1, smokehouse 3). The isle's 6 residents take the 2 left over.
    assignWorkers(state, grid);
    expect(crossCommuters(state, grid)).toBe(2);
    expect(state.assignments.filter(a => grid.onIsle(state.buildings[a.home].cells)).every(a => !grid.onIsle(state.buildings[a.work].cells))).toBe(true);
    expect(t.huts.every(h => employed(state, h) === h.residents)).toBe(true);
    // The other way: boats at the isle pier, empty isle huts, two more mainland houses — mainland spare hands crew them.
    isle.pier!.boats = 2;
    for (const h of isle.huts) h.residents = 0;
    for (const h of houses) h.residents = BUILDINGS.house.residents;
    tick(state, grid);
    assignWorkers(state, grid);
    expect(isle.pier!.workers).toBe(4);
    expect(crossCommuters(state, grid)).toBe(4);
    expect(state.assignments.filter(a => a.work === isle.pier!.id).every(a => !grid.onIsle(state.buildings[a.home].cells))).toBe(true);
    // A cut terminal breaks the crossing: at a spring peak nothing is cut here, but under the harbor's deck it is.
    state.tide.override = 1.05;
    tick(state, grid);
    assignWorkers(state, grid);
    expect(crossCommuters(state, grid)).toBe(0);
  });
});

describe("QA regressions (Session B)", () => {
  it("#1 a storm or the wave that takes a pier's boats after the settlement drops the crew it can no longer employ", () => {
    // Fuzz seed 10, cycle 228: the settlement assigned 2 crew to a one-boat pier, then the storm roll (which runs
    // after the settlement at the same peak) took the boat, leaving workers 2 > jobs 0 until the next peak.
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 2);
    expect(t.pier.boats).toBe(2);
    expect(t.pier.workers).toBe(4);
    state.tide.cycle = STORM_LOSS_FIRST_CYCLE; // before it a storm takes nothing
    for (let k = 0; k < 40 && t.pier.boats === 2; k++) startStorm(state, grid); // 50 % per boat: a few rolls
    expect(t.pier.boats).toBeLessThan(2);
    expect(t.pier.workers).toBe(jobsAt(t.pier));
    expect(state.assignments.filter(a => a.work === t.pier.id).reduce((n, a) => n + a.n, 0)).toBe(t.pier.workers);
    // The wave: every boat goes, and with them every crew assignment.
    state.tsunami.stage = null;
    state.tsunami.count = 1; // a later wave, which reaches the whole town (the first spends itself on the seafront)
    startTsunami(state, grid);
    while (state.tsunami.stage) tick(state, grid);
    expect(t.pier.boats).toBe(0);
    expect(t.pier.workers).toBe(0);
    expect(state.assignments.some(a => a.work === t.pier.id)).toBe(false);
  });
  it("#2 the fields' tide flow follows the terrain: rebuilt after landfill and after the grid takes another island", () => {
    const { state, grid } = newGame(1);
    state.resources.money += 1000; state.resources.timber += 100;
    const before = flowFor(grid);
    expect(flowFor(grid)).toBe(before); // cached while the ground stands still
    // Fill a flat cell whose neighbours have somewhere lower to drain: the fill becomes their uphill neighbour.
    let filled: Cell | null = null;
    for (let i = -20; i < 20 && !filled; i++) for (let j = -20; j < 20 && !filled; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "flat" && !grid.buildingAt(c) && grid.neighbors(c).every(n => grid.classAt(n) === "flat" && grid.heightAt(n) < grid.heightAt(c) + 0.2)) filled = c;
    }
    expect(addLandfill(state, grid, filled!)).toBe(true);
    const after = flowFor(grid);
    expect(after).not.toBe(before);
    const k = cellIndex(filled!.i, filled!.j);
    for (const n of grid.neighbors(filled!)) expect(after.up[cellIndex(n.i, n.j)]).toBe(k);
    expect(after.up).toEqual(buildFlow(grid).up);
    // Another island under the same Grid object (what a load or a new town does in the game): a fresh flow.
    grid.attach(newGame(1, 7).state);
    const moved = flowFor(grid);
    expect(moved).not.toBe(after);
    expect(moved.down).toEqual(buildFlow(grid).down);
  });
});

describe("rotation", () => {
  /** A flat, unbuilt cell off the isle whose four neighbours are flat and unbuilt too. */
  function openFlat(grid: Grid, skip: Cell[] = []): Cell {
    for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (skip.some(s => Math.abs(s.i - i) < 4 && Math.abs(s.j - j) < 4)) continue;
      const cells = [c, ...grid.neighbors(c), { i: i + 1, j: j + 1 }, { i: i + 1, j: j - 1 }];
      if (cells.length === 7 && cells.every(x => grid.classAt(x) === "flat" && !grid.buildingAt(x)) && !grid.onIsle(cells)) return c;
    }
    throw new Error("no open flat");
  }
  it("odd turns swap a footprint's width and depth; even ones keep it", () => {
    const { grid } = newGame(1);
    const c = openFlat(grid);
    expect(grid.footprint("smokehouse", c, 0)).toEqual([{ i: c.i, j: c.j }, { i: c.i + 1, j: c.j }]);
    expect(grid.footprint("smokehouse", c, 1)).toEqual([{ i: c.i, j: c.j }, { i: c.i, j: c.j + 1 }]);
    expect(grid.footprint("smokehouse", c, 2)).toEqual(grid.footprint("smokehouse", c, 0));
    expect(grid.footprint("smokehouse", c, 3)).toEqual(grid.footprint("smokehouse", c, 1));
    expect(grid.footprint("hut", c, 1)).toEqual([c]);
  });
  it("a building faces the street on its own, takes a turn when given one, and old saves face −z", () => {
    const { state, grid } = newGame(1);
    state.resources.money += 5000;
    // A walkway north (+z) of the hut: the door turns to it (rot 2). East (+x): rot 3. Nothing near: the side whose
    // ground falls lowest (the sea, not the hill).
    const a = openFlat(grid);
    expect(tryPlace(state, grid, "walkway", { i: a.i, j: a.j + 1 })).not.toBeNull();
    const north = tryPlace(state, grid, "hut", a)!;
    expect(north.rot).toBe(2);
    const b = openFlat(grid, [a]);
    expect(tryPlace(state, grid, "walkway", { i: b.i + 1, j: b.j })).not.toBeNull();
    expect(tryPlace(state, grid, "hut", b)!.rot).toBe(3);
    const c = openFlat(grid, [a, b]);
    expect(tryPlace(state, grid, "hut", c)!.rot).toBe(lowestSide(grid, c));
    // A given turn wins over the street, and lands in the ledger as 0..3.
    const d = openFlat(grid, [a, b, c]);
    expect(tryPlace(state, grid, "walkway", { i: d.i, j: d.j + 1 })).not.toBeNull();
    expect(tryPlace(state, grid, "hut", d, 0, 1)!.rot).toBe(1);
    // A 2×1 keeps its shape when it faces the street by itself (only 0 and 2 are on offer), so a walkway to the
    // west leaves it at 0; a turn of 1 stands it on end.
    const e = openFlat(grid, [a, b, c, d]);
    expect(tryPlace(state, grid, "walkway", { i: e.i - 1, j: e.j })).not.toBeNull();
    const shed = tryPlace(state, grid, "smokehouse", e)!;
    expect(shed.rot).toBe(0);
    expect(shed.cells).toEqual([{ i: e.i, j: e.j }, { i: e.i + 1, j: e.j }]);
    const f = openFlat(grid, [a, b, c, d, e]);
    const tall = tryPlace(state, grid, "smokehouse", f, 0, 1)!;
    expect(tall.rot).toBe(1);
    expect(tall.cells).toEqual([{ i: f.i, j: f.j }, { i: f.i, j: f.j + 1 }]);
    // Saves: the turn survives; a save from before rotation reads as 0 (where no street touches it).
    const copy = deserialize(serialize(state));
    expect(copy.buildings[north.id].rot).toBe(2);
    const old = JSON.parse(serialize(state)) as SimState;
    for (const x of Object.values(old.buildings)) delete (x as Partial<Building>).rot;
    expect(deserialize(JSON.stringify(old)).buildings[north.id].rot).toBe(0);
  });
});

describe("doors turn to the street", () => {
  it("the starting hut looks out to sea; a street laid beside a building later turns its door to it; a turn given with R stays", () => {
    for (const [seed, biome] of [[0, "tidewater"], [2, "cinder"], [2, "dunes"], [2, "delta"]] as const) {
      const { grid } = newGame(1, seed, biome);
      const hut = Object.values(grid.state.buildings).find(b => b.kind === "hut")!;
      expect(hut.rot).toBe(lowestSide(grid, hut.cells[0]));
      expect(hut.turned).toBeUndefined();
    }
    const { state, grid } = newGame(1);
    state.resources.money += 5000;
    const a = openFlat(grid);
    const hut = tryPlace(state, grid, "hut", a)!;
    const away = (hut.rot + 2) & 3; // the side behind the door
    const step = [{ i: 0, j: -1 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }][away];
    expect(tryPlace(state, grid, "walkway", { i: a.i + step.i, j: a.j + step.j })).not.toBeNull();
    expect(hut.rot).toBe(away); // it turned to the walkway behind it
    // A second street on another side leaves it facing the first.
    const side = [{ i: 0, j: -1 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }][(away + 1) & 3];
    const second = tryPlace(state, grid, "walkway", { i: a.i + side.i, j: a.j + side.j });
    expect(hut.rot).toBe(away);
    // Take the first away: it turns to the one that is left.
    removeBuilding(state, grid, grid.buildingAt({ i: a.i + step.i, j: a.j + step.j })!);
    if (second) expect(hut.rot).toBe((away + 1) & 3);
    // A hut the player turned keeps its turn when a street comes.
    const b = openFlat(grid, [a]);
    const turned = tryPlace(state, grid, "hut", b, 0, 1)!;
    expect(turned.turned).toBe(true);
    expect(tryPlace(state, grid, "walkway", { i: b.i, j: b.j + 1 })).not.toBeNull();
    expect(turned.rot).toBe(1);
    // A save from before doors turned (a hut whose door meets no street while one touches it) is put right on load.
    const c = openFlat(grid, [a, b]);
    expect(tryPlace(state, grid, "walkway", { i: c.i, j: c.j + 1 })).not.toBeNull();
    const old = tryPlace(state, grid, "hut", c)!;
    expect(old.rot).toBe(2);
    const json = JSON.parse(serialize(state)) as SimState;
    json.buildings[old.id].rot = 0;
    const loaded = deserialize(JSON.stringify(json));
    new Grid(loaded);
    expect(loaded.buildings[old.id].rot).toBe(2);
    // And a round trip turns nothing built since.
    const again = deserialize(serialize(state));
    new Grid(again);
    for (const x of Object.values(state.buildings)) expect(again.buildings[x.id].rot).toBe(x.rot);
  });
});

describe("seeded islands (Task 4)", () => {
  /** FNV over every cell height to 1e-4: the original island, pinned. */
  function fingerprint(grid: Grid): string {
    let fp = 2166136261;
    for (let k = 0; k < grid.heights.length; k++) {
      const v = Math.round(grid.heights[k] * 10000);
      fp ^= v & 0xffff; fp = Math.imul(fp, 16777619);
      fp ^= (v >>> 16) & 0xffff; fp = Math.imul(fp, 16777619);
    }
    return (fp >>> 0).toString(16);
  }
  it("seed 0 is the original island, exactly, and passes validation on its own", () => {
    const zero = island(0);
    expect(zero.noiseSeed).toBe(0);
    expect(zero.rerolls).toBe(0);
    expect(islandFailures(zero.stats)).toEqual([]);
    expect(zero.trees).toBe(TREE_SITES);
    expect(zero.trees.length).toBe(70);
    for (const [x, z] of [[3.2, -4.1], [-17.5, 8.25], [22.5, 22.5], [0.5, 0.5]]) expect(islandHeight(0)(x, z)).toBe(terrainHeight(x, z));
    const { grid } = newGame(1);
    expect(fingerprint(grid)).toBe("3fcf3090");
    expect(fingerprint(newGame(1, 0).grid)).toBe("3fcf3090");
    expect(zero.stats).toMatchObject({ flats: 555, region: 555, piers: 142, harbors: 1815, treed: 70 });
    expect(zero.stats.materials[0]).toBeGreaterThan(zero.stats.flats); // every main-island cell is plain
  });
  it("every seed gives a validated island, the same one every time, rerolled when its first candidate fails", () => {
    for (let s = 1; s <= 40; s++) {
      const isl = island(s);
      expect(islandFailures(isl.stats), `seed ${s}`).toEqual([]);
      expect(island(s)).toBe(isl);
      expect(candidateSeed(s, 0)).toBe(s);
      expect(isl.noiseSeed).toBe(candidateSeed(s, isl.rerolls));
      expect(isl.trees.length).toBeGreaterThanOrEqual(ISLAND_MIN_TREED);
    }
    // Seed 1's own noise fails the rules; the island is a later candidate. Seeds 2 and 3 pass first time.
    expect(island(1).rerolls).toBeGreaterThan(0);
    expect(island(1).noiseSeed).not.toBe(1);
    expect(islandFailures(candidate(1, 0).stats).length).toBeGreaterThan(0);
    expect(islandFailures(candidate(1, island(1).rerolls).stats)).toEqual([]);
    expect(island(2).rerolls).toBe(0);
    expect(island(3).rerolls).toBe(0);
    const rate = rerollRate(1, 41);
    expect(rate.fallbacks).toBe(0);
    expect(rate.rerolled).toBeLessThanOrEqual(32);
    expect(rate.rerolls).toBeGreaterThan(0);
  });
  it("a town on another island carries its seed, starts on its flats, saves it, and reads old saves as seed 0", () => {
    const { state, grid } = newGame(1, 7);
    expect(state.world.seed).toBe(7);
    expect(grid.island.seed).toBe(7);
    expect(state.trees.length).toBe(island(7).trees.length);
    expect(state.log.some(m => /^Island 7: \d+ flat cells, \d+ pier sites/.test(m))).toBe(true);
    const hut = buildingList(state)[0];
    expect(hut.kind).toBe("hut");
    expect(grid.classAt(hut.cells[0])).toBe("flat");
    expect(grid.onIsle(hut.cells)).toBe(false);
    expect(grid.island.stats.flats).toBeGreaterThanOrEqual(400);
    const zero = newGame(1).grid;
    let differ = 0;
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) if (zero.classAt({ i, j }) !== grid.classAt({ i, j })) differ++;
    expect(differ).toBeGreaterThan(200);
    expect(stateHash(newGame(1, 7).state)).toBe(stateHash(state));
    const copy = deserialize(serialize(state));
    expect(copy.world.seed).toBe(7);
    const round = new Grid(copy);
    expect(round.heightAt(hut.cells[0])).toBe(grid.heightAt(hut.cells[0]));
    expect(round.classAt(hut.cells[0])).toBe("flat");
    const old = JSON.parse(serialize(state)) as Partial<SimState>;
    delete old.world;
    expect(deserialize(JSON.stringify(old)).world.seed).toBe(0);
  });
});

