// The fields: pollution and fish, beaches and sharks.
import { describe, expect, it } from "vitest";
import { tick } from "../src/sim/tick";
import { BEACH_MAX_HEIGHT, FISH_CAP, INJURY_NATURAL_CYCLES, OYSTER_POLLUTION_KILL } from "../src/sim/balance";

import { injuredCount } from "../src/sim/sharks";

import { tryPlace } from "../src/sim/economy";
import { buildFlow, maxOf, meanHeight, stepDrift, zeros } from "../src/sim/fields";
import { cellIndex, Grid } from "../src/sim/grid";

import { newGame } from "../src/sim/start";
import { Building, buildingList, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";

import { beachesNear, growStreet, pierByBeach, pipeTo, placeByWalkway, shelterHarbours, starterTown } from "./scenario";
import { sewerMap } from "../src/sim/sewers";

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

describe("QA regressions (Session B): fields", () => {
  it("#3 pollution never fills past 1: emitters stronger than decay saturate the cell instead of running away", () => {
    // Fuzz seeds 1, 7, 10, 24, 27, 29, 34, 39, 40, 41, 46 around cycle 1900: a big town's outfalls pushed
    // pollution to 1.04 on their cells. Outfalls now stop at full. (Fire risk is not a fraction — a cluster's
    // risk must climb past FIRE_IGNITE_THRESHOLD, 1.0, to ignite — so it is left unbounded, as is shark risk.)
    const { state, grid } = town();
    const k = cellIndex(0, 0);
    state.emitters = [{ k, rate: 0.5 }];
    state.fireEmitters = [{ k, rate: 0.5 }];
    for (let t = 0; t < 400; t++) tick(state, grid);
    expect(state.fields.pollution[k]).toBeLessThanOrEqual(1);
    expect(state.fields.pollution[k]).toBeGreaterThan(0.9);
    expect(maxOf(state.fields.pollution)).toBeLessThanOrEqual(1);
    expect(maxOf(state.fields.fire)).toBeGreaterThan(1);
    // The drift itself: a field full everywhere drains along the flow into sink cells that several neighbours
    // share (fuzz seeds 7, 40, 41 after the emitter cap: 1.04–1.18 at cycle 1300–1950). The step keeps 1 the ceiling.
    state.emitters = [];
    state.fields.pollution.fill(1);
    for (let t = 0; t < 50; t++) tick(state, grid);
    expect(maxOf(state.fields.pollution)).toBeLessThanOrEqual(1);
    expect(maxOf(state.fields.pollution)).toBeGreaterThan(0.9);
  });
});

describe("pollution and fish (M6)", () => {
  it("drifts shoreward on a rising tide and seaward on a falling one", () => {
    const { state, grid } = town();
    const flow = buildFlow(grid);
    const start = { i: 0, j: 12 };
    let c = start;
    for (let k = 0; k < 40 && grid.classAt(c) !== "deep"; k++) c = { i: c.i, j: c.j + 1 };
    expect(grid.classAt(c)).toBe("deep");
    const field = zeros();
    field[cellIndex(c.i, c.j)] = 10;
    const h0 = meanHeight(field, grid);
    for (let k = 0; k < 200; k++) stepDrift(field, flow, 1 / 20, true, 0, 0.05, 0.3);
    const hRise = meanHeight(field, grid);
    expect(hRise).toBeGreaterThan(h0);
    for (let k = 0; k < 400; k++) stepDrift(field, flow, 1 / 20, false, 0, 0.05, 0.3);
    expect(meanHeight(field, grid)).toBeLessThan(hRise);
    void state;
  });

  it("an outfall piped to the street beside an oyster bed kills it within 4 cycles; a treatment plant on the sewer saves it", () => {
    const run = (withPlant: boolean) => {
      const { state, grid, town: t } = town();
      state.resources.money += 3000;
      advanceCycles(state, grid, 2);
      // Oyster bed on a window cell with a deep neighbour; the outfall on that neighbour.
      let bed: Building | null = null, outfall: Building | null = null;
      for (let i = -32; i < 32 && !outfall; i++) for (let j = -32; j < 32 && !outfall; j++) {
        const c = { i, j };
        if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
        const h = grid.heightAt(c);
        if (h < 0 || h > 0.45) continue;
        const deep = grid.neighbors(c).find(n => grid.classAt(n) === "deep" && grid.footprint("outfall", n) && grid.canPlace("outfall", grid.footprint("outfall", n)!));
        if (!deep) continue;
        bed = grid.place("oysterBed", [c]);
        outfall = tryPlace(state, grid, "outfall", deep);
      }
      expect(bed && outfall).toBeTruthy();
      pipeTo(state, grid, outfall!);
      const map = sewerMap(grid);
      const net = map.nets[map.net[cellIndex(outfall!.cells[0].i, outfall!.cells[0].j)]];
      for (const h of t.huts) expect(map.drainOf.get(h.id)).toBe(net);
      if (withPlant) {
        const plant = placeByWalkway(state, grid, "treatmentPlant", 1)[0];
        expect(plant).toBeDefined();
        expect(sewerMap(grid).nets[sewerMap(grid).net[cellIndex(plant.cells[0].i, plant.cells[0].j)]].homes.length).toBeGreaterThan(0);
      }
      let died = -1;
      for (let cycle = 1; cycle <= 6; cycle++) {
        advanceCycles(state, grid, 1);
        if (!state.buildings[bed!.id]) { died = cycle; break; }
      }
      return { died, peak: maxOf(state.fields.pollution), cleaned: buildingList(state).find(b => b.kind === "treatmentPlant")?.output ?? 0 };
    };
    const foul = run(false);
    expect(foul.peak).toBeGreaterThan(OYSTER_POLLUTION_KILL);
    expect(foul.died).toBeGreaterThan(0);
    expect(foul.died).toBeLessThanOrEqual(4);
    const clean = run(true);
    expect(clean.cleaned).toBeGreaterThan(0);
    expect(clean.died).toBe(-1);
  });

  it("boats thin the grounds they fish and the sea recovers when they stop", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 4);
    expect(t.pier.ground).not.toBeNull();
    // Boats move to the richest ground each trip, so look at the thinnest clean deep cell (the outfall's plume
    // lowers the cap of the cells it reaches, which is a different mechanism).
    let k0 = -1, fished = FISH_CAP;
    for (let k = 0; k < state.fields.fish.length; k++) if (grid.deep[k] && state.fields.pollution[k] < 0.01 && state.fields.fish[k] < fished) { fished = state.fields.fish[k]; k0 = k; }
    expect(k0).toBeGreaterThanOrEqual(0);
    expect(fished).toBeLessThan(FISH_CAP - 0.1);
    t.pier.boats = 0;
    advanceCycles(state, grid, 6);
    expect(state.fields.fish[k0]).toBeGreaterThan(fished + 0.05);
  });
});

