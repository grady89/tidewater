// Scripted towns shared by the unit tests and (copied verbatim into page.evaluate) the smoke scenario.
// Sim-only: no Babylon.
import { BuildingKind } from "../src/sim/balance";
import { buyBoat, tryPlace } from "../src/sim/economy";
import { Grid } from "../src/sim/grid";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";

/** Deep cell that admits a pier, nearest the island centre. */
export function pierSite(grid: Grid): Cell {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c)) continue;
    const d = Math.hypot(i, j);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) throw new Error("no pier site on this island");
  return best;
}

/** Lay `n` walkways along the flats starting from the pier's shore cell. Returns the cells laid. */
export function layWalkways(state: SimState, grid: Grid, pier: Cell, n: number): Cell[] {
  let cur: Cell | null = grid.neighbors(pier).find(c => grid.classAt(c) === "flat") ?? null;
  const laid: Cell[] = [];
  const seen = new Set<string>();
  while (cur && laid.length < n) {
    seen.add(cur.i + "," + cur.j);
    if (tryPlace(state, grid, "walkway", cur)) laid.push(cur);
    const next: Cell[] = grid.neighbors(cur).filter(c => grid.classAt(c) === "flat" && !seen.has(c.i + "," + c.j) && !grid.buildingAt(c));
    cur = next[0] ?? null;
  }
  return laid;
}

/** Place `kind` somewhere its footprint touches a walkway. */
export function placeByWalkway(state: SimState, grid: Grid, kind: BuildingKind, count = 1): Building[] {
  const out: Building[] = [];
  const walkways = buildingList(state).filter(b => b.kind === "walkway");
  for (const w of walkways) {
    if (out.length >= count) break;
    for (const n of grid.neighbors(w.cells[0])) {
      if (out.length >= count) break;
      // Try every anchor whose footprint would cover the neighbour cell.
      for (let di = 0; di < 2 && out.length < count; di++) for (let dj = 0; dj < 2 && out.length < count; dj++) {
        const b = tryPlace(state, grid, kind, { i: n.i - di, j: n.j - dj });
        if (b) { out.push(b); break; }
      }
    }
  }
  return out;
}

/** The M2 starter town: pier, two boats, walkways, three huts, a market. Everything paid from the 500$ start. */
export function starterTown(state: SimState, grid: Grid): { pier: Building; huts: Building[]; market: Building | null } {
  const site = pierSite(grid);
  const pier = tryPlace(state, grid, "pier", site);
  if (!pier) throw new Error("could not place pier");
  buyBoat(state, pier);
  buyBoat(state, pier);
  layWalkways(state, grid, site, 8);
  const huts = placeByWalkway(state, grid, "hut", 3);
  const market = placeByWalkway(state, grid, "market", 1)[0] ?? null;
  return { pier, huts, market };
}
