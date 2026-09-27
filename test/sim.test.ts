// Sim-only unit checks. Nothing here may pull in Babylon; the hygiene test enforces that for src/sim/**.
import { describe, expect, it } from "vitest";
import { CLEARANCE, DRY_TERRAIN, HIGH_WATER_MARK, LOW_WATER_MARK, SPRING_FLOOD_TERRAIN, SPRING_HI, SPRING_LO, STILT_MIN, TIDE_HI, TIDE_LO, TIDE_PERIOD, WALKWAY_SNAP } from "../src/config";
import { BEACH_MAX_HEIGHT, BOAT_COST, BOAT_MIN_RANGE, BOAT_RANGE, BUILDINGS, CAP_BASE, DRAWDOWN_LEVEL, DRAWDOWN_SECONDS, FIRE_BURN_SECONDS, FIRE_IGNITE_THRESHOLD, FISH_CAP, HAPPY, INJURY_NATURAL_CYCLES, LEVEL_UP_HAPPINESS, MAX_LEVEL, OYSTER_POLLUTION_KILL, CLEAR_TIMBER, LANDFILL_COST, LANDFILL_HEIGHT, LIFT_MAX, LIFT_STEP, LOAN_AMOUNT, LOAN_INTEREST, LOAN_REPAY_CYCLES, PLANK_ORDER_SIZE, REMOVE_REFUND, STARTING_MONEY, STILT_COST_PER_UNIT, WAVE_HEIGHT, TRADE_EVERY, TRADE_EVERY_LIGHTHOUSE, TREATMENT_RADIUS, TREE_REGROW_CYCLES, WAREHOUSE_CAP } from "../src/sim/balance";
import { ACHIEVEMENTS, checkAchievements } from "../src/sim/achievements";
import { deserialize, serialize } from "../src/sim/save";
import { DISTRICT_MIN, districtName, districtOf, districts } from "../src/sim/districts";
import { addLandfill, clearBlocker, clearTree, landfillBlocker, plantBlocker, plantTree, treeAt } from "../src/sim/land";
import { dayFraction, duskAt, isDaytime, moonVector, NOON_SUN, sunVector } from "../src/sim/daylight";
import { canBorrow, loanInstalment, takeLoan } from "../src/sim/loan";
import { DAY_CYCLES } from "../src/config";
import { ISLE } from "../src/sim/isle";
import { startCell, suggestPier } from "../src/sim/start";
import { TREE_SITES } from "../src/sim/trees";
import { rollTsunami, sheltered, shielded, startStorm, startTsunami, tsunamiDue, warnTsunami, waveDirection } from "../src/sim/events";
import { ignite, repairDamage } from "../src/sim/fire";
import { addLantern, coverageAt, lanternBlocker } from "../src/sim/services";
import { injuredCount } from "../src/sim/sharks";
import { orderPlanks } from "../src/sim/trade";
import { addCapped, boatPurchaseBlocker, buyBoat, capFor, placeCost, removeBuilding, totalBoats, tryPlace } from "../src/sim/economy";
import { buildFlow, maxOf, meanHeight, stepDrift, zeros } from "../src/sim/fields";
import { cellIndex, Grid } from "../src/sim/grid";
import { updateNetwork } from "../src/sim/network";
import { stateHash } from "../src/sim/save";
import { chooseGround, seaEntry, seaPath } from "../src/sim/sea";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, createState, population, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { floodFate, isRising, phaseProgress, tickTide, tideNormalized } from "../src/sim/tide";
import { grownTreesNear } from "../src/sim/trees";
import { assignWorkers } from "../src/sim/workers";
import { STEPS } from "../src/ui/tutorial";
import { beachesNear, bigTown, growStreet, pierByBeach, placeByWalkway, placeEdge, placeHarbor, placeLumberCamp, placeSecondPier, placeShipyard, reachHill, settleIsle, shelterHarbours, starterTown } from "./scenario";

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

  it("rejects saves from older builds that lack fields the ledger has now", () => {
    const { state } = town();
    expect(deserialize(serialize(state)).tide.cycle).toBe(state.tide.cycle);
    const noStorm = JSON.parse(serialize(state)) as Partial<SimState>;
    delete noStorm.storm;
    expect(() => deserialize(JSON.stringify(noStorm))).toThrow(/storm/);
    const noFire = JSON.parse(serialize(state)) as SimState;
    delete (noFire.fields as Partial<SimState["fields"]>).fire;
    expect(() => deserialize(JSON.stringify(noFire))).toThrow(/fields\.fire/);
    expect(() => deserialize(JSON.stringify({ version: 1 }))).toThrow(/version/);
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
    shelterHarbours(state, grid); // storms mustn't sink the count we're watching
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

describe("trade and tourism (M9)", () => {
  function port() {
    const { state, grid, town: t } = town();
    state.resources.money += 5000; state.resources.planks += 200;
    growStreet(state, grid, 6);
    const harbor = placeHarbor(state, grid, t.pier.cells[0]);
    expect(harbor).not.toBeNull();
    for (const c of harbor!.cells) expect(grid.heightAt(c)).toBeLessThan(-1.5);
    const inn = placeByWalkway(state, grid, "inn", 1)[0];
    expect(inn).toBeDefined();
    return { state, grid, t, harbor: harbor!, inn };
  }

  it("the harbor needs water deeper than 1.5 and the ship has a way in from the open sea", () => {
    const { state, grid, harbor } = port();
    let shallow: Cell | null = null;
    for (let i = -32; i < 32 && !shallow; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "deep" && grid.heightAt(c) > -1.2) { shallow = c; break; }
    }
    expect(shallow).not.toBeNull();
    expect(grid.canPlace("harbor", grid.footprint("harbor", shallow!)!)).toBe(false);
    const entry = seaEntry(grid, harbor);
    expect(entry).not.toBeNull();
    expect(seaPath(grid, harbor, entry!, 128).length).toBeGreaterThan(3);
    expect(state.trade.nextVisit).toBe(-1);
  });

  it("with a harbor and an inn, tourists arrive and spend over 6 cycles", () => {
    const { state, grid } = port();
    advanceCycles(state, grid, 1);
    expect(state.trade.nextVisit).toBeGreaterThan(0);
    let tourism = 0, visits = 0, seenTourists = 0;
    for (let c = 0; c < 6; c++) {
      advanceCycles(state, grid, 1);
      tourism += state.last.tourism;
      visits = state.trade.visits;
      seenTourists = Math.max(seenTourists, state.tourists);
    }
    expect(visits).toBeGreaterThanOrEqual(1);
    expect(seenTourists).toBeGreaterThan(0);
    expect(tourism).toBeGreaterThan(0);
    expect(state.trade.nextVisit - state.trade.shipCycle).toBe(TRADE_EVERY);
  });

  it("delivers ordered planks for money, and a lighthouse makes the ship call more often", () => {
    const { state, grid } = port();
    advanceCycles(state, grid, 1);
    state.resources.planks = 0;
    const money = state.resources.money;
    orderPlanks(state);
    const visit = state.trade.nextVisit;
    advanceCycles(state, grid, visit - state.tide.cycle);
    expect(state.trade.visits).toBe(1);
    expect(state.resources.planks).toBeGreaterThanOrEqual(PLANK_ORDER_SIZE);
    expect(state.last.trade).toBeLessThan(0);
    expect(state.resources.money).toBeLessThan(money + state.last.income); // the planks were paid for
    expect(state.trade.plankOrder).toBe(0);
    // Lighthouse: the interval drops to 2.
    let placed: Building | null = null;
    for (let i = -32; i < 32 && !placed; i++) for (let j = -32; j < 32 && !placed; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "high" && grid.touchesWalkway([c])) placed = tryPlace(state, grid, "lighthouse", c);
    }
    if (!placed) placed = placeEdge(state, grid, "lighthouse", state.buildings[1].cells[0]);
    expect(placed).not.toBeNull();
    advanceCycles(state, grid, state.trade.nextVisit - state.tide.cycle);
    expect(state.trade.visits).toBe(2);
    expect(state.trade.nextVisit - state.trade.shipCycle).toBe(TRADE_EVERY_LIGHTHOUSE);
  });
});

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

