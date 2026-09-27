// The land tools: landfill raises one flat cell to dry ground (the one way to make the tide's edge move, and
// priced so it is a decision, not a habit), planting adds a tree site on dry ground, clearing removes one.
// Landfill and planted trees live in the state; the grid re-applies landfill on attach.
import { LANDFILL_COST, LANDFILL_HEIGHT, PLANT_COST, CLEAR_TIMBER } from "./balance";
import { cellIndex, Grid, inBounds } from "./grid";
import { moveMoney } from "./money";
import { Cell, notify, SimState } from "./state";
import { treeSites } from "./trees";

export function landfillBlocker(state: SimState, grid: Grid, c: Cell): string | null {
  if (!inBounds(c.i, c.j)) return "Off the map";
  if (grid.classAt(c) !== "flat") return "Landfill goes on the flats";
  if (grid.buildingAt(c)) return "Occupied";
  if (grid.onIsle([c]) && !grid.isleOpen()) return "Across the water: a harbor's ferry opens the isle";
  const r = state.resources;
  if (r.money < LANDFILL_COST.money) return `Costs ${LANDFILL_COST.money}$ + ${LANDFILL_COST.timber} timber`;
  if (r.timber < LANDFILL_COST.timber) return `Costs ${LANDFILL_COST.money}$ + ${LANDFILL_COST.timber} timber`;
  return null;
}

/** Fill the cell: it becomes dry ground at LANDFILL_HEIGHT, for good. */
export function addLandfill(state: SimState, grid: Grid, c: Cell): boolean {
  if (landfillBlocker(state, grid, c)) return false;
  moveMoney(state, -LANDFILL_COST.money, "landfill");
  state.resources.timber -= LANDFILL_COST.timber;
  state.landfill.push(cellIndex(c.i, c.j));
  grid.applyLandfill(c);
  if (state.landfill.length === 1) notify(state, "Fill raised the flat above the tide: the ground there is dry now");
  return true;
}

/** The tree site standing in a cell, if any (index into treeSites). */
export function treeAt(state: SimState, c: Cell): number {
  const sites = treeSites(state);
  for (let k = 0; k < sites.length; k++) if (state.trees[k] >= 0 && sites[k].cell.i === c.i && sites[k].cell.j === c.j) return k;
  return -1;
}

export function plantBlocker(state: SimState, grid: Grid, c: Cell): string | null {
  if (!inBounds(c.i, c.j)) return "Off the map";
  if (grid.classAt(c) !== "high") return "Trees grow on dry ground";
  if (grid.buildingAt(c)) return "Occupied";
  if (treeAt(state, c) >= 0) return "A tree stands here";
  if (state.resources.money < PLANT_COST) return `Costs ${PLANT_COST}$`;
  return null;
}

/** Plant a sapling: a new site, age 0, that grows like a felled tree regrows. */
export function plantTree(state: SimState, grid: Grid, c: Cell): boolean {
  if (plantBlocker(state, grid, c)) return false;
  moveMoney(state, -PLANT_COST, "plant");
  const x = c.i + 0.5, z = c.j + 0.5;
  state.extraTrees.push({ x, z, s: 1.0, cell: { i: c.i, j: c.j } });
  state.trees.push(0.05);
  return true;
}

export function clearBlocker(state: SimState, _grid: Grid, c: Cell): string | null {
  if (treeAt(state, c) < 0) return "No tree here";
  return null;
}

/** Take a tree out for good; a grown one yields a little timber. */
export function clearTree(state: SimState, grid: Grid, c: Cell): boolean {
  if (clearBlocker(state, grid, c)) return false;
  const k = treeAt(state, c);
  if (state.trees[k] >= 1) state.resources.timber += CLEAR_TIMBER;
  state.trees[k] = -1;
  return true;
}

export { LANDFILL_HEIGHT };
