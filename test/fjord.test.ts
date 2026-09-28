// The Fjord (BIOMES.md §3.3): its island, its five kinds, whale season, sea ice, the avalanche and the aurora.
import { describe, expect, it } from "vitest";
import { AVALANCHE_MIN_HEIGHT, BOAT_CREW, BUILDINGS, CAP_BASE, HAPPY_AURORA, ICE_EVERY, ICE_FIRST, ICE_HOUSE_CAP_FACTOR, IRON_PER_CYCLE, SALT_PER_STOCKFISH, STOCKFISH_RATE, STOCKFISH_UNSALTED, WHALE_OIL_PER_CYCLE, WHALE_SEASON_FIRST, WHALE_SEASON_LENGTH } from "../src/sim/balance";
import { biomeOf, makesOf } from "../src/sim/biomes";
import { seaIce, whaleSeason } from "../src/sim/biomes/fjord";
import { capFor, homeHappiness, tryPlace } from "../src/sim/economy";
import { startStorm } from "../src/sim/events";
import { fireSources } from "../src/sim/fire";
import { candidate, island, islandFailures, rerollRate } from "../src/sim/island";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { companyCarries } from "../src/sim/trade";
import { jobsAt } from "../src/sim/workers";
import { cellIndex, Grid } from "../src/sim/grid";
import { bridgeTo, growStreet, placeByWalkway, placeEdge, starterTown, joinByLine } from "./scenario";

function fjordTown(seed = 7) {
  const { state, grid } = newGame(1, seed, "fjord");
  const town = starterTown(state, grid);
  return { state, grid, town };
}

/** The nearest cell to `near` where `kind` can go. */
function placeNear(state: SimState, grid: Grid, kind: keyof typeof BUILDINGS, near: Cell): Building | null {
  const cells: Cell[] = [];
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) cells.push({ i, j });
  cells.sort((a, b) => Math.hypot(a.i - near.i, a.j - near.j) - Math.hypot(b.i - near.i, b.j - near.j));
  for (const c of cells) { const b = tryPlace(state, grid, kind, c); if (b) return b; }
  return null;
}

function fillHomes(state: SimState, grid: Grid): void {
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
}

describe("the Fjord's island", () => {
  it("has a deep channel between two ridges, flats at the head, snow on the crests, and passes its own validation", () => {
    const isl = island(0, "fjord");
    expect(islandFailures(isl.stats, "fjord")).toEqual([]);
    expect(isl.stats.deepCells).toBeGreaterThan(120);
    expect(isl.stats.highCells).toBeGreaterThan(40);
    expect(isl.stats.flats).toBeGreaterThan(260);
    expect(isl.trees.length).toBeGreaterThan(100);
    // The channel: deep water down x ≈ 0 from the mouth toward the head; ridges either side above the snow line.
    for (const z of [20, 10, 0]) expect(isl.height(0, z)).toBeLessThan(-2.4);
    for (const x of [-12, 12]) expect(Math.max(isl.height(x, 0), isl.height(x, 8), isl.height(x, -4))).toBeGreaterThan(4);
    expect(isl.height(0, -20)).toBeGreaterThan(-0.56); // the head: flats where the channel ends
    const r = rerollRate(1, 20, "fjord");
    expect(r.fallbacks).toBe(0);
    expect(r.rerolls).toBeLessThan(20);
    expect(candidate(3, 0, "fjord").stats.materials[0]).toBeGreaterThan(0);
  });

  it("a starter town on the Fjord nets positive money over four cycles at a ×1.6 tide", () => {
    const { state, grid, town } = fjordTown();
    expect(town.market).not.toBeNull();
    expect(town.pier.floorY).toBeCloseTo(1.6, 6);
    const money = state.resources.money;
    advanceCycles(state, grid, 4);
    expect(state.last.fishCaught).toBeGreaterThan(0);
    expect(state.resources.money).toBeGreaterThan(money);
    expect(makesOf("fjord")).toContain("stockfish");
    expect(companyCarries(state)).toContain("salt");
    expect(companyCarries(state)).not.toContain("iron");
  });
});

