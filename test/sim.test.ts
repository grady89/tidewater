// Sim-only unit checks. Nothing here may pull in Babylon; the hygiene test enforces that for src/sim/**.
import { describe, expect, it } from "vitest";
import { HIGH_WATER_MARK, LOW_WATER_MARK, SPRING_HI, SPRING_LO, STILT_LENGTH, TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { BEACH_MAX_HEIGHT, BOAT_COST, BOAT_MIN_RANGE, BOAT_RANGE, BUILDINGS, CAP_BASE, FISH_CAP, HAPPY, INJURY_NATURAL_CYCLES, LEVEL_UP_HAPPINESS, MAX_LEVEL, OYSTER_POLLUTION_KILL, STARTING_MONEY, TREATMENT_RADIUS, TREE_REGROW_CYCLES, WAREHOUSE_CAP } from "../src/sim/balance";
import { addLantern, coverageAt, lanternBlocker } from "../src/sim/services";
import { injuredCount } from "../src/sim/sharks";
import { addCapped, boatPurchaseBlocker, buyBoat, capFor, totalBoats, tryPlace } from "../src/sim/economy";
import { buildFlow, maxOf, meanHeight, stepDrift, zeros } from "../src/sim/fields";
import { cellIndex, Grid } from "../src/sim/grid";
import { updateNetwork } from "../src/sim/network";
import { stateHash } from "../src/sim/save";
import { chooseGround, seaPath } from "../src/sim/sea";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, createState, population, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { floodFate, isRising, phaseProgress, tickTide, tideNormalized } from "../src/sim/tide";
import { grownTreesNear } from "../src/sim/trees";
import { assignWorkers } from "../src/sim/workers";
import { beachesNear, growStreet, pierByBeach, placeByWalkway, placeLumberCamp, placeSecondPier, placeShipyard, reachHill, starterTown } from "./scenario";

const simSources = import.meta.glob("../src/sim/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("sim hygiene", () => {
  it("has sim sources to check", () => {
    expect(Object.keys(simSources).length).toBeGreaterThan(0);
  });
  it("never imports Babylon or the view", () => {
    for (const [file, src] of Object.entries(simSources)) {
      expect(src.includes("@babylonjs"), `${file} imports Babylon`).toBe(false);
      expect(/from "\.\.\/(view|world|build|ui)\//.test(src), `${file} imports outside the sim`).toBe(false);
    }
  });
});

describe("tide clock", () => {
  it("starts at high tide and completes a cycle in TIDE_PERIOD seconds", () => {
    const t = createState().tide;
    expect(t.level).toBeCloseTo(TIDE_HI, 5);
    const dt = 1 / 60;
    let peaks = 0;
    for (let s = 0; s < TIDE_PERIOD * 2.5; s += dt) { tickTide(t, dt); if (t.peaked) peaks++; }
    expect(peaks).toBe(2);
    expect(t.cycle).toBe(2);
  });

  it("reaches low tide half way through the cycle", () => {
    const t = createState().tide;
    const dt = 1 / 60;
    for (let s = 0; s < TIDE_PERIOD / 2; s += dt) tickTide(t, dt);
    expect(t.level).toBeCloseTo(TIDE_LO, 2);
    expect(tideNormalized(t)).toBeCloseTo(0, 2);
    expect(isRising(t)).toBe(true);
  });

  it("runs a spring tide every 4th cycle, continuous with its neighbours", () => {
    const t = createState().tide;
    const dt = 1 / 60;
    let min = Infinity, max = -Infinity, prev = t.level, jump = 0;
    for (let s = 0; s < TIDE_PERIOD * 3; s += dt) { tickTide(t, dt); }
    expect(t.cycle).toBe(3);
    for (let s = 0; s < TIDE_PERIOD; s += dt) {
      tickTide(t, dt);
      min = Math.min(min, t.level); max = Math.max(max, t.level);
      jump = Math.max(jump, Math.abs(t.level - prev)); prev = t.level;
    }
    expect(t.cycle).toBe(4);
    expect(min).toBeCloseTo(SPRING_LO, 2);
    expect(max).toBeCloseTo(SPRING_HI, 2);
    expect(jump).toBeLessThan(0.01);
    // The next ordinary cycle falls from the spring peak to the usual trough and rises to the usual peak.
    min = Infinity; max = -Infinity;
    for (let s = 0; s < TIDE_PERIOD; s += dt) { tickTide(t, dt); min = Math.min(min, t.level); if (s > TIDE_PERIOD / 2) max = Math.max(max, t.level); }
    expect(t.cycle).toBe(5);
    expect(min).toBeCloseTo(TIDE_LO, 2);
    expect(max).toBeCloseTo(TIDE_HI, 2);
  });

  it("wet sand lags the falling water", () => {
    const t = createState().tide;
    for (let i = 0; i < 60 * 10; i++) tickTide(t, 1 / 60);
    expect(t.wetLevel).toBeGreaterThan(t.level);
  });

  it("honours a level override", () => {
    const t = createState().tide;
    t.override = 0.97;
    tickTide(t, 1 / 60);
    expect(t.level).toBe(0.97);
    t.override = null;
    tickTide(t, 1 / 60);
    expect(t.level).toBeLessThan(0.97);
  });
});

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

describe("ledger", () => {
  it("advances deterministically: same script, same hash", () => {
    const run = () => { const t = town(); advanceCycles(t.state, t.grid, 3); return stateHash(t.state); };
    expect(run()).toBe(run());
  });

  it("round-trips through JSON with an identical hash and a working grid", () => {
    const { state, grid } = town(3);
    advanceCycles(state, grid, 1);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    expect(stateHash(copy)).toBe(stateHash(state));
    const grid2 = new Grid(copy);
    expect(grid2.buildingAt(buildingList(copy)[0].cells[0])).not.toBeNull();
    advanceCycles(state, grid, 1);
    advanceCycles(copy, grid2, 1);
    expect(stateHash(copy)).toBe(stateHash(state));
  });
});

describe("money loop (M2)", () => {
  it("the starter town is affordable from the 500$ start and is fully connected", () => {
    const { state, grid, town: t } = town();
    expect(t.huts.length).toBe(3);
    expect(t.market).not.toBeNull();
    expect(t.pier.boats).toBe(2);
    expect(state.resources.money).toBeGreaterThanOrEqual(0);
    expect(state.resources.money).toBeLessThan(STARTING_MONEY - BUILDINGS.pier.cost.money - 2 * BOAT_COST);
    state.tide.override = TIDE_HI;
    tick(state, grid);
    expect(t.huts.every(h => h.reached)).toBe(true);
    expect(t.market!.reached).toBe(true);
  });

  it("makes positive net money over 4 cycles, with residents arriving and boats landing fish", () => {
    const { state, grid } = town();
    const start = state.resources.money;
    advanceCycles(state, grid, 4);
    expect(population(state)).toBeGreaterThan(0);
    expect(state.last.fishCaught).toBeGreaterThan(0);
    expect(state.last.fishSold).toBeGreaterThan(0);
    expect(state.resources.money).toBeGreaterThan(start);
  });

  it("stops selling when the walkway to the market is removed", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 4);
    expect(state.last.fishSold).toBeGreaterThan(0);
    const market = t.market!;
    for (const c of market.cells) for (const n of grid.neighbors(c)) {
      const b = grid.buildingAt(n);
      if (b && (b.kind === "walkway" || b.kind === "raisedWalkway")) grid.remove(b);
    }
    advanceCycles(state, grid, 1);
    expect(market.reached).toBe(false);
    expect(state.last.fishSold).toBe(0);
    expect(state.resources.fish).toBeGreaterThan(0);
  });

  it("only sells the first two boats, and only at a pier with room", () => {
    const { state, town: t } = town();
    state.resources.money += 1000;
    expect(boatPurchaseBlocker(state, t.pier)).not.toBeNull();
    expect(buyBoat(state, t.pier)).toBe(false);
    expect(boatPurchaseBlocker(state, t.huts[0])).not.toBeNull();
  });
});

