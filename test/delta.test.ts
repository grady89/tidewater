// The Delta (BIOMES.md §3.4): its river, levee and mangroves, the swell and the king tide, its six kinds, the
// crocodiles, fever season and the rice harvest.
import { describe, expect, it } from "vitest";
import { BUILDINGS, CRAB_POT_PER_SHIFT, FEVER_SHARE, RICE_PER_HARVEST, SALT_PER_CYCLE, STORM_CHANCE } from "../src/sim/balance";
import { biomeOf, catchOf, makesOf } from "../src/sim/biomes";
import { feverSeason, freshCells } from "../src/sim/biomes/delta";
import { tryPlace } from "../src/sim/economy";
import { startStorm } from "../src/sim/events";
import { cellIndex, Grid } from "../src/sim/grid";
import { island, islandFailures, rerollRate } from "../src/sim/island";
import { clearTree, treeAt } from "../src/sim/land";
import { materialCode } from "../src/sim/materials";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { isKingCycle, isSwellCycle, peakLevel } from "../src/sim/tide";
import { growStreet, joinByLine, placeByWalkway, placeEdge, placeNear, starterTown } from "./scenario";

function deltaTown(seed = 7) {
  const { state, grid } = newGame(1, seed, "delta");
  const town = starterTown(state, grid);
  state.resources.money += 5000;
  return { state, grid, town };
}
function fillHomes(state: SimState, grid: Grid): void {
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
}
const kinds = (state: SimState, k: string) => buildingList(state).filter(b => b.kind === k);

describe("the Delta's island", () => {
  it("has a river through a levee, braided channels, wide flats and mangroves, and passes its own validation", () => {
    const isl = island(0, "delta");
    expect(islandFailures(isl.stats, "delta", isl.height)).toEqual([]);
    expect(isl.stats.region).toBeGreaterThanOrEqual(250);
    expect(isl.stats.materials[materialCode("mangrove")]).toBeGreaterThanOrEqual(60);
    // Every mangrove cell carries a tree (they must be cleared to build).
    const mangroves = [...isl.materials].filter(m => m === materialCode("mangrove")).length;
    expect(isl.trees.length).toBe(mangroves);
    // The levee is the only high ground, low and dry; nothing on the island stands above 1.6.
    let high = 0, tall = 0;
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) { const h = isl.height(i + 0.5, j + 0.5); if (h > 0.6) high++; if (h > 1.6) tall++; }
    expect(high).toBeGreaterThan(40);
    expect(tall).toBe(0);
    const r = rerollRate(1, 20, "delta");
    expect(r.fallbacks).toBe(0);
    expect(r.rerolls).toBeLessThan(20);
  });
  it("is the Delta's delta on the catalog: rice and crab, indigo, salt; no timber, shellfish or smoking; crab is the catch", () => {
    expect(makesOf("delta")).toEqual(["rice", "crab", "indigo", "salt"]);
    expect(catchOf("delta")).toBe("crab");
    const { state, grid } = newGame(1, 3, "delta");
    expect(state.resources.crab).toBeGreaterThan(0);
    for (const k of ["ricePaddy", "crabPots", "saltPan", "indigoVats", "wardenTower", "crocNet"] as const) expect(grid.inCatalog(k)).toBe(true);
    for (const k of ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse", "lifeguard", "sharkNet"] as const) expect(grid.inCatalog(k)).toBe(false);
    expect(biomeOf("delta").storm!.chance).toBeGreaterThan(1);
    expect(biomeOf("delta").bands).toEqual(["temperate", "tropical"]);
  });
});

