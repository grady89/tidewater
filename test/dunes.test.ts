// The Dunes (BIOMES.md §3.6): sandbars and a lagoon, dunes, a headland, two or three oases; tide ×0.8; dates, fish,
// coffee, salt and sponges; the great cistern and wells that reach 3; the sandstorm that silts the harbour and the
// dredger that clears it; the drought; the night market.
import { describe, expect, it } from "vitest";
import {
  BUILDINGS, COFFEE_PER_CYCLE, DATES_PER_CYCLE, DROUGHT_CISTERN, NIGHT_MARKET_TOURISM, SILT_FACTOR, SPONGES_PER_SHIFT, WELL_RADIUS_DUNES,
} from "../src/sim/balance";
import { biomeOf, makesOf } from "../src/sim/biomes";
import { drought, oasisSites, silted } from "../src/sim/biomes/dunes";
import { Grid } from "../src/sim/grid";
import { island, islandFailures, rerollRate } from "../src/sim/island";
import { materialCode } from "../src/sim/materials";
import { serviceRadius, serviceStrength } from "../src/sim/services";
import { newGame } from "../src/sim/start";
import { Building, buildingList, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { biomeTown, placeByWalkway, placeJoined, starterTown } from "./scenario";

function dunesTown(seed = 0) {
  const { state, grid } = newGame(3, seed, "dunes");
  const town = starterTown(state, grid);
  state.resources.money += 8000;
  return { state, grid, town };
}
function fillHomes(state: SimState, grid: Grid): void {
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
}
const staffing = (b: Building) => Math.min(1, b.workers / BUILDINGS[b.kind].workers);

describe("the Dunes' island", () => {
  it("has sandbars and a lagoon, dunes, a rocky headland and two or three oases, and passes its own validation", () => {
    for (const seed of [0, 1, 2]) {
      const isl = island(seed, "dunes");
      expect(islandFailures(isl.stats, "dunes", isl.height)).toEqual([]);
      const m = (k: Parameters<typeof materialCode>[0]) => isl.stats.materials[materialCode(k)] ?? 0;
      expect(m("oasis")).toBeGreaterThanOrEqual(18);
      expect(m("lagoon")).toBeGreaterThanOrEqual(80);
      expect(m("dune")).toBeGreaterThanOrEqual(100);
      const n = oasisSites(isl.noiseSeed).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
      // The headland: the only rock above 2.
      let rock = 0;
      for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) if (isl.height(i + 0.5, j + 0.5) > 2) rock++;
      expect(rock).toBeGreaterThan(10);
      // Date palms only at the oases.
      for (const t of isl.trees) expect(oasisSites(isl.noiseSeed).some(o => Math.hypot(t.x - o.x, t.z - o.z) < 4)).toBe(true);
    }
    const r = rerollRate(1, 20, "dunes");
    expect(r.fallbacks).toBe(0);
    expect(biomeOf("dunes").tide).toBe(0.8);
  });
  it("is the Dunes' delta on the catalog: dates and fish, coffee, salt, sponges; no oysters or timber", () => {
    expect(makesOf("dunes")).toEqual(["dates", "fish", "coffee", "salt", "sponges"]);
    const { grid } = newGame(3, 0, "dunes");
    for (const k of ["dateGrove", "coffeeTerrace", "spongeDivers", "greatCistern", "dredger", "saltPan"] as const) expect(grid.inCatalog(k)).toBe(true);
    for (const k of ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse"] as const) expect(grid.inCatalog(k)).toBe(false);
  });
});

describe("the Dunes' kinds", () => {
  it("date grove on an oasis, coffee terrace beside one, sponge divers at low water on the lagoon; the starter town nets positive", () => {
    const { state, grid, town } = dunesTown();
    state.resources.money -= 8000;
    const m0 = state.resources.money;
    advanceCycles(state, grid, 4);
    expect(state.resources.money).toBeGreaterThan(m0);
    const { extras } = biomeTown(state, grid, 4000, town);
    placeByWalkway(state, grid, "house", 6);
    fillHomes(state, grid);
    const grove = extras.dateGrove!, coffee = extras.coffeeTerrace!, divers = extras.spongeDivers!;
    expect(grove && coffee && divers).toBeTruthy();
    for (const c of grove.cells) expect(grid.materialAt(c)).toBe("oasis");
    expect(coffee.cells.some(c => grid.neighbors(c).some(n => grid.materialAt(n) === "oasis"))).toBe(true);
    for (const c of divers.cells) expect(grid.materialAt(c)).toBe("lagoon");
    advanceCycles(state, grid, 2);
    expect(grove.output).toBeCloseTo(DATES_PER_CYCLE * staffing(grove), 6);
    expect(coffee.output).toBeCloseTo(COFFEE_PER_CYCLE * staffing(coffee), 6);
    const sp0 = state.resources.sponges;
    advanceCycles(state, grid, 1);
    expect(state.resources.sponges - sp0).toBeCloseTo(SPONGES_PER_SHIFT * staffing(divers), 6);
  });
  it("wells reach 3 here; the great cistern reaches 16; the oases water their surroundings", () => {
    const { state, grid } = dunesTown();
    const well = placeByWalkway(state, grid, "well", 1)[0];
    const cistern = placeByWalkway(state, grid, "greatCistern", 1)[0];
    expect(well && cistern).toBeTruthy();
    expect(serviceRadius(state, well)).toBe(WELL_RADIUS_DUNES);
    expect(serviceRadius(state, cistern)).toBe(16);
    expect(serviceRadius(newGame(1, 0, "tidewater").state, well)).toBe(BUILDINGS.well.service!.radius);
    advanceCycles(state, grid, 1);
    const oasis = oasisSites(grid.island.noiseSeed)[0];
    const k = (i: number, j: number) => (i + 32) * 64 + (j + 32);
    expect(state.fields.coverage.water[k(Math.floor(oasis.x), Math.floor(oasis.z) + 3)]).toBeGreaterThan(0);
  });
});

describe("the Dunes' weather", () => {
  it("the drought dries the wells, halves the cistern and costs homes without water", () => {
    const { state, grid } = dunesTown();
    const well = placeByWalkway(state, grid, "well", 1)[0];
    const cistern = placeByWalkway(state, grid, "greatCistern", 1)[0];
    placeByWalkway(state, grid, "house", 4);
    fillHomes(state, grid);
    advanceCycles(state, grid, 1);
    biomeOf("dunes").force!.drought(state, grid);
    expect(drought(state.tide.cycle)).toBe(true);
    expect(serviceStrength(state, well)).toBe(0);
    if (cistern.reached && cistern.workers > 0) expect(serviceStrength(state, cistern)).toBeCloseTo(staffing(cistern) * DROUGHT_CISTERN, 6);
    expect(biomeOf("dunes").seasonLabel!(state)).toMatch(/Drought/);
    const home = buildingList(state).find(b => BUILDINGS[b.kind].residents > 0)!;
    state.fields.coverage.water.fill(0);
    expect(biomeOf("dunes").homeHappiness!(state, grid, home)).toBeLessThan(0);
  });
  it("the sandstorm brings no rain and more fire; it silts the harbour until a dredger clears it, or the tide scours it", () => {
    const { state, grid } = dunesTown();
    const st = biomeOf("dunes").storm!;
    expect(st.name).toBe("sandstorm");
    expect(st.rain).toBe(false);
    expect(st.fire!).toBeGreaterThan(1);
    biomeOf("dunes").force!.sandstorm(state, grid);
    expect(silted(state)).toBe(true);
    const pier = buildingList(state).find(b => b.kind === "pier")!;
    expect(biomeOf("dunes").harbourFactor!(state, pier)).toBe(SILT_FACTOR);
    expect(state.log.some(m => /silted/.test(m))).toBe(true);
    // A staffed dredger clears it at the settlement.
    const dredger = { id: -1, kind: "dredger", cells: [], workers: 2, reached: true } as unknown as Building;
    biomeOf("dunes").producers!.dredger!(state, grid, dredger, 1);
    expect(silted(state)).toBe(false);
    // Otherwise the tide scours it in a few cycles.
    state.biomeState.silt = 2;
    for (let k = 0; k < 4 && silted(state); k++) advanceCycles(state, grid, 1);
    expect(silted(state)).toBe(false);
  });
  it("the night market: a clear night with a tavern and a market square doubles what tourists spend", () => {
    const { state, grid, town } = dunesTown();
    placeByWalkway(state, grid, "house", 4);
    fillHomes(state, grid);
    const tavern = placeByWalkway(state, grid, "tavern", 1)[0];
    const square = town.market ? placeJoined(state, grid, "marketSquare", town.market.cells[0]) : null;
    expect(tavern && square).toBeTruthy();
    fillHomes(state, grid);
    biomeOf("dunes").force!.nightMarket(state, grid);
    expect(state.biomeState.nightMarkets ?? 0).toBeGreaterThan(0);
    expect(state.log.some(m => /night market/.test(m))).toBe(true);
    state.biomeState.nightMarket = state.tide.cycle - 1;
    expect(biomeOf("dunes").tourism!(state)).toBe(NIGHT_MARKET_TOURISM);
  });
});
