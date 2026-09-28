// Sea lanes (BIOMES.md §4) behind LANES_ENABLED: the World ledger settles every built sea but the active one
// once per cycle, quietly; cargo flows one hop between harbors on adjacent built faces, surplus toward want.
import { describe, expect, it } from "vitest";
import { LANES_ENABLED } from "../src/config";
import { CARGO_HOLD, CARGO_SHIPS_PER_HARBOR } from "../src/sim/balance";
import { flowLane, lanesOf, neighboursOf, settleOnly, settleWorld, settleWorldNow, surplusOf, wantOf } from "../src/sim/lanes";
import { readSector, Store, writeSector } from "../src/sim/sectors";
import { newGame } from "../src/sim/start";
import { SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { placeHarbor, starterTown } from "./scenario";

class MapStore implements Store {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function harborTown(seed = 7) {
  const { state, grid } = newGame(seed);
  const t = starterTown(state, grid);
  state.resources.money += 5000; state.resources.planks += 200;
  const harbor = placeHarbor(state, grid, t.pier.cells[0]);
  expect(harbor).not.toBeNull();
  advanceCycles(state, grid, 2);
  return { state, grid };
}

describe("sea lanes: the flag", () => {
  it("is off, and settleWorld does nothing while it is", () => {
    expect(LANES_ENABLED).toBe(false);
    const store = new MapStore();
    const a = harborTown();
    writeSector(store, 1, a.state, { name: "A", biome: "tidewater" });
    const before = store.getItem("tidewater.sector.1");
    expect(settleWorld(store, null, null)).toEqual({ settled: [], moved: [] });
    expect(store.getItem("tidewater.sector.1")).toBe(before);
  });
});

describe("sea lanes: the World ledger", () => {
  it("adjacency comes from the dodecahedron: five neighbours each, symmetric", () => {
    for (let f = 0; f < 12; f++) {
      expect(neighboursOf(f).length).toBe(5);
      for (const n of neighboursOf(f)) expect(neighboursOf(n)).toContain(f);
    }
  });
  it("settleOnly moves the clock one cycle and settles without hazards", () => {
    const { state, grid } = harborTown();
    const cycle = state.tide.cycle, fires = state.fires;
    for (let k = 0; k < 20; k++) settleOnly(state, grid);
    expect(state.tide.cycle).toBe(cycle + 20);
    expect(state.fires).toBe(fires);
    expect(Number.isFinite(state.resources.money)).toBe(true);
  });
  it("surplus keeps the food reserve; want is only for goods the coast cannot make", () => {
    const { state } = harborTown();
    state.resources.fish = 500;
    expect(surplusOf(state, "fish")).toBeGreaterThan(0);
    expect(surplusOf(state, "fish")).toBeLessThan(500);
    state.resources.fish = 0;
    expect(surplusOf(state, "fish")).toBe(0);
    expect(wantOf(state, "fish")).toBe(0);
    expect(wantOf(state, "cocoa")).toBeGreaterThan(0);
  });
  it("cargo flows surplus toward want, never past the hold or the cap", () => {
    const a = harborTown(7), b = harborTown(8);
    a.state.resources.cocoa = 100;
    b.state.resources.cocoa = 0;
    const moved = flowLane(a.state, b.state, CARGO_HOLD);
    expect(moved.cocoa).toBeGreaterThan(0);
    expect(moved.cocoa!).toBeLessThanOrEqual(CARGO_HOLD);
    expect(a.state.resources.cocoa + b.state.resources.cocoa).toBeCloseTo(100, 6);
  });
  it("a lane needs a harbor at both ends and a shared edge", () => {
    const a = harborTown(7), b = harborTown(8);
    const states = new Map<number, SimState>([[1, a.state], [6, b.state]]);
    expect(lanesOf(states, 1)).toEqual([6]);
    expect(lanesOf(states, 6)).toEqual([1]);
    states.set(3, newGame(9).state);
    expect(lanesOf(states, 1)).toEqual([6]);
    expect(lanesOf(states, 3)).toEqual([]);
  });
  it("settles every built sea but the active one and carries cargo across the lane", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8);
    a.state.resources.cocoa = 100;
    writeSector(store, 1, a.state, { name: "A", biome: "tidewater" });
    writeSector(store, 6, b.state, { name: "B", biome: "tidewater" });
    const cycleB = b.state.tide.cycle;
    const out = settleWorldNow(store, 1, a.state);
    expect(out.settled).toEqual([6]);
    expect(out.moved.some(m => m.from === 1 && m.to === 6 && (m.goods.cocoa ?? 0) > 0)).toBe(true);
    const b2 = readSector(store, 6)!.state;
    expect(b2.tide.cycle).toBe(cycleB + 1);
    expect(b2.resources.cocoa).toBeGreaterThan(0);
    expect(a.state.resources.cocoa).toBeLessThan(100);
    expect(a.state.resources.cocoa + b2.resources.cocoa).toBeCloseTo(100, 6);
    const hold = CARGO_SHIPS_PER_HARBOR * CARGO_HOLD;
    expect(100 - a.state.resources.cocoa).toBeLessThanOrEqual(hold + 1e-6);
  });
});