describe("tutorial and big town (M12)", () => {
  it("the tutorial steps clear in order as the starter town takes shape", () => {
    const { state, grid } = newGame(7);
    expect(STEPS.map(s => s.done(state))).toEqual([false, false, false, false, false, false]);
    starterTown(state, grid);
    expect(STEPS.slice(0, 5).map(s => s.done(state))).toEqual([true, true, false, true, true]);
    advanceCycles(state, grid, 1);
    expect(STEPS[2].done(state)).toBe(true);
    advanceCycles(state, grid, 3);
    expect(STEPS[5].done(state)).toBe(true);
    for (const s of STEPS) expect(s.title.length).toBeGreaterThan(0);
  });

  it("the big-town script reaches 300 buildings and 30 boats and still settles a cycle", () => {
    const { state, grid } = town(9);
    const built = bigTown(state, grid);
    expect(built.buildings).toBeGreaterThanOrEqual(300);
    expect(built.boats).toBeGreaterThanOrEqual(30);
    expect(built.residents).toBeGreaterThanOrEqual(200);
    advanceCycles(state, grid, 1);
    expect(state.assignments.reduce((n, a) => n + a.n, 0)).toBeGreaterThan(100);
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

describe("districts (backlog 5)", () => {
  it("the starter town is one named district that every connected building shares", () => {
    const { state, grid, town: t } = town();
    const all = districts(state, grid);
    expect(all.length).toBe(1);
    const d = all[0];
    expect(d.buildings).toBeGreaterThanOrEqual(DISTRICT_MIN);
    expect(d.ids).toContain(t.pier.id);
    expect(d.ids).toContain(t.market!.id);
    for (const h of t.huts) expect(d.ids).toContain(h.id);
    expect(d.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(districtOf(grid, t.market!)?.name).toBe(d.name);
    expect(districtOf(grid, t.huts[0])?.name).toBe(d.name);
  });
  it("the name is the oldest building's and survives a save; small clusters are outlying", () => {
    const { state, grid } = town();
    const d = districts(state, grid)[0];
    expect(d.name).toBe(districtName(Math.min(...d.ids)));
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    const g2 = new Grid(copy);
    expect(districts(copy, g2)[0].name).toBe(d.name);
    // A lone breakwater off the pier is no district.
    state.resources.money += 1000; state.resources.planks += 10;
    let lone: Building | null = null;
    for (let i = -30; i < 30 && !lone; i++) for (let j = -30; j < 30 && !lone; j++) {
      const c = { i, j };
      if (grid.buildingAt(c) || grid.neighbors(c).some(n => grid.buildingAt(n))) continue;
      lone = tryPlace(state, grid, "breakwater", c);
    }
    expect(lone).not.toBeNull();
    expect(districtOf(grid, lone!)).toBeNull();
    expect(districts(state, grid).length).toBe(1);
  });
  it("stats add up over the members", () => {
    const { state, grid } = town();
    advanceCycles(state, grid, 3);
    const d = districts(state, grid)[0];
    let residents = 0, workers = 0;
    for (const id of d.ids) { residents += state.buildings[id].residents; workers += state.buildings[id].workers; }
    expect(d.residents).toBe(residents);
    expect(d.workers).toBe(workers);
    expect(d.residents).toBeGreaterThan(0);
    expect(d.happiness).toBeGreaterThan(0);
    expect(d.happiness).toBeLessThanOrEqual(1);
  });
});

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
    for (const s of TREE_SITES) expect(Math.hypot(s.x - ISLE.x, s.z - ISLE.z)).toBeGreaterThan(ISLE.r);
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
});

describe("achievements (backlog 7)", () => {
  it("a fresh town has none; the first boat and the first catch come in order, once", () => {
    const { state, grid } = newGame(1);
    expect(state.achievements).toEqual([]);
    expect(checkAchievements(state, grid)).toEqual([]);
    const { state: s, grid: g } = town();
    expect(checkAchievements(s, g)).toEqual(["firstBoat"]);
    expect(checkAchievements(s, g)).toEqual([]);
    advanceCycles(s, g, 4); // the boats' first landing settles on the third peak
    checkAchievements(s, g); // the peak tick need not be one of the once-a-second checks
    expect(s.achievements.slice(0, 2)).toEqual(["firstBoat", "firstCatch"]);
    expect(s.log.some(m => m.startsWith("★ First boat"))).toBe(true);
    expect(new Set(s.achievements).size).toBe(s.achievements.length);
  });
  it("a big town earns fifty residents and the isle; a save keeps the list and an old save gets an empty one", () => {
    const { state, grid, town: t } = town();
    bigTown(state, grid);
    state.resources.money += 5000; state.resources.planks += 200;
    placeHarbor(state, grid, t.pier.cells[0]);
    settleIsle(state, grid);
    advanceCycles(state, grid, 3);
    checkAchievements(state, grid);
    expect(state.achievements).toContain("fifty");
    expect(state.achievements).toContain("isle");
    expect(deserialize(serialize(state)).achievements).toEqual(state.achievements);
    const old = JSON.parse(serialize(state)) as Partial<SimState>;
    delete old.achievements;
    expect(deserialize(JSON.stringify(old)).achievements).toEqual([]);
    for (const a of ACHIEVEMENTS) expect(a.title.length).toBeGreaterThan(0);
  });
});

describe("placement (streets, docks, refunds)", () => {
  it("an auto-sized walkway rises to meet a neighbouring deck within WALKWAY_SNAP, not beyond, never below its safe height", () => {
    const { grid } = newGame(1);
    // Two free flat cells side by side, away from the start hut.
    let a: Cell | null = null;
    for (let i = -30; i < 30 && !a; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j }, n = { i: i + 1, j };
      if (grid.classAt(c) === "flat" && grid.classAt(n) === "flat" && !grid.buildingAt(c) && !grid.buildingAt(n) && !grid.touchesLink([c]) && !grid.touchesLink([n])) { a = c; break; }
    }
    expect(a).not.toBeNull();
    const n = { i: a!.i + 1, j: a!.j };
    const safe = Math.max(grid.heightAt(n) + STILT_MIN, TIDE_HI + CLEARANCE);
    const high = grid.place("walkway", [a!]);
    high.floorY = safe + WALKWAY_SNAP - 0.05;
    expect(grid.floorFor("walkway", [n])).toBeCloseTo(high.floorY, 6);
    high.floorY = safe + WALKWAY_SNAP + 0.05;
    expect(grid.floorFor("walkway", [n])).toBeCloseTo(safe, 6);
    high.floorY = safe - 0.2;
    expect(grid.floorFor("walkway", [n])).toBeCloseTo(safe, 6);
  });
  it("a deep dock must touch a pier or raised walkway; a raised walkway bridges deep water to it", () => {
    const { state, grid, town: t } = town();
    state.resources.money += 2000; state.resources.planks += 100;
    // Deep cells two out from the pier's seaward end: nothing links there yet.
    const tip = t.pier.cells[t.pier.cells.length - 1], root = t.pier.cells[0];
    const dir = { i: tip.i - root.i, j: tip.j - root.j };
    const far = { i: tip.i + dir.i * 2, j: tip.j + dir.j * 2 };
    if (grid.classAt(far) === "deep" && grid.footprint("dock", far) && grid.classOk("deep", grid.footprint("dock", far)!)) {
      expect(grid.touchesLink(grid.footprint("dock", far)!)).toBe(false);
      expect(tryPlace(state, grid, "dock", far)).toBeNull();
      const bridge = tryPlace(state, grid, "raisedWalkway", { i: tip.i + dir.i, j: tip.j + dir.j });
      expect(bridge).not.toBeNull();
      expect(tryPlace(state, grid, "dock", far)).not.toBeNull();
    }
    // And the plain case: a dock alongside the pier itself.
    let dock = null;
    for (const pc of t.pier.cells) for (const n of grid.neighbors(pc)) {
      for (let di = 0; di < 2 && !dock; di++) for (let dj = 0; dj < 2 && !dock; dj++) dock = tryPlace(state, grid, "dock", { i: n.i - di, j: n.j - dj });
      if (dock) break;
    }
    expect(dock).not.toBeNull();
  });
  it("a lift raises an auto-sized deck by LIFT_STEP a step, never below its safe height, and the extra stilts are priced", () => {
    const { state, grid } = newGame(1);
    state.resources.money += 1000;
    let a: Cell | null = null;
    for (let i = -30; i < 30 && !a; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "flat" && !grid.buildingAt(c) && !grid.neighbors(c).some(n => grid.buildingAt(n))) { a = c; break; }
    }
    const safe = Math.max(grid.heightAt(a!) + STILT_MIN, TIDE_HI + CLEARANCE);
    const before = state.resources.money;
    const w = tryPlace(state, grid, "walkway", a!, 2);
    expect(w!.floorY).toBeCloseTo(safe + 2 * LIFT_STEP, 6);
    const stilt = w!.floorY - grid.heightAt(a!);
    expect(before - state.resources.money).toBe(Math.round(BUILDINGS.walkway.cost.money + STILT_COST_PER_UNIT * stilt));
    expect(grid.floorFor("walkway", [a!], -5)).toBeGreaterThanOrEqual(safe - 1e-9); // a negative lift is no lift
    expect(grid.floorFor("walkway", [a!], 99)).toBeCloseTo(safe + LIFT_MAX * LIFT_STEP, 6);
    expect(placeCost("pier", 3)).toEqual(BUILDINGS.pier.cost); // fixed floors price no stilts
    expect(placeCost("hut", 1).money).toBe(BUILDINGS.hut.cost.money + STILT_COST_PER_UNIT);
  });
  it("every standard piece clears the tides it must: walkways the ordinary high, buildings the spring peak; only a low walkway floods, at spring", () => {
    const { grid } = newGame(1);
    const flats: Cell[] = [];
    for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) { const c = { i, j }; if (grid.classAt(c) === "flat" && !grid.buildingAt(c) && !grid.neighbors(c).some(n => grid.buildingAt(n))) flats.push(c); }
    const low = flats.filter(c => grid.heightAt(c) < SPRING_FLOOD_TERRAIN - 0.05);
    const mid = flats.filter(c => grid.heightAt(c) > SPRING_FLOOD_TERRAIN + 0.02);
    expect(low.length).toBeGreaterThan(10);
    expect(mid.length).toBeGreaterThan(10);
    for (const c of [...low.slice(0, 20), ...mid.slice(0, 20)]) {
      const w = grid.floorFor("walkway", [c]);
      expect(w).toBeGreaterThanOrEqual(grid.heightAt(c) + STILT_MIN - 1e-9);
      expect(w).toBeGreaterThan(TIDE_HI);               // never under an ordinary high tide
      expect(floodFate(w)).not.toBe("always");
      for (const kind of ["hut", "house", "market", "smokehouse", "well", "oysterBed"] as const) {
        const fp = grid.footprint(kind, c);
        if (!fp) continue;
        const f = grid.floorFor(kind, fp);
        expect(f).toBeGreaterThanOrEqual(SPRING_HI + CLEARANCE - 1e-9); // buildings clear the spring peak
        expect(floodFate(f)).toBe("safe");
      }
    }
    for (const c of low.slice(0, 20)) expect(floodFate(grid.floorFor("walkway", [c]))).toBe("spring");
    for (const c of mid.slice(0, 20)) expect(floodFate(grid.floorFor("walkway", [c]))).toBe("safe");
    expect(SPRING_FLOOD_TERRAIN).toBeCloseTo(SPRING_HI - STILT_MIN, 9);
    expect(WAVE_HEIGHT).toBeGreaterThan(SPRING_HI + CLEARANCE);
  });
  it("stilts are priced by length: the same hut costs more on low ground than on high flats", () => {
    const { grid } = newGame(1);
    let lo: Cell | null = null, hi: Cell | null = null;
    for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
      if (!lo && grid.heightAt(c) < 0) lo = c;
      if (!hi && grid.heightAt(c) > 0.45) hi = c;
    }
    expect(lo && hi).toBeTruthy();
    const cost = (c: Cell) => placeCost("hut", grid.stiltLength("hut", [c], grid.floorFor("hut", [c]))).money;
    expect(cost(lo!)).toBeGreaterThan(cost(hi!));
    expect(cost(hi!)).toBeGreaterThanOrEqual(BUILDINGS.hut.cost.money + STILT_COST_PER_UNIT * STILT_MIN - 1);
    // A standard walkway on the lowest flats still undercuts the fixed-price raised walkway.
    const lowest = Math.min(...Array.from({ length: 60 * 60 }, (_, k) => grid.heightAt({ i: (k % 60) - 30, j: Math.floor(k / 60) - 30 })).filter(h => h >= TIDE_LO));
    const worst = placeCost("walkway", TIDE_HI + CLEARANCE - lowest).money;
    expect(worst).toBeLessThan(BUILDINGS.raisedWalkway.cost.money);
  });
  it("streets: walkways may cross the beach band below DRY_TERRAIN, paths only dry ground above it", () => {
    const { grid } = newGame(1);
    let beach: Cell | null = null, dry: Cell | null = null;
    for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "high" || grid.buildingAt(c)) continue;
      const h = grid.heightAt(c);
      if (!beach && h < DRY_TERRAIN - 0.05) beach = c;
      if (!dry && h > DRY_TERRAIN + 0.05) dry = c;
    }
    expect(beach && dry).toBeTruthy();
    expect(grid.classOk("street", [beach!])).toBe(true);
    expect(grid.classOk("street", [dry!])).toBe(false);
    expect(grid.canPlace("path", [beach!])).toBe(false);
    expect(grid.canPlace("path", [dry!])).toBe(true);
    expect(grid.floorFor("walkway", [beach!])).toBeGreaterThan(SPRING_HI); // a beach walkway never floods
  });
  it("paths run over dry land and join the street; homes may stand on the hill, on short stilts", () => {
    const { state, grid } = town();
    state.resources.money += 1000;
    // A dry hill cell next to a lower cell that a walkway can stand on: the walkway joins the street to the path.
    let start: Cell | null = null, high: Cell | null = null;
    for (let i = -30; i < 30 && !high; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "high" || grid.heightAt(c) < DRY_TERRAIN || grid.buildingAt(c)) continue;
      const below = grid.neighbors(c).find(n => grid.classOk("street", [n]) && !grid.buildingAt(n));
      if (below && tryPlace(state, grid, "walkway", below)) { start = below; high = c; break; }
    }
    expect(high).not.toBeNull();
    expect(grid.canPlace("path", [start!])).toBe(false); // paths need dry land
    const p = tryPlace(state, grid, "path", high!);
    expect(p).not.toBeNull();
    expect(p!.floorY).toBeCloseTo(grid.heightAt(high!) + 0.05, 6);
    expect(grid.touchesWalkway([high!])).toBe(true);
    const further = grid.neighbors(high!).find(n => grid.classAt(n) === "high" && !grid.buildingAt(n));
    if (further) {
      const hut = tryPlace(state, grid, "hut", further);
      expect(hut).not.toBeNull();
      expect(hut!.floorY).toBeGreaterThanOrEqual(grid.heightAt(further) + STILT_MIN - 1e-9);
      state.tide.override = TIDE_HI; tick(state, grid);
      expect(p!.reached).toBe(grid.buildingAt(start!)!.reached); // the path is on the network iff its street is
    }
  });
  it("removing a building refunds half its money cost", () => {
    const { state, grid, town: t } = town();
    const before = state.resources.money;
    const hut = t.huts[0];
    const refund = removeBuilding(state, grid, hut);
    expect(refund).toBe(Math.round(BUILDINGS.hut.cost.money * REMOVE_REFUND));
    expect(state.resources.money).toBeCloseTo(before + refund, 6);
    expect(state.buildings[hut.id]).toBeUndefined();
    expect(grid.buildingAt(hut.cells[0])).toBeNull();
  });
  it("suggests a pier site next to the start hut on a fresh town and none once a pier stands", () => {
    const { state, grid } = newGame(1);
    const s = suggestPier(grid);
    expect(s).not.toBeNull();
    const fp = grid.footprint("pier", s!)!;
    expect(grid.canPlace("pier", fp)).toBe(true);
    const hut = Object.values(state.buildings)[0];
    expect(Math.hypot(s!.i - hut.cells[0].i, s!.j - hut.cells[0].j)).toBeLessThan(12);
  });
});

