// Sim-only unit checks. Nothing here may pull in Babylon; the hygiene test enforces that for src/sim/**.
import { describe, expect, it } from "vitest";
import { TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { Grid } from "../src/sim/grid";
import { stateHash } from "../src/sim/save";
import { Cell, createState, pieceList, SimState } from "../src/sim/state";
import { advanceCycles, tick } from "../src/sim/tick";
import { isRising, tickTide, tideNormalized } from "../src/sim/tide";

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

/** A small scripted town: pier nearest the island centre, a run of walkways along the flats, houses off them. */
function buildTown(state: SimState, grid: Grid, houses = 4): { pier: Cell; houses: Cell[] } {
  let anchor: Cell | null = null, best = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c)) continue;
    const d = Math.hypot(i, j);
    if (d < best) { best = d; anchor = c; }
  }
  if (!anchor) throw new Error("no pier site on this island");
  grid.place("pier", grid.footprint("pier", anchor)!);
  let cur: Cell | null = grid.neighbors(anchor).find(n => grid.classAt(n) === "flat")!;
  const seen = new Set<string>();
  for (let s = 0; s < 10 && cur; s++) {
    seen.add(cur.i + "," + cur.j);
    grid.place("walkway", [cur]);
    const next: Cell[] = grid.neighbors(cur).filter(n => grid.classAt(n) === "flat" && !seen.has(n.i + "," + n.j) && !grid.pieceAt(n));
    cur = next[0] ?? null;
  }
  const placed: Cell[] = [];
  for (const p of pieceList(state)) {
    if (p.kind !== "walkway") continue;
    for (const n of grid.neighbors(p.cells[0])) {
      if (placed.length >= houses) break;
      if (grid.classAt(n) === "flat" && !grid.pieceAt(n)) { grid.place("house", [n]); placed.push(n); }
    }
  }
  return { pier: anchor, houses: placed };
}

describe("ledger", () => {
  it("advances deterministically: same script, same hash", () => {
    const run = () => {
      const state = createState(7);
      const grid = new Grid(state);
      buildTown(state, grid);
      advanceCycles(state, grid, 3);
      return { hash: stateHash(state), state };
    };
    const a = run(), b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.state.tide.cycle).toBe(3);
    expect(a.state.score?.reached).toBe(4);
    expect(a.state.score?.houses).toBe(4);
  });

  it("reaches houses through walkways and severs them when the link is removed", () => {
    const state = createState();
    const grid = new Grid(state);
    const town = buildTown(state, grid);
    tick(state, grid);
    expect(pieceList(state).filter(p => p.kind === "house" && p.reached).length).toBe(4);
    // Remove every non-house piece around the first house: it must go unreached.
    const house = grid.pieceAt(town.houses[0])!;
    for (const n of grid.neighbors(house.cells[0])) { const q = grid.pieceAt(n); if (q && q.kind !== "house") grid.remove(q); }
    tick(state, grid);
    expect(house.reached).toBe(false);
  });

  it("cuts walkways but not houses when the water reaches 0.97", () => {
    const state = createState();
    const grid = new Grid(state);
    buildTown(state, grid);
    state.tide.override = 0.97;
    tick(state, grid);
    const pieces = pieceList(state);
    expect(pieces.filter(p => p.kind === "walkway").every(p => p.cut)).toBe(true);
    expect(pieces.filter(p => p.kind !== "walkway").some(p => p.cut)).toBe(false);
    expect(pieces.filter(p => p.kind === "house" && p.reached).length).toBe(0);
  });

  it("round-trips through JSON with an identical hash and a working grid", () => {
    const state = createState(3);
    const grid = new Grid(state);
    const town = buildTown(state, grid);
    advanceCycles(state, grid, 1);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    expect(stateHash(copy)).toBe(stateHash(state));
    const grid2 = new Grid(copy);
    expect(grid2.pieceAt(town.houses[0])?.kind).toBe("house");
    advanceCycles(state, grid, 1);
    advanceCycles(copy, grid2, 1);
    expect(stateHash(copy)).toBe(stateHash(state));
  });
});