describe("beaches and sharks (M8)", () => {
  it("derives beaches: sand above the tide line that touches water", () => {
    const { grid } = town();
    let n = 0;
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (!grid.isBeach(c)) continue;
      n++;
      expect(grid.classAt(c)).toBe("high");
      expect(grid.heightAt(c)).toBeLessThanOrEqual(BEACH_MAX_HEIGHT);
      expect(grid.neighbors(c).some(x => grid.classAt(x) !== "high")).toBe(true);
    }
    expect(n).toBeGreaterThan(10);
  });

  it("a beach by a busy pier with no lifeguard sees an incident within 10 cycles; nets and a lifeguard stop it", () => {
    const run = (protect: boolean) => {
      const { state, grid } = town(7);
      state.resources.money += 3000;
      // A bigger town so the beach is busy.
      growStreet(state, grid, 6);
      placeByWalkway(state, grid, "house", 6);
      const beaches = beachesNear(state, grid);
      expect(beaches.length).toBeGreaterThan(0);
      const site = pierByBeach(state, grid);
      expect(site).not.toBeNull();
      shelterHarbours(state, grid);
      if (protect) {
        let nets = 0;
        for (const b of beaches) for (const n of grid.neighbors(b)) {
          if (grid.water[cellIndex(n.i, n.j)] && !grid.buildingAt(n) && tryPlace(state, grid, "sharkNet", n)) nets++;
        }
        const tower = tryPlace(state, grid, "lifeguard", site!.beach) ?? tryPlace(state, grid, "lifeguard", beaches[0]);
        expect(tower).not.toBeNull();
        expect(nets).toBeGreaterThan(0);
      }
      let swimmersSeen = 0;
      for (let c = 0; c < 10; c++) { advanceCycles(state, grid, 1); swimmersSeen += state.swimmers.length; }
      return { incidents: state.incidents, swimmersSeen, injured: injuredCount(state), risk: maxOf(state.fields.shark) };
    };
    const open = run(false);
    expect(open.risk).toBeGreaterThan(0);
    expect(open.incidents).toBeGreaterThanOrEqual(1);
    expect(open.injured).toBeGreaterThanOrEqual(0);
    const safe = run(true);
    expect(safe.incidents).toBe(0);
  });

  it("injured residents stay home until they heal", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 3);
    const home = t.huts.find(h => h.residents > 0)!;
    const before = state.assignments.filter(a => a.home === home.id).reduce((n, a) => n + a.n, 0);
    expect(before).toBeGreaterThan(0);
    home.injured = home.residents;
    advanceCycles(state, grid, 1);
    expect(state.assignments.filter(a => a.home === home.id).reduce((n, a) => n + a.n, 0)).toBe(0);
    state.resources.money += 500;
    placeByWalkway(state, grid, "clinic", 1);
    advanceCycles(state, grid, INJURY_NATURAL_CYCLES + 2);
    expect(home.injured).toBe(0);
  });
});

