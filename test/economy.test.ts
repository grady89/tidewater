// The money loop, the sea, the production chain, trade and tourism, and the tide splitting the economy.
import { describe, expect, it } from "vitest";
import { CLEARANCE, HIGH_WATER_MARK, LOW_WATER_MARK, SPRING_FLOOD_TERRAIN, SPRING_HI, STILT_MIN, TIDE_HI, TIDE_PERIOD } from "../src/config";
import { BOAT_COST, BOAT_MIN_RANGE, BOAT_RANGE, BUILDINGS, CAP_BASE, PLANK_ORDER_SIZE, STARTING_MONEY, TRADE_EVERY, TRADE_EVERY_LIGHTHOUSE, TREE_REGROW_CYCLES, WAREHOUSE_CAP } from "../src/sim/balance";

import { orderPlanks } from "../src/sim/trade";
import { addCapped, boatPurchaseBlocker, buyBoat, capFor, totalBoats, tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { updateNetwork } from "../src/sim/network";

import { chooseGround, seaEntry, seaPath } from "../src/sim/sea";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, createState, population, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { floodFate, phaseProgress, tickTide } from "../src/sim/tide";
import { grownTreesNear } from "../src/sim/trees";
import { assignWorkers } from "../src/sim/workers";

import { growStreet, placeByWalkway, placeEdge, placeHarbor, placeLumberCamp, placeSecondPier, placeShipyard, reachHill, shelterHarbours, starterTown } from "./scenario";

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

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
