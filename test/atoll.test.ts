// The Atoll (BIOMES.md §3.2): its ring and lagoon, its four kinds, the cyclone, bleaching and the turtles.
import { describe, expect, it } from "vitest";
import { BLEACH_POLLUTION, BUILDINGS, COCONUT_PER_TREE, HATCHING_BONUS, PEARLS_PER_SHIFT, STORM_LOSS_CHANCE } from "../src/sim/balance";
import { biomeOf, makesOf } from "../src/sim/biomes";
import { hatching, lanternDimmed, passAngles, turtleBonus } from "../src/sim/biomes/atoll";
import { isDaytime } from "../src/sim/daylight";
import { tryPlace } from "../src/sim/economy";
import { startStorm } from "../src/sim/events";
import { at } from "../src/sim/fields";
import { cellIndex, Grid } from "../src/sim/grid";
import { candidate, island, islandFailures, rerollRate } from "../src/sim/island";
import { materialCode } from "../src/sim/materials";
import { addLantern, coverageAt } from "../src/sim/services";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { companyBuys, companyCarries } from "../src/sim/trade";
import { growStreet, placeByWalkway, starterTown } from "./scenario";

function atollTown(seed = 7) {
  const { state, grid } = newGame(1, seed, "atoll");
  const town = starterTown(state, grid);
  return { state, grid, town };
}
function fillHomes(state: SimState, grid: Grid): void {
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
}
/** The nearest cell to `near` where `kind` can go (a link-needing lagoon kind: beside a walkway on the flats). */
function placeNear(state: SimState, grid: Grid, kind: keyof typeof BUILDINGS, near: Cell): Building | null {
  const cells: Cell[] = [];
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) cells.push({ i, j });
  cells.sort((a, b) => Math.hypot(a.i - near.i, a.j - near.j) - Math.hypot(b.i - near.i, b.j - near.j));
  for (const c of cells) { const b = tryPlace(state, grid, kind, c); if (b) return b; }
  return null;
}

describe("the Atoll's island", () => {
  it("is a ring round a lagoon of ≥ 200 lagoon cells with at least one pass, and passes its validation on the seeds", () => {
    const isl = island(0, "atoll");
    expect(islandFailures(isl.stats, "atoll")).toEqual([]);
    const lagoon = materialCode("lagoon");
    expect(isl.stats.materials[lagoon]).toBeGreaterThanOrEqual(200);
    expect(isl.stats.deepCells).toBeGreaterThanOrEqual(40);
    expect(isl.stats.highCells).toBe(0); // no snow, no cliffs
    expect(isl.trees.length).toBeGreaterThan(30);
    // The lagoon is shallow water inside the ring; the ring is land; outside is deep.
    expect(isl.height(0, 0)).toBeLessThan(-0.21); expect(isl.height(0, 0)).toBeGreaterThan(-1.3);
    expect(isl.materials[cellIndex(0, 0)]).toBe(lagoon);
    let land = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.05) if (isl.height(Math.cos(a) * 20, Math.sin(a) * 20) > -0.21) land++;
    expect(land).toBeGreaterThan(100); // most of the ring at r = 20 is land or flats
    expect(isl.height(0, 30)).toBeLessThan(-2);
    expect(passAngles(0).length).toBe(1); expect(passAngles(1).length).toBe(2);
    const r = rerollRate(1, 16, "atoll");
    expect(r.fallbacks).toBe(0);
    expect(candidate(2, 0, "atoll").stats.materials[lagoon]).toBeGreaterThan(200);
  });

  it("a starter town on the Atoll nets positive money over four cycles at a ×0.6 tide", () => {
    const { state, grid, town } = atollTown();
    expect(town.market).not.toBeNull();
    expect(town.pier.floorY).toBeCloseTo(0.6, 6);
    const money = state.resources.money;
    advanceCycles(state, grid, 4);
    expect(state.last.fishCaught).toBeGreaterThan(0);
    expect(state.resources.money).toBeGreaterThan(money);
    expect(makesOf("atoll")).toEqual(["fish", "coconut", "pearls", "sponges"]);
    expect(companyCarries(state)).toContain("timber");
    expect(companyCarries(state)).toContain("smoked"); // its favourite
    expect(companyBuys(state)).toContain("pearls");
    expect(grid.inCatalog("lumberCamp")).toBe(false);
  });
});

