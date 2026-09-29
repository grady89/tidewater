// Sewers. Every street and pier (anything the walk runs through: walkways, paths, raised walkways, markets, piers,
// docks, the harbor) carries a sewer under it; a sewer pipe (state.sewers) carries one anywhere else: under buildings, over the flats and the hill,
// across deep water. Outfalls and treatment plants are part of the sewer they stand in or against. A connected run of
// sewer is a network. The waste of the homes on or beside it goes through its plants, up to what they can clean,
// and what is left out of its outfalls into the sea; a network with no outfall backs up, and a home no sewer reaches
// keeps a cesspit. Backed-up waste seeps into the ground at the home, and the home minds it (HAPPY.cesspit). The
// networks are derived from the layout (cached until a piece or pipe changes); nothing here is saved but the pipes.
import { SIM_TICK, SIZE, TIDE_PERIOD } from "../config";
import { BUILDINGS, CESSPIT_SEEP, SEWER_PIPE_COST, SEWER_PIPE_DEEP_COST, WASTE_PER_RESIDENT } from "./balance";
import { cellIndex, DIRS, Grid, HALF, inBounds } from "./grid";
import { UNBUILDABLE } from "./materials";
import { moveMoney } from "./money";
import { Building, Cell, Emitter, notify, SimState } from "./state";
import { levelCapacity } from "./upgrades";

const TICKS_PER_CYCLE = TIDE_PERIOD / SIM_TICK;

export interface SewerNet {
  id: number;
  /** Cell indices the network runs through. */
  cells: number[];
  outfalls: Building[];
  plants: Building[];
  /** Homes that drain into it. */
  homes: Building[];
}

export interface SewerMap {
  /** Cell index → network id, or -1 where no sewer runs. */
  net: Int32Array;
  nets: SewerNet[];
  /** Home id → the network it drains into; a home missing here has no sewer. */
  drainOf: Map<number, SewerNet>;
}

/** Street pieces and piers carry a sewer; so do the two pieces a sewer ends in. */
function carrier(b: Building | null): boolean {
  return !!b && (BUILDINGS[b.kind].network !== "leaf" || b.kind === "outfall" || b.kind === "treatmentPlant");
}

/** Is there sewer in this cell: a pipe, or a street, outfall or treatment plant standing on it? */
export function sewered(grid: Grid, c: Cell): boolean {
  return inBounds(c.i, c.j) && (grid.pipes[cellIndex(c.i, c.j)] === 1 || carrier(grid.buildingAt(c)));
}

function buildMap(state: SimState, grid: Grid): SewerMap {
  const net = new Int32Array(SIZE * SIZE).fill(-1);
  const nets: SewerNet[] = [];
  const on = (i: number, j: number) => grid.pipes[cellIndex(i, j)] === 1 || carrier(grid.buildingAtIJ(i, j));
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = cellIndex(i, j);
    if (net[k] >= 0 || !on(i, j)) continue;
    const n: SewerNet = { id: nets.length, cells: [], outfalls: [], plants: [], homes: [] };
    nets.push(n);
    net[k] = n.id;
    const queue = [k];
    while (queue.length) {
      const q = queue.pop()!;
      n.cells.push(q);
      const qi = Math.floor(q / SIZE) - HALF, qj = (q % SIZE) - HALF;
      for (const d of DIRS) {
        const ni = qi + d.i, nj = qj + d.j;
        if (!inBounds(ni, nj)) continue;
        const nk = cellIndex(ni, nj);
        if (net[nk] >= 0 || !on(ni, nj)) continue;
        net[nk] = n.id;
        queue.push(nk);
      }
    }
  }
  const drainOf = new Map<number, SewerNet>();
  for (const b of Object.values(state.buildings).sort((x, y) => x.id - y.id)) {
    if (b.kind === "outfall" || b.kind === "treatmentPlant") {
      const n = nets[net[cellIndex(b.cells[0].i, b.cells[0].j)]];
      (b.kind === "outfall" ? n.outfalls : n.plants).push(b);
      continue;
    }
    if (BUILDINGS[b.kind].residents === 0) continue;
    // A home drains into a sewer under it or against it; beside two, into the one with a way out.
    let best: SewerNet | null = null;
    for (const c of b.cells) for (const d of [{ i: 0, j: 0 }, ...DIRS]) {
      const i = c.i + d.i, j = c.j + d.j;
      if (!inBounds(i, j)) continue;
      const id = net[cellIndex(i, j)];
      if (id < 0) continue;
      const n = nets[id];
      if (!best || (!hasWayOut(best) && hasWayOut(n))) best = n;
    }
    if (best) { best.homes.push(b); drainOf.set(b.id, best); }
  }
  return { net, nets, drainOf };
}

function hasWayOut(n: SewerNet): boolean {
  return n.outfalls.length > 0 || n.plants.length > 0;
}

const maps = new WeakMap<Grid, { version: number; map: SewerMap }>();
/** The networks for the grid's layout, rebuilt only when a piece or a pipe has changed since. */
export function sewerMap(grid: Grid): SewerMap {
  const hit = maps.get(grid);
  if (hit && hit.version === grid.layoutVersion) return hit.map;
  const map = buildMap(grid.state, grid);
  maps.set(grid, { version: grid.layoutVersion, map });
  return map;
}