describe("day clock: sun and moon", () => {
  it("the sun rises in the east, stands at the study's noon direction a quarter in, sets at half, and the moon is opposite", () => {
    const at = (d: number) => sunVector(d);
    expect(at(0).y).toBeCloseTo(0, 6);
    expect(at(0.25).x).toBeCloseTo(NOON_SUN.x, 6); expect(at(0.25).y).toBeCloseTo(NOON_SUN.y, 6); expect(at(0.25).z).toBeCloseTo(NOON_SUN.z, 6);
    expect(at(0.5).y).toBeCloseTo(0, 6);
    expect(at(0.5).x).toBeCloseTo(-at(0).x, 6);
    expect(at(0.75).y).toBeLessThan(-0.8);
    const m = moonVector(0.75);
    expect(m.y).toBeGreaterThan(0.8);
    expect(m.x).toBeCloseTo(-at(0.75).x, 6);
    // Unit length all the way round.
    for (let d = 0; d < 1; d += 0.05) { const v = at(d); expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 5); }
    // A day is DAY_CYCLES tides: three quarters of a day is midnight and the dusk curve agrees.
    const midnight = 0.75 * DAY_CYCLES * TIDE_PERIOD;
    expect(dayFraction(midnight)).toBeCloseTo(0.75, 6);
    expect(duskAt(midnight)).toBeCloseTo(1, 6);
    expect(isDaytime(midnight)).toBe(false);
    expect(isDaytime(0.25 * DAY_CYCLES * TIDE_PERIOD)).toBe(true);
  });
});

