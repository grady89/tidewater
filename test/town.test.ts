// Happiness and services, the tutorial and the big town, districts, achievements, and placement rules.
import { describe, expect, it } from "vitest";
import { CLEARANCE, DRY_TERRAIN, SPRING_FLOOD_TERRAIN, SPRING_HI, STILT_MIN, TIDE_HI, TIDE_LO, WALKWAY_SNAP } from "../src/config";
import { BUILDINGS, HAPPY, LEVEL_UP_CYCLES, LEVEL_UP_HAPPINESS, MAX_LEVEL, LIFT_MAX, LIFT_STEP, REMOVE_REFUND, STILT_COST_PER_UNIT, WAVE_HEIGHT } from "../src/sim/balance";
import { ACHIEVEMENTS, checkAchievements } from "../src/sim/achievements";
import { deserialize, serialize } from "../src/sim/save";
import { DISTRICT_MIN, districtName, districtOf, districts } from "../src/sim/districts";

import { suggestPier } from "../src/sim/start";

import { addLantern, coverageAt, lanternBlocker } from "../src/sim/services";

import { placeCost, removeBuilding, tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";

import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { floodFate } from "../src/sim/tide";

import { STEPS } from "../src/ui/tutorial";
import { bigTown, growStreet, placeByWalkway, placeHarbor, settleIsle, starterTown } from "./scenario";

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

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

  it("a home with every coverage reaches level 2 on two foods within 8 cycles, and level 3 once a foreign luxury is in stock", () => {
    const { state, grid, t } = servedTown();
    // Fish alone holds every home at level 1 however happy it is (BIOMES.md §2: two food kinds for level 2).
    advanceCycles(state, grid, 8);
    expect(Math.max(...t.huts.map(h => h.level))).toBe(1);
    expect(state.happiness).toBeGreaterThanOrEqual(LEVEL_UP_HAPPINESS);
    // Shellfish on the table: level 2.
    let bed: Building | null = placeByWalkway(state, grid, "oysterBed", 1)[0] ?? null;
    for (let k = 0; k < 8 && !bed; k++) { growStreet(state, grid, 1); bed = placeByWalkway(state, grid, "oysterBed", 1)[0] ?? null; }
    expect(bed).not.toBeNull();
    let shellfishSeen = 0, reached2 = -1;
    for (let c = 1; c <= 8 && reached2 < 0; c++) {
      advanceCycles(state, grid, 1);
      shellfishSeen = Math.max(shellfishSeen, state.resources.shellfish, state.last.shellfishSold);
      if (Math.max(...t.huts.map(h => h.level)) === 2) reached2 = c;
    }
    expect(shellfishSeen).toBeGreaterThan(0);
    expect(reached2).toBeGreaterThan(0);
    expect(Math.max(...t.huts.map(h => h.level))).toBe(2);
    // A third food and a foreign luxury (what the company carries): level 3. (A shark incident on the beach can
    // cost a few cycles of grief, so allow a few more than the streak needs.)
    state.resources.rice += 30;
    state.resources.coffee += 10;
    let reached3 = -1;
    for (let c = 1; c <= LEVEL_UP_CYCLES + 6 && reached3 < 0; c++) { advanceCycles(state, grid, 1); if (t.huts.some(h => h.level === MAX_LEVEL)) reached3 = c; }
    expect(reached3).toBeGreaterThan(0);
    const levels = t.huts.map(h => h.level);
    expect(Math.max(...levels)).toBe(MAX_LEVEL);
    const best = t.huts.find(h => h.level === MAX_LEVEL)!;
    expect(grid.capacityOf(best)).toBe(BUILDINGS.hut.residents + MAX_LEVEL - 1);
    expect(best.happiness).toBeGreaterThanOrEqual(LEVEL_UP_HAPPINESS);
    expect(state.log.some(m => /level 3/.test(m))).toBe(true);
    expect(state.resources.coffee).toBeLessThan(10); // level-3 residents use a little of it
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

