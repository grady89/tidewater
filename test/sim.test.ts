// Sim-only unit checks. Nothing here may pull in Babylon; the hygiene test enforces that for src/sim/**.
import { describe, expect, it } from "vitest";
import { TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { BOAT_COST, BUILDINGS, STARTING_MONEY } from "../src/sim/balance";
import { boatPurchaseBlocker, buyBoat } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { stateHash } from "../src/sim/save";
import { buildingList, createState, population, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { isRising, tickTide, tideNormalized } from "../src/sim/tide";
import { starterTown } from "./scenario";

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
  const state = createState(seed);
  const grid = new Grid(state);
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

  it("cuts walkways but not houses when the water reaches 0.97", () => {
    const { state, grid } = town();
    state.tide.override = 0.97;
    tick(state, grid);
    const all = buildingList(state);
    expect(all.filter(b => b.kind === "walkway").every(b => b.cut)).toBe(true);
    expect(all.filter(b => b.kind !== "walkway").some(b => b.cut)).toBe(false);
  });
});

describe("money loop (M2)", () => {
  it("the starter town is affordable from the 500$ start and is fully connected", () => {
    const { state, town: t } = town();
    expect(t.huts.length).toBe(3);
    expect(t.market).not.toBeNull();
    expect(t.pier.boats).toBe(2);
    expect(state.resources.money).toBeGreaterThanOrEqual(0);
    expect(state.resources.money).toBeLessThan(STARTING_MONEY - BUILDINGS.pier.cost.money - 2 * BOAT_COST);
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
      if (b && b.kind === "walkway") grid.remove(b);
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
