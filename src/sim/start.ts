// A new game: fresh ledger, grid index, and the free starting hut on the best of the flats.
import { Cell, createState, notify, SimState } from "./state";
import { Grid } from "./grid";

/** Flats high enough that ordinary and spring tides leave a standard walkway dry, but not the dry hill. */
const START_TERRAIN = { min: 0.36, max: 0.58 };

/** The starting hut goes on a comfortable flat cell nearest the island centre with the sea within reach. */
export function startCell(grid: Grid): Cell {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "flat" || grid.onIsle([c])) continue;
    const h = grid.heightAt(c);
    if (h < START_TERRAIN.min || h > START_TERRAIN.max) continue;
    const d = Math.hypot(i, j);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) {
    // Islands without such ground: any flat cell nearest the centre.
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "flat" || grid.onIsle([c])) continue;
      const d = Math.hypot(i, j);
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best!;
}

/** Where the first pier should go: the deep cell that takes one, nearest the town's homes (or the start cell). */
export function suggestPier(grid: Grid): Cell | null {
  const homes = Object.values(grid.state.buildings).filter(b => b.kind === "hut" || b.kind === "house").map(b => b.cells[0]);
  const near = homes.length ? homes : [startCell(grid)];
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep" || grid.onIsle([c])) continue;
    const fp = grid.footprint("pier", c);
    if (!fp || !grid.canPlace("pier", fp)) continue;
    let d = Infinity;
    for (const h of near) d = Math.min(d, Math.hypot(i - h.i, j - h.j));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function seedTown(state: SimState, grid: Grid): void {
  const c = startCell(grid);
  if (grid.canPlace("hut", [c])) grid.place("hut", [c]);
  notify(state, "A hut on the flats. Build a pier, buy a boat, lay walkways.");
}

export function newGame(seed = 1): { state: SimState; grid: Grid } {
  const state = createState(seed);
  const grid = new Grid(state);
  seedTown(state, grid);
  return { state, grid };
}
