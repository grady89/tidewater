// Service coverage: every service building writes its staffed fraction into its layer within its radius, once
// per settlement, and homes read the layers for happiness. A service that serves a number of people (a well: its
// level's capacity, sim/upgrades.ts) paints its reach the same way, but the homes in reach share what it can give,
// nearest first: a home past its capacity gets only its share. Lantern posts stand on walkways and light the night layer.
import { BuildingKind, BUILDINGS, LANTERN_COST, LANTERN_RADIUS, SERVICE_KINDS, TAVERN_DRY_FACTOR, TAVERN_SMOKED_PER_CYCLE, UPGRADES } from "./balance";
import { biomeFor } from "./biomes";
import { at } from "./fields";
import { cellIndex, Grid, inBounds } from "./grid";
import { moveMoney } from "./money";
import { Building, buildingList, Cell, notify, SimState } from "./state";
import { levelCapacity } from "./upgrades";
import { staffing } from "./workers";

/** A service whose level is a number of people it can serve (the well), rather than a reach. */
export function servesPeople(kind: BuildingKind): boolean {
  const u = UPGRADES[kind];
  return !!u && !u.reach && !!BUILDINGS[kind].service;
}

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
  if (!def.service || !b.reached || b.cut || b.damaged) return 0;
  const s = def.workers > 0 ? staffing(b) : 1;
  const coast = biomeFor(state).serviceStrength;
  if (b.kind === "tavern") {
    if (state.resources.smoked >= TAVERN_SMOKED_PER_CYCLE) { state.resources.smoked -= TAVERN_SMOKED_PER_CYCLE; return coast ? coast(state, b, s) : s; }
    return coast ? coast(state, b, s * TAVERN_DRY_FACTOR) : s * TAVERN_DRY_FACTOR;
  }
  return coast ? coast(state, b, s) : s;
}

/** A service building's radius on this coast (the Dunes' wells reach 3). */
export function serviceRadius(state: SimState, b: Building): number {
  const own = biomeFor(state).serviceRadius?.[b.kind];
  if (own !== undefined) return own;
  if (UPGRADES[b.kind]?.reach) return levelCapacity(b)!;
  return BUILDINGS[b.kind].service?.radius ?? 0;
}

/** Rebuild every coverage layer from the buildings. */
export function rebuildCoverage(state: SimState, grid: Grid | null = null): void {
  const dimmed = grid ? biomeFor(state).lanternDimmed : undefined;
  const cov = state.fields.coverage;
  for (const k of SERVICE_KINDS) cov[k].fill(0);
  const shared: Building[] = [];
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    const def = BUILDINGS[b.kind];
    if (def.service) { if (servesPeople(b.kind)) shared.push(b); else paint(cov[def.service.kind], b.cells, serviceRadius(state, b), serviceStrength(state, b)); }
    if (b.lantern && b.reached && !b.cut && !(dimmed && grid && dimmed(state, grid, b))) paint(cov.night, b.cells, LANTERN_RADIUS, 1);
  }
  if (grid) for (const src of biomeFor(state).coverage?.(state, grid) ?? []) paint(cov[src.kind], src.cells, src.radius, src.value);
  if (shared.length) shareOut(state, shared);
}

/** Chebyshev distance between two footprints. */
function gap(a: Cell[], b: Cell[]): number {
  let d = Infinity;
  for (const p of a) for (const q of b) d = Math.min(d, Math.max(Math.abs(p.i - q.i), Math.abs(p.j - q.j)));
  return d;
}

/**
 * The people-serving services (by id): each paints its reach, then gives what its level can to the occupied homes
 * in reach that the unlimited sources (a river, an oasis, a great cistern) don't already serve, nearest first. A
 * home's cells then hold the share of its people served. Each records the people it served (output).
 */
function shareOut(state: SimState, providers: Building[]): void {
  const homes = buildingList(state).filter(h => BUILDINGS[h.kind].residents > 0 && h.residents > 0).sort((x, y) => x.id - y.id);
  for (const kind of SERVICE_KINDS) {
    const mine = providers.filter(p => BUILDINGS[p.kind].service!.kind === kind);
    if (!mine.length) continue;
    const layer = state.fields.coverage[kind];
    const free = layer.slice();
    const got = new Map<number, number>();
    for (const p of mine) {
      p.output = 0;
      const s = serviceStrength(state, p), r = serviceRadius(state, p);
      if (s <= 0) continue;
      paint(layer, p.cells, r, s);
      let left = levelCapacity(p)!;
      const near = homes.filter(h => free[cellIndex(h.cells[0].i, h.cells[0].j)] < 1 && gap(h.cells, p.cells) <= r)
        .sort((x, y) => gap(x.cells, p.cells) - gap(y.cells, p.cells) || x.id - y.id);
      for (const h of near) {
        if (left <= 0) break;
        const give = Math.min(h.residents - (got.get(h.id) ?? 0), left);
        if (give <= 0) continue;
        got.set(h.id, (got.get(h.id) ?? 0) + give);
        left -= give;
      }
      p.output = levelCapacity(p)! - left;
    }
    for (const h of homes) {
      const k0 = cellIndex(h.cells[0].i, h.cells[0].j);
      if (layer[k0] === free[k0]) continue; // no people-serving service reaches it
      const v = Math.max(free[k0], Math.min(1, (got.get(h.id) ?? 0) / h.residents));
      for (const c of h.cells) layer[cellIndex(c.i, c.j)] = v;
    }
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
  moveMoney(state, -LANTERN_COST, "lantern");
  grid.buildingAt(c)!.lantern = true;
  return true;
}

export function announceLevel(state: SimState, b: Building): void {
  notify(state, `A ${BUILDINGS[b.kind].name.toLowerCase()} grew to level ${b.level}`);
}
