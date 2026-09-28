// Sim-only unit checks: hygiene, the tide and day clocks, the ledger, loans and the land tools. Nothing here may
// pull in Babylon; the hygiene test enforces that for src/sim/**. The other test/*.test.ts files are the topics.
import { describe, expect, it } from "vitest";
import { SPRING_HI, SPRING_LO, STILT_MIN, TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { CLEAR_TIMBER, LANDFILL_COST, LANDFILL_HEIGHT, LOAN_AMOUNT, LOAN_GRACE_CYCLES, LOAN_INTEREST, TREE_REGROW_CYCLES } from "../src/sim/balance";
import { deserialize, serialize } from "../src/sim/save";
import { addLandfill, clearBlocker, clearTree, landfillBlocker, plantBlocker, plantTree, treeAt } from "../src/sim/land";
import { dayFraction, duskAt, isDaytime, moonVector, NOON_SUN, sunVector } from "../src/sim/daylight";
import { canBorrow, loanInstalment, takeLoan } from "../src/sim/loan";
import { DAY_CYCLES } from "../src/config";

import { tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { stateHash } from "../src/sim/save";
import { newGame } from "../src/sim/start";
import { buildingList, Cell, createState, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { isRising, tickTide, tideNormalized } from "../src/sim/tide";

import { starterTown } from "./scenario";

const simSources = import.meta.glob("../src/sim/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function town(seed = 7): { state: SimState; grid: Grid; town: ReturnType<typeof starterTown> } {
  const { state, grid } = newGame(seed);
  return { state, grid, town: starterTown(state, grid) };
}

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
  it("a town that earns nothing owes the loan but is never drained by it", () => {
    const { state, grid } = newGame(7); // a hut and nothing that earns
    expect(takeLoan(state)).toBe(true);
    const money = state.resources.money;
    let upkeep = 0;
    for (let c = 0; c < LOAN_GRACE_CYCLES + 6; c++) { advanceCycles(state, grid, 1); upkeep += state.last.expenses; }
    expect(state.loan.owed).toBeCloseTo(LOAN_AMOUNT * (1 + LOAN_INTEREST), 6);
    expect(state.resources.money).toBeCloseTo(money - upkeep, 4);
  });
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
    // The grace: nothing is taken for LOAN_GRACE_CYCLES settlements. Then each settlement pays at most the
    // instalment and never more than the cycle earned above its upkeep: the loan is paid out of earnings, not
    // out of the purse.
    let paid = 0;
    for (let c = 0; c < LOAN_GRACE_CYCLES; c++) { const before = state.loan.owed; advanceCycles(state, grid, 1); expect(state.loan.owed).toBe(before); }
    for (let c = 0; c < 80 && state.loan.owed > 0; c++) {
      const before = state.loan.owed;
      advanceCycles(state, grid, 1);
      const pay = before - state.loan.owed;
      paid += pay;
      expect(pay).toBeLessThanOrEqual(loanInstalment() + 1e-6);
      expect(pay).toBeLessThanOrEqual(Math.max(0, state.last.income - (state.last.expenses - pay)) + 1e-6);
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

