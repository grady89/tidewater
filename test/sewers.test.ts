// Sewers, capacity and upgrades: streets carry the sewer, pipes carry it anywhere else, each network needs a way
// out, plants clean up to their level's capacity, wells serve theirs nearest first, and upgrades raise both.
import { describe, expect, it } from "vitest";
import { HAPPY, SEWER_PIPE_DEEP_COST, UPGRADES, UPGRADE_UPKEEP_STEP } from "../src/sim/balance";
import { homeHappiness, removeBuilding, tryPlace } from "../src/sim/economy";
import { cellIndex, DIRS, Grid, HALF } from "../src/sim/grid";
import { deserialize, serialize } from "../src/sim/save";
import { rebuildCoverage, serviceRadius } from "../src/sim/services";
import { backedUpShare, layPipe, netFlow, pipeBlocker, removePipe, sewered, sewerMap } from "../src/sim/sewers";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { levelCapacity, upgradeBlocker, upgradeBuilding, upkeepOf } from "../src/sim/upgrades";
import { pipeTo, placeByWalkway, starterTown } from "./scenario";

function town(seed = 7): { state: SimState; grid: Grid; t: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  const t = starterTown(state, grid);
  state.resources.money += 5000;
  state.resources.planks += 500;
  return { state, grid, t };
}
const homes = (state: SimState) => buildingList(state).filter(b => b.kind === "hut" || b.kind === "house");
const netAt = (grid: Grid, c: Cell) => { const m = sewerMap(grid); return m.nets[m.net[cellIndex(c.i, c.j)]]; };

/** An outfall on the nearest shore site at least 6 from `near` with no sewer beside it. */
function outfallOffStreet(state: SimState, grid: Grid, near: Cell): Building | null {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const fp = grid.footprint("outfall", { i, j });
    if (!fp || !grid.canPlace("outfall", fp)) continue;
    if (DIRS.some(d => sewered(grid, { i: i + d.i, j: j + d.j }) || grid.buildingAt({ i: i + d.i, j: j + d.j }))) continue;
    const d = Math.hypot(i - near.i, j - near.j);
    if (d >= 6 && d < bd) { bd = d; best = { i, j }; }
  }
  return best ? tryPlace(state, grid, "outfall", best) : null;
}

/** The nearest cell to `near` where a 2×2 treatment plant stands clear of every sewer (no street or pipe beside it). */
function plantSiteOffStreet(grid: Grid, near: Cell): Cell | null {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const fp = grid.footprint("treatmentPlant", { i, j });
    if (!fp || !grid.canPlace("treatmentPlant", fp)) continue;
    if (fp.some(c => DIRS.some(d => sewered(grid, { i: c.i + d.i, j: c.j + d.j })))) continue;
    const d = Math.hypot(i - near.i, j - near.j);
    if (d < bd) { bd = d; best = { i, j }; }
  }
  return best;
}