describe("the river's swell and the king tide", () => {
  it("swells every 6th cycle and a swell on a spring peak is a king tide 0.3 over the spring", () => {
    const { state } = newGame(1, 3, "delta");
    const s = state.tide.surge!;
    expect(isSwellCycle(6, s) && !isKingCycle(6, s)).toBe(true);
    expect(isKingCycle(12, s)).toBe(true);
    expect(peakLevel(12, 1, s)).toBeCloseTo(peakLevel(12) + 0.3, 6);
    expect(peakLevel(6, 1, s)).toBeCloseTo(peakLevel(6) + s.rise, 6);
    expect(peakLevel(5, 1, s)).toBeCloseTo(peakLevel(5), 6);
  });
  it("buildings and fixed decks clear the king tide; low standard walkways go under at it; the paddies' crop is washed out", () => {
    const { state, grid, town } = deltaTown();
    const paddy = placeByWalkway(state, grid, "ricePaddy", 1)[0];
    expect(paddy).toBeTruthy();
    const king = peakLevel(12, 1, state.tide.surge);
    for (const h of town.huts) expect(h.floorY).toBeGreaterThan(king);
    expect(town.pier.floorY).toBeGreaterThan(king);
    // A standard walkway on the lowest flat cell floods at the king tide.
    let low: Cell | null = null;
    for (let i = -30; i < 30 && !low; i++) for (let j = -30; j < 30 && !low; j++) { const c = { i, j }; if (grid.classAt(c) === "flat" && grid.heightAt(c) < 0.1 && !grid.buildingAt(c) && !grid.treeOn([c]) && grid.canPlace("walkway", [c])) low = c; }
    const w = tryPlace(state, grid, "walkway", low!)!;
    expect(w.floorY).toBeLessThan(king);
    paddy.progress = 1;
    advanceCycles(state, grid, 12 - state.tide.cycle);
    expect(state.tide.cycle).toBe(12);
    expect(paddy.progress).toBe(0);
    expect(state.log.some(m => /king tide/.test(m))).toBe(true);
  });
});

describe("the Delta's kinds", () => {
  it("a paddy on fresh water grows rice every two cycles; one with no water grows nothing", () => {
    const { state, grid } = deltaTown();
    fillHomes(state, grid);
    const fresh = freshCells(grid);
    expect(fresh.length).toBeGreaterThan(5);
    advanceCycles(state, grid, 1); // the coverage layers are painted at the settlement
    const wetAt = (c: Cell) => state.fields.coverage.water[cellIndex(c.i, c.j)] > 0;
    const paddy = placeByWalkway(state, grid, "ricePaddy", 6).find(p => p.cells.some(wetAt));
    const dry = kinds(state, "ricePaddy").find(p => !p.cells.some(wetAt));
    expect(paddy).toBeTruthy();
    // The crop grows at low water and comes in at the end of a low (the settlement resets the counters): watch.
    let harvested = 0, dryOut = 0;
    for (let k = 0; k < 4 * 2400; k++) { tick(state, grid); harvested = Math.max(harvested, paddy!.output); dryOut = Math.max(dryOut, dry?.output ?? 0); }
    expect(harvested).toBeGreaterThan(0);
    expect(harvested).toBeLessThanOrEqual(RICE_PER_HARVEST * 1.25 + 1e-9);
    expect(dryOut).toBe(0);
  });
  it("crab pots bring crab in at low water; the salt pan makes salt, half in a storm; the indigo vats make indigo and foul the water", () => {
    const { state, grid, town } = deltaTown();
    fillHomes(state, grid);
    // Room on the street and more hands than jobs, so every kind is staffed.
    growStreet(state, grid, 8);
    placeByWalkway(state, grid, "house", 4);
    fillHomes(state, grid);
    const pots = placeEdge(state, grid, "crabPots", town.pier.cells[0], 2);
    expect(pots).toBeTruthy();
    const pan = placeByWalkway(state, grid, "saltPan", 1)[0] ?? placeNear(state, grid, "saltPan", town.huts[0].cells[0]);
    const vats = placeByWalkway(state, grid, "indigoVats", 1)[0];
    expect(pan && vats).toBeTruthy();
    for (const b of [pots!, pan!]) if (!b.reached) joinByLine(state, grid, town.huts[0].cells[0], b.cells[0]);
    fillHomes(state, grid);
    // Shift work lands at the end of the shift (the settlement resets the counter): watch the pots across a low water.
    let crab = 0;
    for (let k = 0; k < 3 * 2400; k++) { tick(state, grid); crab = Math.max(crab, pots!.output); }
    expect(pots!.reached && pan!.reached && vats.reached).toBe(true);
    expect(crab).toBeGreaterThan(0);
    expect(crab).toBeLessThanOrEqual(CRAB_POT_PER_SHIFT * 2 + 1e-9);
    expect(pan!.output).toBeCloseTo(SALT_PER_CYCLE * Math.min(1, pan!.workers / BUILDINGS.saltPan.workers), 6);
    expect(vats.output).toBeGreaterThan(0);
    expect(state.emitters.some(e => e.k === cellIndex(vats.cells[0].i, vats.cells[0].j))).toBe(true);
    const calm = pan!.output;
    startStorm(state, grid);
    advanceCycles(state, grid, 1);
    expect(pan!.output).toBeCloseTo(calm * 0.5, 6);
  });
  it("clearing a mangrove gives no timber and stirs pollution into its cell", () => {
    const { state, grid } = newGame(1, 5, "delta");
    const sites = grid.island.trees;
    const c = sites.find(s => grid.materialAt(s.cell) === "mangrove")!.cell;
    const timber = state.resources.timber;
    expect(treeAt(state, c)).toBeGreaterThanOrEqual(0);
    expect(grid.canPlace("walkway", [c])).toBe(false);
    expect(clearTree(state, grid, c)).toBe(true);
    expect(state.resources.timber).toBe(timber);
    expect(state.fields.pollution[cellIndex(c.i, c.j)]).toBeGreaterThan(0.2);
  });
});