describe("the Fjord's kinds", () => {
  it("stockfish racks dry fish with salt, and at half value without it", () => {
    const { state, grid } = fjordTown();
    state.resources.money += 2000;
    growStreet(state, grid, 4);
    expect(placeByWalkway(state, grid, "house", 3).length).toBe(3);
    const racks = placeByWalkway(state, grid, "stockfishRacks", 1)[0];
    expect(racks).toBeDefined();
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    fillHomes(state, grid);
    state.resources.fish = 60; state.resources.salt = 0;
    advanceCycles(state, grid, 1);
    expect(racks.workers).toBeGreaterThan(0);
    const dry = racks.output;
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThanOrEqual(STOCKFISH_RATE * STOCKFISH_UNSALTED + 1e-6);
    state.resources.fish = 60; state.resources.salt = 20; state.resources.stockfish = 0;
    advanceCycles(state, grid, 1);
    expect(racks.output).toBeGreaterThan(dry);
    expect(state.resources.salt).toBeLessThan(20);
    expect(20 - state.resources.salt).toBeCloseTo(SALT_PER_STOCKFISH * STOCKFISH_RATE * (racks.workers / BUILDINGS.stockfishRacks.workers), 6);
  });

  it("the whaling station makes whale oil and meat only in whale season and only with a boat", () => {
    const { state, grid, town } = fjordTown();
    state.resources.money += 5000; state.resources.planks += 200;
    growStreet(state, grid, 6);
    placeByWalkway(state, grid, "house", 4);
    const station = placeEdge(state, grid, "whalingStation", town.pier.cells[0], 6);
    expect(station).not.toBeNull();
    bridgeTo(state, grid, station!); // a raised walkway out to the quay so hands can reach it
    fillHomes(state, grid);
    expect(whaleSeason(WHALE_SEASON_FIRST)).toBe(true);
    expect(whaleSeason(WHALE_SEASON_FIRST + WHALE_SEASON_LENGTH)).toBe(false);
    advanceCycles(state, grid, WHALE_SEASON_FIRST - state.tide.cycle);
    expect(state.biomeState.whaleSeason).toBe(1);
    expect(station!.boats).toBe(0);
    expect(station!.output).toBe(0); // no boat, nothing
    station!.boats = 1;
    advanceCycles(state, grid, 1);
    expect(station!.workers).toBeGreaterThan(0);
    expect(state.resources.whaleOil).toBeGreaterThan(0);
    expect(jobsAt(station!)).toBe(BUILDINGS.whalingStation.workers + BOAT_CREW); // its own hands plus the boat's crew
    expect(station!.output).toBeCloseTo(WHALE_OIL_PER_CYCLE * Math.min(1, station!.workers / jobsAt(station!)), 3);
    advanceCycles(state, grid, WHALE_SEASON_LENGTH);
    expect(state.biomeState.whaleSeason).toBe(0);
    expect(station!.output).toBe(0);
    expect(state.log.some(m => /whale season/i.test(m))).toBe(true);
  });

  it("the iron mine digs iron on the ridge and raises fire risk; the ice house doubles the fish cap", () => {
    const { state, grid, town } = fjordTown();
    state.resources.money += 5000;
    growStreet(state, grid, 6);
    placeByWalkway(state, grid, "house", 4);
    const mine = placeNear(state, grid, "ironMine", town.market!.cells[0]);
    expect(mine).not.toBeNull();
    expect(grid.classAt(mine!.cells[0])).toBe("high");
    const ice = placeByWalkway(state, grid, "iceHouse", 1)[0];
    expect(ice).toBeDefined();
    fillHomes(state, grid);
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    advanceCycles(state, grid, 2);
    if (mine!.workers === 0) {
      // Join the mine to the street along a walkable route of paths and walkways.
      joinByLine(state, grid, town.market!.cells[0], mine!.cells[0]);
      advanceCycles(state, grid, 2);
    }
    expect(mine!.workers).toBeGreaterThan(0);
    expect(mine!.output).toBeCloseTo(IRON_PER_CYCLE * mine!.workers / BUILDINGS.ironMine.workers, 3);
    expect(state.resources.iron).toBeGreaterThan(0);
    const mineCells = new Set(mine!.cells.map(c => cellIndex(c.i, c.j)));
    expect(fireSources(state).some(e => mineCells.has(e.k) && e.rate > 0)).toBe(true);
    expect(capFor(state, "fish")).toBe(CAP_BASE.fish * ICE_HOUSE_CAP_FACTOR);
    expect(capFor(state, "stockfish")).toBe(CAP_BASE.stockfish);
  });
});