describe("loans", () => {
  it("lends the lump sum once, takes an instalment each settlement, and is paid off with interest", () => {
    const { state, grid } = town();
    expect(canBorrow(state)).toBe(true);
    const money = state.resources.money;
    expect(takeLoan(state)).toBe(true);
    expect(state.resources.money).toBe(money + LOAN_AMOUNT);
    expect(state.loan.owed).toBeCloseTo(LOAN_AMOUNT * (1 + LOAN_INTEREST), 6);
    expect(canBorrow(state)).toBe(false);
    expect(takeLoan(state)).toBe(false);
    expect(state.log[state.log.length - 1]).toMatch(/Borrowed/);
    let paid = 0;
    for (let c = 0; c < LOAN_REPAY_CYCLES; c++) {
      const before = state.loan.owed;
      advanceCycles(state, grid, 1);
      paid += before - state.loan.owed;
      if (c < LOAN_REPAY_CYCLES - 1) expect(state.last.expenses).toBeGreaterThanOrEqual(loanInstalment() - 1e-6);
    }
    expect(state.loan.owed).toBe(0);
    expect(paid).toBeCloseTo(LOAN_AMOUNT * (1 + LOAN_INTEREST), 4);
    expect(state.log.some(m => /paid off/.test(m))).toBe(true);
    expect(canBorrow(state)).toBe(true);
    const old = JSON.parse(serialize(state)) as Partial<SimState>;
    delete old.loan;
    expect(deserialize(JSON.stringify(old)).loan.owed).toBe(0);
  });
});

