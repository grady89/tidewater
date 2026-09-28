// The dragged run: the L when it is clear, the shortest way round a hill or the water when it is not, and the
// blind tester's case — a street dragged from the pier to the hut on a generated island arrives connected.
import { describe, expect, it } from "vitest";
import { linePath, MAX_LINE, routePath } from "../src/build/line";
import { BUILDINGS } from "../src/sim/balance";
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
  it("takes the cheaper way round when the L is blocked", () => {
    const blocked = (c: Cell) => c.i === 3 && c.j === 0;
    const route = routePath({ i: 0, j: 0 }, { i: 6, j: 0 }, c => !blocked(c) && c.j >= 0 && c.j <= 2, MAX_LINE, { cost: c => (c.j === 0 ? 10 : 1) })!;
    expect(route[route.length - 1]).toEqual({ i: 6, j: 0 });
    expect(route.filter(c => c.j === 0).length).toBe(1); // only the goal sits on the dear row
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