describe("sewers", () => {
  it("the starter town's homes drain through the street's sewer and out of its outfall", () => {
    const { state, grid } = town();
    const outfall = buildingList(state).find(b => b.kind === "outfall")!;
    const net = netAt(grid, outfall.cells[0]);
    for (const h of homes(state)) {
      expect(sewerMap(grid).drainOf.get(h.id)).toBe(net);
      expect(backedUpShare(grid, h)).toBe(0);
    }
    // The first settlement finds the homes empty (people move in after the waste is routed); the second doesn't.
    advanceCycles(state, grid, 1);
    const people = homes(state).reduce((n, h) => n + h.residents, 0);
    expect(people).toBeGreaterThan(0);
    advanceCycles(state, grid, 1);
    expect(outfall.output).toBeGreaterThanOrEqual(people);
    expect(state.emitters.some(e => e.k === cellIndex(outfall.cells[0].i, outfall.cells[0].j))).toBe(true);
  });

  it("with no outfall the network backs up: cesspits at every home, which mind it", () => {
    const { state, grid } = town();
    advanceCycles(state, grid, 1);
    removeBuilding(state, grid, buildingList(state).find(b => b.kind === "outfall")!);
    const lived = homes(state).filter(h => h.residents > 0);
    expect(lived.length).toBeGreaterThan(0);
    for (const h of lived) expect(backedUpShare(grid, h)).toBe(1);
    const h = lived[0];
    expect(homeHappiness(state, h, 1, 1, grid, 0) - homeHappiness(state, h, 1, 1, grid, 1)).toBeCloseTo(HAPPY.cesspit, 5);
    advanceCycles(state, grid, 1);
    for (const x of lived) expect(state.emitters.some(e => e.k === cellIndex(x.cells[0].i, x.cells[0].j))).toBe(true);
  });

  it("an outfall away from the street carries nothing until a pipe joins it; taking the pipe up parts them again", () => {
    const { state, grid, t } = town();
    const far = outfallOffStreet(state, grid, t.pier.cells[0])!;
    expect(far).toBeTruthy();
    const before = netAt(grid, far.cells[0]);
    expect(before.homes.length).toBe(0);
    const had = new Set(state.sewers);
    const laid = pipeTo(state, grid, far);
    expect(laid).toBeGreaterThan(0);
    const joined = netAt(grid, far.cells[0]);
    expect(joined.homes.length).toBe(homes(state).length);
    expect(joined.outfalls.length).toBe(2);
    // Take up the new pipe that meets the outfall.
    const pipe = state.sewers.filter(k => !had.has(k)).find(k => DIRS.some(d => { const c = { i: Math.floor(k / 64) - HALF + d.i, j: (k % 64) - HALF + d.j }; return far.cells.some(x => x.i === c.i && x.j === c.j); }))!;
    removePipe(grid, { i: Math.floor(pipe / 64) - HALF, j: (pipe % 64) - HALF });
    expect(netAt(grid, far.cells[0]).homes.length).toBe(0);
  });

  it("a treatment plant off the street, joined by a pipe, cleans up to its capacity; an upgrade cleans more", () => {
    const { state, grid, t } = town();
    const site = plantSiteOffStreet(grid, t.huts[0].cells[0]);
    expect(site).not.toBeNull();
    const plant = tryPlace(state, grid, "treatmentPlant", site!)!;
    expect(plant).toBeTruthy();
    expect(netAt(grid, plant.cells[0]).homes.length).toBe(0);
    pipeTo(state, grid, plant);
    const net = netAt(grid, plant.cells[0]);
    expect(net.homes.length).toBeGreaterThan(0);
    // More people on the network than the plant's first level can clean.
    const cap1 = levelCapacity(plant)!;
    net.homes[0].residents = cap1 + 20;
    let f = netFlow(net);
    expect(f.treated).toBe(cap1);
    expect(f.toSea).toBe(f.people - cap1);
    expect(upgradeBuilding(state, plant)).toBe(true);
    f = netFlow(netAt(grid, plant.cells[0]));
    expect(f.treated).toBe(Math.min(f.people, UPGRADES.treatmentPlant!.capacity[1]));
    expect(f.toSea).toBe(0);
    advanceCycles(state, grid, 1);
    expect(plant.reached).toBe(false); // no street to it, and it works all the same
    expect(plant.output).toBeGreaterThan(0);
  });

  it("pipes: never on a street, dearer across deep water, kept through a save", () => {
    const { state, grid, t } = town();
    const street = buildingList(state).find(b => b.kind === "walkway")!;
    expect(pipeBlocker(state, grid, street.cells[0])).toMatch(/street/);
    let deep: Cell | null = null;
    for (let i = -HALF; i < HALF && !deep; i++) for (let j = -HALF; j < HALF && !deep; j++) if (grid.classAt({ i, j }) === "deep" && !grid.buildingAt({ i, j })) deep = { i, j };
    const money = state.resources.money;
    expect(layPipe(state, grid, deep!)).toBe(true);
    expect(money - state.resources.money).toBe(SEWER_PIPE_DEEP_COST);
    expect(layPipe(state, grid, deep!)).toBe(false);
    pipeTo(state, grid, outfallOffStreet(state, grid, t.pier.cells[0])!);
    const loaded = deserialize(serialize(state));
    const grid2 = new Grid(loaded);
    expect(grid2.hasPipe(deep!)).toBe(true);
    expect(sewerMap(grid2).nets.length).toBe(sewerMap(grid).nets.length);
    expect(sewerMap(grid2).drainOf.size).toBe(sewerMap(grid).drainOf.size);
  });
});