describe("the sea (M4 sim side)", () => {
  it("chooses a deep ground within boat range and finds a deep-water path to it", () => {
    const { state, grid, town: t } = town();
    const ground = chooseGround(grid, t.pier, state.fields.fish)!;
    expect(ground).not.toBeNull();
    expect(grid.classAt(ground)).toBe("deep");
    const path = seaPath(grid, t.pier, ground);
    expect(path.length).toBeGreaterThanOrEqual(BOAT_MIN_RANGE);
    expect(path.length).toBeLessThanOrEqual(BOAT_RANGE + 1);
    for (let k = 1; k < path.length; k++) {
      expect(Math.abs(path[k].i - path[k - 1].i) + Math.abs(path[k].j - path[k - 1].j)).toBe(1);
      expect(grid.classAt(path[k])).toBe("deep");
    }
    expect(path[path.length - 1]).toEqual(ground);
    advanceCycles(state, grid, 2);
    expect(t.pier.ground).not.toBeNull();
  });

  it("phase progress runs 0→1 across a shift and is ½ at the extremes", () => {
    const t = createState().tide;
    expect(phaseProgress(t, HIGH_WATER_MARK, LOW_WATER_MARK)).toBeCloseTo(0.5, 1);
    const dt = 1 / 60;
    let entered: number | null = null, last = 0;
    for (let s = 0; s < TIDE_PERIOD; s += dt) {
      tickTide(t, dt);
      const p = phaseProgress(t, HIGH_WATER_MARK, LOW_WATER_MARK);
      if (t.level < LOW_WATER_MARK) { if (entered === null) entered = p; last = p; }
    }
    expect(entered!).toBeLessThan(0.05);
    expect(last).toBeGreaterThan(0.95);
    for (let s = 0; s < TIDE_PERIOD / 2; s += dt) tickTide(t, dt);
    expect(phaseProgress(t, HIGH_WATER_MARK, LOW_WATER_MARK)).toBeCloseTo(0.5, 1);
  });
});

