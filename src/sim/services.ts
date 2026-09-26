// Service coverage: every service building writes its staffed fraction into its layer within its radius, once
// per settlement. Homes read the layers for happiness; the treatment layer feeds waste routing. Lantern posts
// stand on walkways and light the night layer.
import { BUILDINGS, LANTERN_COST, LANTERN_RADIUS, SERVICE_KINDS, TAVERN_DRY_FACTOR, TAVERN_SMOKED_PER_CYCLE } from "./balance";
import { at } from "./fields";
import { cellIndex, Grid, HALF, inBounds } from "./grid";
import { Building, buildingList, Cell, notify, SimState } from "./state";
import { staffing } from "./workers";

function paint(layer: number[], cells: Cell[], radius: number, value: number): void {
  if (value <= 0) return;
  for (const c of cells) for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
    const i = c.i + di, j = c.j + dj;
    if (!inBounds(i, j)) continue;
    const k = cellIndex(i, j);
    if (layer[k] < value) layer[k] = value;
  }
}

/** Coverage a service building provides right now, 0..1. */
export function serviceStrength(state: SimState, b: Building): number {
  const def = BUILDINGS[b.kind];
  if (!def.service || !b.reached || b.cut) return 0;
  const s = def.workers > 0 ? staffing(b) : 1;
  if (b.kind === "tavern") {
    if (state.resources.smoked >= TAVERN_SMOKED_PER_CYCLE) { state.resources.smoked -= TAVERN_SMOKED_PER_CYCLE; return s; }
    return s * TAVERN_DRY_FACTOR;
  }
  return s;
}

/** Rebuild every coverage layer from the buildings. */
export function rebuildCoverage(state: SimState): void {
  const cov = state.fields.coverage;
  for (const k of SERVICE_KINDS) cov[k].fill(0);
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    const def = BUILDINGS[b.kind];
    if (def.service) paint(cov[def.service.kind], b.cells, def.service.radius, serviceStrength(state, b));
    if (b.lantern && b.reached && !b.cut) paint(cov.night, b.cells, LANTERN_RADIUS, 1);
  }
}

export function coverageAt(state: SimState, kind: keyof SimState["fields"]["coverage"], c: Cell): number {
  return at(state.fields.coverage[kind], c);
}

/** Why a lantern post can't go here, or null. */
export function lanternBlocker(state: SimState, grid: Grid, c: Cell): string | null {
  const b = grid.buildingAt(c);
  if (!b || (b.kind !== "walkway" && b.kind !== "raisedWalkway")) return "Lantern posts stand on walkways";
  if (b.lantern) return "Already lit";
  if (state.resources.money < LANTERN_COST) return `Costs ${LANTERN_COST}$`;
  return null;
}

export function addLantern(state: SimState, grid: Grid, c: Cell): boolean {
  if (lanternBlocker(state, grid, c)) return false;
  state.resources.money -= LANTERN_COST;
  grid.buildingAt(c)!.lantern = true;
  return true;
}

/** Every cell within `radius` of any cell in `cells` is inside the map (helper for tests). */
export function cellsWithin(cells: Cell[], radius: number): Cell[] {
  const out: Cell[] = [];
  for (const c of cells) for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
    const i = c.i + di, j = c.j + dj;
    if (i >= -HALF && i < HALF && j >= -HALF && j < HALF) out.push({ i, j });
  }
  return out;
}

export function lanternCount(state: SimState): number {
  let n = 0;
  for (const b of buildingList(state)) if (b.lantern) n++;
  return n;
}

export function announceLevel(state: SimState, b: Building): void {
  notify(state, `A ${BUILDINGS[b.kind].name.toLowerCase()} grew to level ${b.level}`);
}
