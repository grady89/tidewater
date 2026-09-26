// Scripted towns shared by the unit tests and the smoke scenario (which imports this module into the page
// through the Vite dev server). Sim-only: no Babylon.
import { BuildingKind } from "../src/sim/balance";
import { buyBoat, tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { floodFate } from "../src/sim/tide";

const dist = (a: Cell, b: Cell) => Math.hypot(a.i - b.i, a.j - b.j);

/** Deep cell that admits a pier, closest to `near`, preferring a shore cell that keeps a standard walkway dry. */
export function pierSite(grid: Grid, near: Cell): Cell {
  let best: Cell | null = null, bs = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c)) continue;
    const shore = grid.neighbors(c).find(n => grid.classAt(n) === "flat")!;
    const score = dist(c, near) + (grid.heightAt(shore) < 0.1 ? 6 : 0);
    if (score < bs) { bs = score; best = c; }
  }
  if (!best) throw new Error("no pier site on this island");
  return best;
}

/**
 * Walk from the pier's shore cell toward `target`, laying a raised walkway wherever a standard one would flood
 * every tide and a standard one elsewhere. Stops next to the target or after `max` cells.
 */
export function layWalkways(state: SimState, grid: Grid, pier: Cell, target: Cell, max = 14): Cell[] {
  let cur: Cell | null = grid.neighbors(pier).find(c => grid.classAt(c) === "flat") ?? null;
  const laid: Cell[] = [];
  const seen = new Set<string>();
  while (cur && laid.length < max) {
    seen.add(cur.i + "," + cur.j);
    const kind: BuildingKind = floodFate(grid.floorFor("walkway", [cur])) === "always" ? "raisedWalkway" : "walkway";
    if (!tryPlace(state, grid, kind, cur)) break;
    laid.push(cur);
    if (grid.neighbors(cur).some(n => n.i === target.i && n.j === target.j)) break;
    const next: Cell[] = grid.neighbors(cur)
      .filter(c => grid.classAt(c) === "flat" && !seen.has(c.i + "," + c.j) && !grid.buildingAt(c))
      .sort((a, b) => dist(a, target) - dist(b, target));
    cur = next[0] ?? null;
  }
  return laid;
}

/** Place up to `count` of `kind` where the footprint touches a walkway (standard or raised). */
export function placeByWalkway(state: SimState, grid: Grid, kind: BuildingKind, count = 1): Building[] {
  const out: Building[] = [];
  const walkways = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
  for (const w of walkways) {
    if (out.length >= count) break;
    for (const n of grid.neighbors(w.cells[0])) {
      if (out.length >= count) break;
      for (let di = 0; di < 2 && out.length < count; di++) for (let dj = 0; dj < 2 && out.length < count; dj++) {
        const b = tryPlace(state, grid, kind, { i: n.i - di, j: n.j - dj });
        if (b) { out.push(b); break; }
      }
    }
  }
  return out;
}

/**
 * The starter town around the free hut: pier, two boats, walkways to the hut, two more huts, a market.
 * Everything paid from the 500$ start.
 */
export function starterTown(state: SimState, grid: Grid): { pier: Building; huts: Building[]; market: Building | null; walkways: Cell[] } {
  const hut0 = buildingList(state).find(b => b.kind === "hut");
  if (!hut0) throw new Error("starter town needs the seeded hut (use newGame)");
  const site = pierSite(grid, hut0.cells[0]);
  const pier = tryPlace(state, grid, "pier", site);
  if (!pier) throw new Error("could not place pier");
  buyBoat(state, pier);
  buyBoat(state, pier);
  const walkways = layWalkways(state, grid, site, hut0.cells[0]);
  const huts = [hut0, ...placeByWalkway(state, grid, "hut", 2)];
  const market = placeByWalkway(state, grid, "market", 1)[0] ?? null;
  return { pier, huts, market, walkways };
}