describe("production chain (M5)", () => {
  it("caps stockpiles at the base and raises the cap per warehouse", () => {
    const { state, grid } = town();
    state.resources.fish = 95;
    expect(addCapped(state, "fish", 20)).toBe(5);
    expect(state.resources.fish).toBe(CAP_BASE.fish);
    state.resources.money += 600;
    growStreet(state, grid, 4);
    expect(placeByWalkway(state, grid, "warehouse", 1).length).toBe(1);
    expect(capFor(state, "fish")).toBe(CAP_BASE.fish + WAREHOUSE_CAP);
    expect(addCapped(state, "fish", 20)).toBe(20);
  });

  it("locks the tall house behind a sawmill and the lumber camp behind a walkway on the flats", () => {
    const { state, grid } = town();
    state.resources.money += 2000; state.resources.planks += 50;
    expect(placeByWalkway(state, grid, "tallHouse", 1).length).toBe(0);
    let highCell: Cell | null = null;
    for (let i = -32; i < 32 && !highCell; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "high" && grid.footprint("lumberCamp", c)?.every(x => grid.classAt(x) === "high" && !grid.buildingAt(x))) { highCell = c; break; }
    }
    expect(highCell).not.toBeNull();
    expect(grid.canPlace("lumberCamp", grid.footprint("lumberCamp", highCell!)!)).toBe(false); // no walkway touches it
  });

  it("fells trees near a lumber camp, mills planks, and launches a shipyard boat within 12 cycles", () => {
    const { state, grid, town: t } = town();
    state.resources.money += 3000;
    const end = reachHill(state, grid);
    expect(end).not.toBeNull();
    const camp = placeLumberCamp(state, grid, end!);
    expect(camp).not.toBeNull();
    const mill = placeByWalkway(state, grid, "sawmill", 1)[0];
    expect(mill).toBeDefined();
    expect(growStreet(state, grid, 6)).toBeGreaterThan(0);
    expect(placeByWalkway(state, grid, "house", 6).length).toBeGreaterThanOrEqual(4);
    expect(placeSecondPier(state, grid, t.pier.cells[0])).not.toBeNull(); // a berth for the boat to come
    const treesBefore = grownTreesNear(state, camp!.cells);
    expect(treesBefore).toBeGreaterThan(0);

    const boatsBefore = totalBoats(state);
    let yard: Building | null = null, launched = -1;
    for (let cycle = 1; cycle <= 12; cycle++) {
      advanceCycles(state, grid, 1);
      if (!yard && state.resources.planks >= BUILDINGS.shipyard.cost.planks!) { yard = placeShipyard(state, grid, t.pier.cells[0]); expect(yard).not.toBeNull(); }
      if (totalBoats(state) > boatsBefore) { launched = cycle; break; }
    }
    expect(yard).not.toBeNull();
    expect(launched).toBeGreaterThan(0);
    expect(launched).toBeLessThanOrEqual(12);
    expect(grownTreesNear(state, camp!.cells)).toBeLessThan(treesBefore);

    // Stop felling: the wood comes back.
    const felledCount = grownTreesNear(state, camp!.cells);
    grid.remove(camp!);
    advanceCycles(state, grid, TREE_REGROW_CYCLES + 1);
    expect(grownTreesNear(state, camp!.cells)).toBeGreaterThan(felledCount);
    expect(grownTreesNear(state, camp!.cells)).toBe(treesBefore);
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

  it("an outfall beside an oyster bed kills it within 4 cycles; a treatment plant saves it", () => {
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
      if (withPlant) {
        const plant = placeByWalkway(state, grid, "treatmentPlant", 1)[0];
        expect(plant).toBeDefined();
        for (const h of t.huts) expect(h.cells.some(c => Math.abs(c.i - plant.cells[0].i) <= TREATMENT_RADIUS && Math.abs(c.j - plant.cells[0].j) <= TREATMENT_RADIUS)).toBe(true);
        t.pier.boats = 0; // free the hands for the plant
      }
      let died = -1;
      for (let cycle = 1; cycle <= 6; cycle++) {
        advanceCycles(state, grid, 1);
        if (!state.buildings[bed!.id]) { died = cycle; break; }
      }
      return { died, peak: maxOf(state.fields.pollution), plantStaff: buildingList(state).find(b => b.kind === "treatmentPlant")?.workers ?? 0 };
    };
    const foul = run(false);
    expect(foul.peak).toBeGreaterThan(OYSTER_POLLUTION_KILL);
    expect(foul.died).toBeGreaterThan(0);
    expect(foul.died).toBeLessThanOrEqual(4);
    const clean = run(true);
    expect(clean.plantStaff).toBeGreaterThan(0);
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

describe("happiness, services, leveling (M7)", () => {
  /** Starter town with every service a home can want. */
  function servedTown() {
    const { state, grid, town: t } = town();
    state.resources.money += 2000;
    growStreet(state, grid, 4);
    const well = placeByWalkway(state, grid, "well", 1)[0];
    const shrine = placeByWalkway(state, grid, "shrine", 1)[0];
    expect(well && shrine).toBeTruthy();
    let lanterns = 0;
    for (const w of buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway")) if (addLantern(state, grid, w.cells[0])) lanterns++;
    expect(lanterns).toBeGreaterThan(0);
    return { state, grid, t, well };
  }

  it("a home with every coverage reaches level 3 within 8 cycles", () => {
    const { state, grid, t } = servedTown();
    advanceCycles(state, grid, 8);
    const levels = t.huts.map(h => h.level);
    expect(Math.max(...levels)).toBe(MAX_LEVEL);
    const best = t.huts.find(h => h.level === MAX_LEVEL)!;
    expect(grid.capacityOf(best)).toBe(BUILDINGS.hut.residents + MAX_LEVEL - 1);
    expect(best.happiness).toBeGreaterThanOrEqual(LEVEL_UP_HAPPINESS);
    expect(state.log.some(m => /level 3/.test(m))).toBe(true);
  });

  it("removing the well drops happiness", () => {
    const { state, grid, well } = servedTown();
    advanceCycles(state, grid, 4);
    const before = state.happiness;
    expect(before).toBeGreaterThan(0.8);
    grid.remove(well);
    advanceCycles(state, grid, 1);
    expect(state.happiness).toBeLessThan(before - HAPPY.water * 0.9);
  });

  it("lantern posts stand only on walkways and light the night layer", () => {
    const { state, grid, town: t } = town();
    state.resources.money += 100;
    expect(lanternBlocker(state, grid, t.huts[0].cells[0])).not.toBeNull();
    const w = buildingList(state).find(b => b.kind === "walkway" || b.kind === "raisedWalkway")!;
    expect(addLantern(state, grid, w.cells[0])).toBe(true);
    expect(addLantern(state, grid, w.cells[0])).toBe(false);
    advanceCycles(state, grid, 1);
    expect(coverageAt(state, "night", w.cells[0])).toBe(1);
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

/** A flat cell with terrain in [lo, hi] not yet built on, nearest to `near`. */
function flatCellWithHeight(grid: Grid, lo: number, hi: number, near: Cell): Cell | null {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
    const h = grid.heightAt(c);
    if (h < lo || h > hi) continue;
    const d = Math.hypot(i - near.i, j - near.j);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

describe("tide splits the economy (M3)", () => {
  it("standard walkways stand STILT_LENGTH above their cell; low ones flood at spring high, not at ordinary high", () => {
    const { state, grid, town: t } = town();
    const cell = flatCellWithHeight(grid, 0.12, 0.33, t.pier.cells[0]);
    expect(cell).not.toBeNull();
    const w = grid.place("walkway", [cell!]);
    expect(w.floorY).toBeCloseTo(grid.heightAt(cell!) + STILT_LENGTH, 6);
    expect(floodFate(w.floorY)).toBe("spring");
    state.tide.override = TIDE_HI; tick(state, grid);
    expect(w.cut).toBe(false);
    state.tide.override = SPRING_HI; tick(state, grid);
    expect(w.cut).toBe(true);
  });

  it("workers beyond a flooded walkway don't count for that shift", () => {
    const { state, grid, town: t } = town();
    advanceCycles(state, grid, 3);
    expect(population(state)).toBeGreaterThan(0);
    // Sink every link to spring-flood height, as if the whole street stood on terrain 0.2.
    const links = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
    for (const l of links) l.floorY = 0.7;
    updateNetwork(state, grid, TIDE_HI);
    assignWorkers(state, grid);
    const workersAtOrdinaryHigh = t.pier.workers;
    expect(workersAtOrdinaryHigh).toBeGreaterThan(0);
    updateNetwork(state, grid, SPRING_HI);
    assignWorkers(state, grid);
    expect(links.every(l => l.cut)).toBe(true);
    // Only homes touching the pier itself can still reach it.
    const pierCells = new Set(t.pier.cells.map(c => c.i + "," + c.j));
    const touching = t.huts.filter(h => h.cells.some(c => grid.neighbors(c).some(n => pierCells.has(n.i + "," + n.j))));
    const reachable = touching.reduce((n, h) => n + h.residents, 0);
    expect(t.pier.workers).toBeLessThanOrEqual(reachable);
    expect(t.pier.workers).toBeLessThan(workersAtOrdinaryHigh);
    for (const h of t.huts) if (!touching.includes(h)) expect(h.reached).toBe(false);
  });

  it("oyster beds produce shellfish only when a low-water shift ends", () => {
    const { state, grid } = town();
    state.resources.money += 400;
    advanceCycles(state, grid, 2);
    // Put the bed on the flats next to the street, in the oyster window; grow the street toward the water if needed.
    let bed: Building | null = placeByWalkway(state, grid, "oysterBed", 1)[0] ?? null;
    for (let k = 0; k < 8 && !bed; k++) { growStreet(state, grid, 1); bed = placeByWalkway(state, grid, "oysterBed", 1)[0] ?? null; }
    expect(bed).not.toBeNull();
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    advanceCycles(state, grid, 1);
    expect(bed!.reached).toBe(true);
    expect(bed!.workers).toBeGreaterThan(0);

    let prevPhase = state.phase, prevShell = state.resources.shellfish, gained = 0;
    const cycleTicks = Math.round(TIDE_PERIOD * 20);
    for (let k = 0; k < cycleTicks; k++) {
      tick(state, grid);
      const d = state.resources.shellfish - prevShell;
      if (d > 0) { expect(prevPhase).toBe("low"); gained += d; }
      prevPhase = state.phase; prevShell = state.resources.shellfish;
    }
    expect(gained).toBeGreaterThan(0);
  });

  it("pier boats stay in at low water; deep-dock boats sail on both tides", () => {
    const { state, grid, town: t } = town();
    state.resources.money += 500; state.resources.planks += 20;
    advanceCycles(state, grid, 2);
    // A dock touching the pier so its crew can reach it over the pier's own planks.
    let dock = null;
    for (const pc of t.pier.cells) for (const n of grid.neighbors(pc)) {
      for (let di = 0; di < 2 && !dock; di++) for (let dj = 0; dj < 2 && !dock; dj++) dock = tryPlace(state, grid, "dock", { i: n.i - di, j: n.j - dj });
      if (dock) break;
    }
    expect(dock).not.toBeNull();
    dock!.boats = 2;
    t.pier.boats = 1;
    advanceCycles(state, grid, 1);
    expect(dock!.workers).toBeGreaterThan(0);
    const seen = { pierLow: false, dockLow: false, pierHigh: false, dockHigh: false };
    for (let k = 0; k < TIDE_PERIOD * 20; k++) {
      tick(state, grid);
      if (state.phase === "low") { seen.pierLow ||= t.pier.atSea; seen.dockLow ||= dock!.atSea; }
      if (state.phase === "high") { seen.pierHigh ||= t.pier.atSea; seen.dockHigh ||= dock!.atSea; }
    }
    expect(seen).toEqual({ pierLow: false, dockLow: true, pierHigh: true, dockHigh: true });
  });
});