describe("the Fjord's hazards and moments", () => {
  it("sea ice keeps the pier's boats in and turns the ship back; an ice-breaker pier's boats still sail", () => {
    const { state, grid, town } = fjordTown();
    state.resources.money += 5000; state.resources.planks += 200;
    growStreet(state, grid, 4);
    placeByWalkway(state, grid, "house", 3);
    const breaker = placeEdge(state, grid, "iceBreakerPier", town.pier.cells[0], 4);
    expect(breaker).not.toBeNull();
    breaker!.boats = 2;
    fillHomes(state, grid);
    expect(seaIce(ICE_FIRST)).toBe(true); expect(seaIce(ICE_FIRST + 1)).toBe(false); expect(seaIce(ICE_FIRST + ICE_EVERY)).toBe(true);
    advanceCycles(state, grid, ICE_FIRST - state.tide.cycle);
    expect(state.biomeState.seaIce).toBe(1);
    // Boats already out at the peak come home; from the first shift that starts on the ice, the pier's stay in.
    let pierSailed = false, breakerSailed = false, seenLow = false;
    for (let k = 0; k < 120 * 20 && state.tide.cycle === ICE_FIRST; k++) { tick(state, grid); if (state.phase === "low") seenLow = true; if (seenLow) { pierSailed ||= town.pier.atSea; breakerSailed ||= breaker!.atSea; } }
    expect(pierSailed).toBe(false);
    expect(breakerSailed).toBe(true);
    expect(state.biomeState.seaIce).toBe(0);
    expect(state.log.some(m => /frozen/.test(m))).toBe(true);
  });

  it("a storm shakes an avalanche onto the slope; the aurora lifts every home on a clear night", () => {
    const { state, grid, town } = fjordTown();
    state.resources.money += 5000;
    growStreet(state, grid, 4);
    let slopeHut: Building | null = null;
    const sites = grid.island.trees;
    for (let i = -30; i < 30 && !slopeHut; i++) for (let j = -30; j < 30 && !slopeHut; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "high" || grid.heightAt(c) < AVALANCHE_MIN_HEIGHT || grid.heightAt(c) > 3.6 || grid.buildingAt(c)) continue;
      const treeAbove = sites.some(s => Math.abs(s.cell.i - i) <= 3 && Math.abs(s.cell.j - j) <= 3 && grid.heightAt(s.cell) > grid.heightAt(c) + 1.0);
      if (!treeAbove) continue;
      slopeHut = tryPlace(state, grid, "hut", c);
    }
    expect(slopeHut).not.toBeNull();
    let buried = false;
    for (let k = 0; k < 12 && !buried; k++) {
      startStorm(state, grid);
      advanceCycles(state, grid, 2);
      buried = slopeHut!.damaged;
    }
    expect(buried).toBe(true);
    expect(state.log.some(m => /avalanche/.test(m))).toBe(true);
    expect(state.biomeState.avalanches).toBeGreaterThan(0);
    const home = town.huts[0];
    state.storm.active = false;
    const clear = homeHappiness(state, home, 1, 1, grid);
    state.storm.active = true;
    const stormy = homeHappiness(state, home, 1, 1, grid);
    state.storm.active = false;
    expect(clear - stormy).toBeCloseTo(HAPPY_AURORA, 6);
    expect(biomeOf("fjord").sharks).toBe(false);
    expect(state.incidents).toBe(0);
  });
});