describe("land tools", () => {
  it("landfill raises a flat cell to dry ground that takes a house, costs money and timber, and survives a save", () => {
    const { state, grid } = town();
    state.resources.money += 500; state.resources.timber += 20;
    let c: Cell | null = null;
    for (let i = -30; i < 30 && !c; i++) for (let j = -30; j < 30; j++) { const q = { i, j }; if (grid.classAt(q) === "flat" && !grid.buildingAt(q) && grid.heightAt(q) < 0.2) { c = q; break; } }
    expect(c).not.toBeNull();
    expect(landfillBlocker(state, grid, c!)).toBeNull();
    const money = state.resources.money, timber = state.resources.timber;
    expect(addLandfill(state, grid, c!)).toBe(true);
    expect(state.resources.money).toBe(money - LANDFILL_COST.money);
    expect(state.resources.timber).toBe(timber - LANDFILL_COST.timber);
    expect(grid.classAt(c!)).toBe("high");
    expect(grid.heightAt(c!)).toBeCloseTo(LANDFILL_HEIGHT, 5);
    expect(landfillBlocker(state, grid, c!)).toMatch(/flats/);
    state.resources.money += 100;
    const hut = tryPlace(state, grid, "hut", c!);
    expect(hut).not.toBeNull();
    expect(hut!.floorY).toBeCloseTo(LANDFILL_HEIGHT + STILT_MIN, 5); // on its own short stilts, like any home
    const round = new Grid(deserialize(serialize(state)));
    expect(round.classAt(c!)).toBe("high");
    expect(round.heightAt(c!)).toBeCloseTo(LANDFILL_HEIGHT, 5);
  });
  it("plants a sapling on dry ground that grows, and clears a grown tree for a little timber", () => {
    const { state, grid } = town();
    state.resources.money += 100;
    let c: Cell | null = null;
    for (let i = -30; i < 30 && !c; i++) for (let j = -30; j < 30; j++) { const q = { i, j }; if (grid.classAt(q) === "high" && !grid.buildingAt(q) && treeAt(state, q) < 0) { c = q; break; } }
    expect(c).not.toBeNull();
    expect(plantBlocker(state, grid, c!)).toBeNull();
    const n = state.trees.length;
    expect(plantTree(state, grid, c!)).toBe(true);
    expect(state.trees.length).toBe(n + 1);
    expect(state.extraTrees.length).toBe(1);
    expect(plantBlocker(state, grid, c!)).toMatch(/tree stands/);
    advanceCycles(state, grid, TREE_REGROW_CYCLES + 1);
    expect(state.trees[n]).toBe(1);
    const timber = state.resources.timber;
    expect(clearTree(state, grid, c!)).toBe(true);
    expect(state.trees[n]).toBe(-1);
    expect(state.resources.timber).toBe(timber + CLEAR_TIMBER);
    expect(clearBlocker(state, grid, c!)).toMatch(/No tree/);
    advanceCycles(state, grid, 2);
    expect(state.trees[n]).toBe(-1); // cleared trees never regrow
    expect(deserialize(serialize(state)).extraTrees.length).toBe(1);
  });
});

describe("tide splits the economy (M3)", () => {
  it("a standard walkway on low ground stands clear of the ordinary high tide and goes under only at a spring peak", () => {
    const { state, grid, town: t } = town();
    const cell = flatCellWithHeight(grid, 0.12, SPRING_FLOOD_TERRAIN - 0.02, t.pier.cells[0]);
    expect(cell).not.toBeNull();
    const w = grid.place("walkway", [cell!]);
    const safe = Math.max(grid.heightAt(cell!) + STILT_MIN, TIDE_HI + CLEARANCE);
    expect(w.floorY).toBeGreaterThanOrEqual(safe - 1e-6); // may rise to meet a neighbouring deck
    if (!grid.neighbors(cell!).some(n => grid.buildingAt(n))) expect(w.floorY).toBeCloseTo(safe, 6);
    w.floorY = safe;
    expect(floodFate(w.floorY)).toBe("spring");
    state.tide.override = TIDE_HI; tick(state, grid);
    expect(w.cut).toBe(false);
    state.tide.override = SPRING_HI; tick(state, grid);
    expect(w.cut).toBe(true);
    // The huts beside the street stand clear of the spring peak whatever their ground.
    for (const h of t.huts) expect(h.cut).toBe(false);
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