describe("the Delta's hazards and moments", () => {
  it("fever season lays up a share of every home out of a clinic's reach", () => {
    const { state, grid } = deltaTown();
    fillHomes(state, grid);
    while (!feverSeason(state.tide.cycle + 1)) advanceCycles(state, grid, 1);
    const homes = kinds(state, "hut").filter(h => h.residents > 0);
    advanceCycles(state, grid, 1);
    expect(homes.some(h => h.injured > 0)).toBe(true);
    expect(FEVER_SHARE).toBeGreaterThan(0);
    expect(state.log.some(m => /Fever season/.test(m))).toBe(true);
  });
  it("crocodiles take the shark's place, and a croc net stops the risk crossing", () => {
    const { state, grid } = deltaTown();
    expect(biomeOf("delta").predator).toBe("crocodile");
    expect(BUILDINGS.crocNet.stopsPredators).toBe(true);
    let net: Building | null = null;
    for (let i = -30; i < 30 && !net; i++) for (let j = -30; j < 30 && !net; j++) { const c = { i, j }; if (grid.classAt(c) === "deep") net = tryPlace(state, grid, "crocNet", c); }
    expect(net).toBeTruthy();
    const k = cellIndex(net!.cells[0].i, net!.cells[0].j);
    state.fields.shark[k] = 1;
    tick(state, grid);
    expect(state.fields.shark[k]).toBe(0);
  });
  it("storms come half again as often", () => {
    expect(STORM_CHANCE * biomeOf("delta").storm!.chance!).toBeCloseTo(STORM_CHANCE * 1.5, 9);
  });
  it("at a spring low every standing crop comes in at once: the rice harvest", () => {
    const { state, grid } = deltaTown();
    fillHomes(state, grid);
    advanceCycles(state, grid, 1);
    const wetAt = (c: Cell) => state.fields.coverage.water[cellIndex(c.i, c.j)] > 0;
    const paddies = placeByWalkway(state, grid, "ricePaddy", 6).filter(p => p.cells.some(wetAt));
    expect(paddies.length).toBeGreaterThan(0);
    placeByWalkway(state, grid, "house", 3);
    fillHomes(state, grid);
    const before = state.biomeState.harvests ?? 0;
    biomeOf("delta").force!.harvest(state, grid);
    expect(state.biomeState.harvests ?? 0).toBeGreaterThan(before);
    expect(state.log.some(m => /rice harvest/.test(m))).toBe(true);
  });
});