/** Where a network's waste goes this cycle: people's worth cleaned by its plants, carried out to sea, and backed up. */
export interface NetFlow { people: number; treated: number; toSea: number; backedUp: number }

/** Split a network's waste between its plants (by id, each up to its capacity), its outfalls and the homes' pits. */
export function netFlow(n: SewerNet): NetFlow {
  let people = 0;
  for (const h of n.homes) people += h.residents;
  let treated = 0;
  for (const p of n.plants) if (!p.damaged) treated += Math.min(people - treated, levelCapacity(p) ?? 0);
  const rest = people - treated;
  const out = n.outfalls.some(o => !o.damaged);
  return { people, treated, toSea: out ? rest : 0, backedUp: out ? 0 : rest };
}

/** The share of a home's waste that backs up into its cesspit (1 with no sewer at all), from the current layout. */
export function backedUpShare(grid: Grid, home: Building): number {
  const n = sewerMap(grid).drainOf.get(home.id);
  if (!n) return 1;
  const f = netFlow(n);
  return f.people > 0 ? f.backedUp / f.people : 0;
}

/** Every home's backed-up share at once (settlement: happiness reads it). */
export function backedUpShares(state: SimState, grid: Grid): Map<number, number> {
  const map = sewerMap(grid);
  const out = new Map<number, number>();
  for (const n of map.nets) {
    const f = netFlow(n);
    for (const h of n.homes) out.set(h.id, f.people > 0 ? f.backedUp / f.people : 0);
  }
  for (const b of Object.values(state.buildings)) if (BUILDINGS[b.kind].residents > 0 && !map.drainOf.has(b.id)) out.set(b.id, 1);
  return out;
}

/**
 * Settlement: this cycle's waste as per-tick pollution sources — out of the outfalls, split evenly, and seeping at
 * every home whose waste backs up. Plants record the people they cleaned for (output), outfalls the people they
 * carried for.
 */
export function drainSewage(state: SimState, grid: Grid, emitters: Emitter[]): void {
  const map = sewerMap(grid);
  const seep = (home: Building, share: number) => {
    if (share > 0 && home.residents > 0) emitters.push({ k: cellIndex(home.cells[0].i, home.cells[0].j), rate: home.residents * WASTE_PER_RESIDENT * share * CESSPIT_SEEP / TICKS_PER_CYCLE });
  };
  for (const n of map.nets) {
    const f = netFlow(n);
    let left = f.treated;
    for (const p of n.plants) { const c = p.damaged ? 0 : Math.min(left, levelCapacity(p) ?? 0); p.output = c; left -= c; }
    const open = n.outfalls.filter(o => !o.damaged);
    for (const o of n.outfalls) o.output = 0;
    if (f.toSea > 0) for (const o of open) {
      o.output = f.toSea / open.length;
      emitters.push({ k: cellIndex(o.cells[0].i, o.cells[0].j), rate: o.output * WASTE_PER_RESIDENT / TICKS_PER_CYCLE });
    }
    const share = f.people > 0 ? f.backedUp / f.people : 0;
    for (const h of n.homes) seep(h, share);
  }
  for (const b of Object.values(state.buildings).sort((x, y) => x.id - y.id)) {
    if (BUILDINGS[b.kind].residents > 0 && !map.drainOf.has(b.id)) seep(b, 1);
  }
}

/** What a pipe costs in this cell: dearer across deep water. */
export function pipeCost(grid: Grid, c: Cell): number {
  return grid.classAt(c) === "deep" ? SEWER_PIPE_DEEP_COST : SEWER_PIPE_COST;
}

/** Why a sewer pipe can't be laid in this cell, or null when it can (`money` false: whatever the purse holds). */
export function pipeBlocker(state: SimState, grid: Grid, c: Cell, money = true): string | null {
  if (!inBounds(c.i, c.j)) return "Off the map";
  if (grid.hasPipe(c)) return "A pipe runs here already";
  if (carrier(grid.buildingAt(c))) return "A sewer runs under every street and pier already";
  if (UNBUILDABLE.has(grid.materialAt(c))) return "Nothing is laid on the lava field";
  if (grid.onIsle([c]) && !grid.isleOpen()) return "Across the water: a harbor's ferry opens the isle";
  if (money && state.resources.money < pipeCost(grid, c)) return `Costs ${pipeCost(grid, c)}$`;
  return null;
}

export function layPipe(state: SimState, grid: Grid, c: Cell): boolean {
  if (pipeBlocker(state, grid, c)) return false;
  moveMoney(state, -pipeCost(grid, c), "sewer");
  grid.setPipe(c, true);
  if (state.sewers.length === 1) notify(state, "The first sewer pipe is down: a sewer runs under every street, pipes carry it anywhere else");
  return true;
}

/** Take up a pipe (nothing comes back: it stays in the mud). */
export function removePipe(grid: Grid, c: Cell): boolean {
  if (!grid.hasPipe(c)) return false;
  grid.setPipe(c, false);
  return true;
}
