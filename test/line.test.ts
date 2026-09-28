// The dragged run: the L when it is clear, the shortest way round a hill or the water when it is not, and the
// blind tester's case — a street dragged from the pier to the hut on a generated island arrives connected.
import { describe, expect, it } from "vitest";
import { linePath, MAX_LINE, routePath } from "../src/build/line";
import { BUILDINGS, mayTurn, PATH_MAX_RISE } from "../src/sim/balance";
import { clearTree } from "../src/sim/land";
import { treeSites } from "../src/sim/trees";
import { tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { updateNetwork } from "../src/sim/network";
import { newGame, suggestPier } from "../src/sim/start";
import { Cell } from "../src/sim/state";

const fitsOn = (grid: Grid) => (c: Cell) => { const fp = grid.footprint("walkway", c); return !!fp && grid.classOk(BUILDINGS.walkway.cls, fp) && !grid.buildingAt(c); };

describe("the dragged run", () => {
  it("is the L when every cell of it fits", () => {
    const route = routePath({ i: 0, j: 0 }, { i: 3, j: 2 }, () => true)!;
    expect(route).toEqual(linePath({ i: 0, j: 0 }, { i: 3, j: 2 }).slice(1));
  });
  it("bends round a blocked cell instead of skipping it", () => {
    const blocked = new Set(["2,0", "2,1", "2,-1"]);
    const route = routePath({ i: 0, j: 0 }, { i: 4, j: 0 }, c => !blocked.has(`${c.i},${c.j}`))!;
    expect(route[route.length - 1]).toEqual({ i: 4, j: 0 });
    for (let k = 1; k < route.length; k++) expect(Math.abs(route[k].i - route[k - 1].i) + Math.abs(route[k].j - route[k - 1].j)).toBe(1);
    expect(route.some(c => blocked.has(`${c.i},${c.j}`))).toBe(false);
  });
  it("is null when nothing joins the ends, and starts and ends beside unbuildable ends", () => {
    expect(routePath({ i: 0, j: 0 }, { i: 5, j: 0 }, c => c.i < 2)).toBeNull();
    const route = routePath({ i: 0, j: 0 }, { i: 4, j: 0 }, c => !(c.i === 0 && c.j === 0) && !(c.i === 4 && c.j === 0))!;
    expect(route[0]).not.toEqual({ i: 0, j: 0 });
    expect(route[route.length - 1]).not.toEqual({ i: 4, j: 0 });
  });
  it("leaves from any side of the pier and arrives at any side of the hut", () => {
    const { state, grid } = newGame(1, 7);
    const hut = Object.values(state.buildings).find(b => b.kind === "hut")!;
    const pier = tryPlace(state, grid, "pier", suggestPier(grid)!)!;
    state.resources.money += 2000;
    // The drag starts on the pier's seaward cell, where nothing fits beside it; the route leaves the pier's shore cell.
    const route = routePath(pier.cells[1], hut.cells[0], fitsOn(grid), MAX_LINE, { startCells: pier.cells, goalCells: hut.cells });
    expect(route, "a route exists").not.toBeNull();
    for (const c of route!) expect(tryPlace(state, grid, "walkway", c), `walkway at ${c.i},${c.j}`).not.toBeNull();
    updateNetwork(state, grid, state.tide.level);
    expect(hut.reached).toBe(true);
  });
  it("goes first along the axis it is told to", () => {
    expect(linePath({ i: 0, j: 0 }, { i: 2, j: 3 }, "i").slice(0, 3)).toEqual([{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: 2, j: 0 }]);
    expect(linePath({ i: 0, j: 0 }, { i: 3, j: 2 }, "j").slice(0, 3)).toEqual([{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }]);
    const route = routePath({ i: 0, j: 0 }, { i: 3, j: 2 }, () => true, MAX_LINE, { axis: "j" })!;
    expect(route[0]).toEqual({ i: 0, j: 1 });
  });
  it("bends once round a hill rather than climbing it in a staircase", () => {
    // A block across the L's corner: the way round is a longer L, not a diagonal of one-cell steps.
    const hill = (c: Cell) => c.i >= 2 && c.i <= 4 && c.j >= 0 && c.j <= 2;
    const route = routePath({ i: 0, j: 0 }, { i: 6, j: 3 }, c => !hill(c) && c.j >= -1 && c.j <= 5 && c.i >= -1 && c.i <= 7, MAX_LINE)!;
    expect(route[route.length - 1]).toEqual({ i: 6, j: 3 });
    let turns = 0, dir = "";
    let prev = { i: 0, j: 0 };
    for (const c of route) { const d = c.i !== prev.i ? "i" : "j"; if (dir && d !== dir) turns++; dir = d; prev = c; }
    expect(turns).toBeLessThanOrEqual(2);
  });
  it("takes the cheaper way round when the L is blocked", () => {
    const blocked = (c: Cell) => c.i === 3 && c.j === 0;
    const route = routePath({ i: 0, j: 0 }, { i: 6, j: 0 }, c => !blocked(c) && c.j >= 0 && c.j <= 2, MAX_LINE, { cost: c => (c.j === 0 ? 10 : 1) })!;
    expect(route[route.length - 1]).toEqual({ i: 6, j: 0 });
    expect(route.filter(c => c.j === 0).length).toBe(1); // only the goal sits on the dear row
  });
  it("a path goes round a tree and refuses a steep bank", () => {
    const { state, grid } = newGame(1, 7);
    state.resources.money += 500;
    const sites = treeSites(state);
    const k = sites.findIndex((s, i) => state.trees[i] >= 0 && grid.classAt(s.cell) === "high" && grid.slopeOk("path", [s.cell]));
    expect(k).toBeGreaterThanOrEqual(0);
    const cell = sites[k].cell;
    expect(grid.treeOn([cell])).toBe(true);
    expect(tryPlace(state, grid, "path", cell)).toBeNull();
    expect(clearTree(state, grid, cell)).toBe(true);
    expect(tryPlace(state, grid, "path", cell)).not.toBeNull();
  });
  it("a path climbs at most PATH_MAX_RISE a cell: the next cell up a bank is refused, the one along the contour is not", () => {
    const { state, grid } = newGame(1, 2, "fjord"); // the Fjord's banks are cliffs
    state.resources.money += 500;
    const ok = (c: Cell) => { const fp = grid.footprint("path", c); return !!fp && grid.canPlace("path", fp); };
    let found: { a: Cell; up: Cell; along: Cell } | null = null;
    for (let i = -28; i < 28 && !found; i++) for (let j = -28; j < 28 && !found; j++) {
      const a = { i, j };
      if (!ok(a)) continue;
      const h = grid.heightAt(a);
      const ns = grid.neighbors(a).filter(n => ok(n));
      const up = ns.find(n => Math.abs(grid.heightAt(n) - h) > PATH_MAX_RISE + 0.05);
      const along = ns.find(n => Math.abs(grid.heightAt(n) - h) <= PATH_MAX_RISE - 0.05);
      if (up && along && !grid.neighbors(up).some(n => grid.buildingAt(n)) && !grid.neighbors(along).some(n => grid.buildingAt(n))) found = { a, up, along };
    }
    expect(found).not.toBeNull();
    expect(tryPlace(state, grid, "path", found!.a)).not.toBeNull();
    expect(grid.joinStepOk("path", [found!.up])).toBe(false);
    expect(tryPlace(state, grid, "path", found!.up)).toBeNull();
    expect(tryPlace(state, grid, "path", found!.along)).not.toBeNull();
    // The route between them goes round, stepping within the rise.
    const route = routePath(found!.a, found!.up, c => ok(c) || (c.i === found!.a.i && c.j === found!.a.j), MAX_LINE, { step: (p, q) => grid.stepOk("path", p, "path", q) });
    if (route) for (let k = 0; k < route.length; k++) expect(grid.stepOk("path", k ? route[k - 1] : found!.a, "path", route[k])).toBe(true);
  });
  it("never turns a street piece, whatever it stands beside (a turned walkway wears its rails across the walk)", () => {
    const { state, grid } = newGame(1, 7);
    const hut = Object.values(state.buildings).find(b => b.kind === "hut")!;
    const pier = tryPlace(state, grid, "pier", suggestPier(grid)!)!;
    state.resources.money += 2000;
    const route = routePath(pier.cells[1], hut.cells[0], fitsOn(grid), MAX_LINE, { startCells: pier.cells, goalCells: hut.cells })!;
    const laid = route.map(c => tryPlace(state, grid, "walkway", c)!);
    expect(laid.every(b => b && b.rot === 0)).toBe(true);
    expect(mayTurn("walkway") || mayTurn("path") || mayTurn("breakwater")).toBe(false);
    expect(mayTurn("hut") && mayTurn("market")).toBe(true);
  });
  for (const seed of [0, 7, 11, 23]) it(`connects the hut to the pier on island ${seed}`, () => {
    const { state, grid } = newGame(1, seed);
    const hut = Object.values(state.buildings).find(b => b.kind === "hut")!;
    const pier = tryPlace(state, grid, "pier", suggestPier(grid)!)!;
    state.resources.money += 2000;
    const route = routePath(pier.cells[0], hut.cells[0], fitsOn(grid));
    expect(route, "a route exists").not.toBeNull();
    for (const c of route!) expect(tryPlace(state, grid, "walkway", c), `walkway at ${c.i},${c.j}`).not.toBeNull();
    updateNetwork(state, grid, state.tide.level);
    expect(hut.reached).toBe(true);
  });
});