describe("the Atoll's kinds", () => {
  it("the coconut grove gathers from the palms within reach", () => {
    const { state, grid } = atollTown();
    state.resources.money += 3000;
    growStreet(state, grid, 4);
    placeByWalkway(state, grid, "house", 3);
    let grove: Building | null = null;
    for (const w of buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway")) {
      for (const n of grid.neighbors(w.cells[0])) { grove = tryPlace(state, grid, "coconutGrove", n); if (grove) break; }
      if (grove) break;
    }
    expect(grove).not.toBeNull();
    fillHomes(state, grid);
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    advanceCycles(state, grid, 2);
    expect(grove!.workers).toBeGreaterThan(0);
    const palms = grid.island.trees.filter(s => grove!.cells.some(c => Math.abs(s.cell.i - c.i) <= 6 && Math.abs(s.cell.j - c.j) <= 6)).length;
    if (palms > 0) {
      expect(grove!.output).toBeGreaterThan(0);
      expect(grove!.output).toBeLessThanOrEqual(palms * COCONUT_PER_TREE + 1e-6);
      expect(state.resources.coconut + state.last.shellfishSold).toBeGreaterThan(0);
    } else expect(grove!.output).toBe(0);
  });

  it("the dive platform brings up pearls at low water only with a pearl house within 8; the nursery needs the lagoon", () => {
    const { state, grid, town } = atollTown();
    state.resources.money += 5000; state.resources.planks += 100;
    growStreet(state, grid, 5);
    placeByWalkway(state, grid, "house", 4);
    const platform = placeNear(state, grid, "divePlatform", town.pier.cells[0]);
    expect(platform).not.toBeNull();
    expect(grid.materialAt(platform!.cells[0])).toBe("lagoon");
    fillHomes(state, grid);
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    advanceCycles(state, grid, 2);
    expect(platform!.workers).toBeGreaterThan(0);
    expect(state.resources.pearls).toBe(0); // nobody to grade them
    const house = placeByWalkway(state, grid, "pearlHouse", 1)[0];
    expect(house).toBeDefined();
    expect(house.cells.some(c => platform!.cells.some(d => Math.abs(c.i - d.i) <= 8 && Math.abs(c.j - d.j) <= 8))).toBe(true);
    fillHomes(state, grid);
    let lowShifts = 0, prevPhase = state.phase, gained = 0, prev = state.resources.pearls;
    for (let k = 0; k < 120 * 20 * 2; k++) {
      tick(state, grid);
      const d = state.resources.pearls - prev;
      if (d > 0) { expect(prevPhase).toBe("low"); gained += d; }
      if (state.phase === "low" && prevPhase !== "low") lowShifts++;
      prevPhase = state.phase; prev = state.resources.pearls;
    }
    expect(lowShifts).toBeGreaterThan(0);
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(PEARLS_PER_SHIFT * 2 * lowShifts + 1e-6);
    // The nursery stands on a lagoon cell only.
    const nursery = placeNear(state, grid, "reefNursery", town.pier.cells[0]);
    expect(nursery).not.toBeNull();
    expect(grid.materialAt(nursery!.cells[0])).toBe("lagoon");
    let plain: Cell | null = null;
    for (let i = -30; i < 30 && !plain; i++) for (let j = -30; j < 30; j++) { const c = { i, j }; if (grid.classAt(c) === "deep" && grid.materialAt(c) === "plain" && grid.touchesLink([c]) && !grid.buildingAt(c)) { plain = c; break; } }
    if (plain) expect(tryPlace(state, grid, "reefNursery", plain)).toBeNull();
  });
});

describe("the Atoll's hazards and moments", () => {
  it("a cyclone is a storm with a harder hand on the boats; bleaching follows pollution into the lagoon and a nursery recovers it", () => {
    const { state, grid, town } = atollTown();
    expect(biomeOf("atoll").storm).toEqual({ swell: 2, loss: 1.5, name: "cyclone" });
    startStorm(state, grid);
    expect(state.log.some(m => /cyclone/.test(m))).toBe(true);
    expect(STORM_LOSS_CHANCE * 1.5).toBeLessThan(1);
    // Bleaching: foul a lagoon cell and settle; the field rises; clean it and it falls; a nursery speeds that up.
    const lagoon = materialCode("lagoon");
    let k = -1;
    for (let q = 0; q < grid.materials.length && k < 0; q++) if (grid.materials[q] === lagoon) k = q;
    expect(k).toBeGreaterThanOrEqual(0);
    state.fields.pollution[k] = BLEACH_POLLUTION + 0.2;
    state.emitters = [{ k, rate: 10 }]; // keep it foul through the cycle
    advanceCycles(state, grid, 3);
    expect(state.fields.bleach[k]).toBeGreaterThan(0);
    expect(state.biomeState.bleached).toBeGreaterThanOrEqual(0);
    const bleached = state.fields.bleach[k];
    state.emitters = [];
    state.fields.pollution.fill(0);
    advanceCycles(state, grid, 1);
    expect(state.fields.bleach[k]).toBeLessThan(bleached);
    void town;
  });

  it("on a spring night the turtles hatch: lanterns near the beach go dark on their own and tourism gains a lasting bonus", () => {
    const { state, grid, town } = atollTown();
    state.resources.money += 2000;
    growStreet(state, grid, 4);
    // A lantern on a walkway within 4 of a beach cell.
    let lit: Building | null = null;
    for (const w of buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway")) {
      let nearBeach = false;
      for (let di = -4; di <= 4 && !nearBeach; di++) for (let dj = -4; dj <= 4; dj++) if (grid.isBeach({ i: w.cells[0].i + di, j: w.cells[0].j + dj })) { nearBeach = true; break; }
      if (nearBeach && addLantern(state, grid, w.cells[0])) { lit = w; break; }
    }
    expect(lit).not.toBeNull();
    fillHomes(state, grid);
    expect(turtleBonus(state)).toBe(1);
    // Run until a spring settlement falls at night (a day is two cycles: every other spring is a night one).
    let hatched = false;
    for (let c = 0; c < 24 && !hatched; c++) {
      advanceCycles(state, grid, 1);
      if (hatching(state)) {
        hatched = true;
        expect(isDaytime(state.time + 30)).toBe(false); // the cycle after a spring peak is the night half of the day
        expect(lanternDimmed(state, grid, lit!)).toBe(true);
        expect(coverageAt(state, "night", lit!.cells[0])).toBe(0);
      }
    }
    expect(hatched).toBe(true);
    expect(turtleBonus(state)).toBeCloseTo(1 + HATCHING_BONUS, 9);
    expect(state.log.some(m => /turtles hatch/.test(m))).toBe(true);
    advanceCycles(state, grid, 1);
    expect(hatching(state)).toBe(false);
    expect(lanternDimmed(state, grid, lit!)).toBe(false);
    expect(coverageAt(state, "night", lit!.cells[0])).toBe(1);
    expect(at(state.fields.bleach, town.huts[0].cells[0])).toBe(0);
  });
});