describe("capacity and upgrades", () => {
  it("a well serves its capacity, nearest homes first; a cistern serves them all", () => {
    const { state, grid } = town();
    const well = placeByWalkway(state, grid, "well", 1)[0];
    expect(well).toBeDefined();
    advanceCycles(state, grid, 1);
    const r = serviceRadius(state, well);
    const inReach = homes(state).filter(h => h.cells.some(c => well.cells.some(w => Math.max(Math.abs(c.i - w.i), Math.abs(c.j - w.j)) <= r)));
    expect(inReach.length).toBeGreaterThan(0);
    const cap = levelCapacity(well)!;
    // Crowd the homes in reach past the well's capacity.
    for (const h of inReach) h.residents = Math.ceil((cap + 12) / inReach.length);
    rebuildCoverage(state, grid);
    expect(well.output).toBe(cap);
    const water = (h: Building) => state.fields.coverage.water[cellIndex(h.cells[0].i, h.cells[0].j)];
    expect(inReach.some(h => water(h) < 1)).toBe(true);
    const nearest = [...inReach].sort((a, b) => dist(a, well) - dist(b, well))[0];
    expect(water(nearest)).toBe(1);
    expect(upgradeBuilding(state, well)).toBe(true);
    rebuildCoverage(state, grid);
    for (const h of inReach) expect(water(h)).toBe(1);
    expect(well.output).toBe(inReach.reduce((n, h) => n + h.residents, 0));
  });

  it("an upgrade costs money and planks, goes to level 3 and no further, and raises the upkeep", () => {
    const { state, grid, t } = town();
    const market = t.market!;
    const base = upkeepOf(market);
    const money = state.resources.money, planks = state.resources.planks;
    const [c2, c3] = UPGRADES.market!.costs;
    expect(upgradeBuilding(state, market)).toBe(true);
    expect(upgradeBuilding(state, market)).toBe(true);
    expect(market.level).toBe(3);
    expect(money - state.resources.money).toBe(c2.money + c3.money);
    expect(planks - state.resources.planks).toBe((c2.planks ?? 0) + (c3.planks ?? 0));
    expect(upgradeBlocker(state, market)).toMatch(/highest/);
    expect(upgradeBuilding(state, market)).toBe(false);
    expect(upkeepOf(market)).toBeCloseTo(base * (1 + 2 * UPGRADE_UPKEEP_STEP), 6);
    expect(levelCapacity(market)).toBe(UPGRADES.market!.capacity[2]);
    const hut = t.huts[0];
    expect(upgradeBlocker(state, hut)).toMatch(/no levels/);
    void grid;
  });

  it("a fire watch reaches further as it grows; a damaged one can't be upgraded", () => {
    const { state, grid } = town();
    const fw = placeByWalkway(state, grid, "fireWatch", 1)[0];
    expect(fw).toBeDefined();
    expect(serviceRadius(state, fw)).toBe(UPGRADES.fireWatch!.capacity[0]);
    expect(upgradeBuilding(state, fw)).toBe(true);
    expect(serviceRadius(state, fw)).toBe(UPGRADES.fireWatch!.capacity[1]);
    fw.damaged = true;
    expect(upgradeBlocker(state, fw)).toMatch(/Repair/);
  });
});

function dist(a: Building, b: Building): number {
  let d = Infinity;
  for (const p of a.cells) for (const q of b.cells) d = Math.min(d, Math.max(Math.abs(p.i - q.i), Math.abs(p.j - q.j)));
  return d;
}
