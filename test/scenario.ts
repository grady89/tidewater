// Scripted towns shared by the unit tests and the smoke scenario (which imports this module into the page
// through the Vite dev server). Sim-only: no Babylon.
import { MAX_LINE, routePath } from "../src/build/line";
import { BuildingKind, BUILDINGS, SWIM_RADIUS } from "../src/sim/balance";
import { buyBoat, tryPlace } from "../src/sim/economy";
import { sheltered } from "../src/sim/events";
import { Grid } from "../src/sim/grid";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { treeSites } from "../src/sim/trees";

/**
 * tryPlace, felling any standing tree on the footprint first — what a player does from the Land tab before
 * building on a wooded cell — and only when the tree was the one thing in the way (the trees come back otherwise).
 */
function tryPlaceClearing(state: SimState, grid: Grid, kind: BuildingKind, anchor: Cell, lift = 0, rot: number | null = null): Building | null {
  const cells = grid.footprint(kind, anchor, rot ?? 0);
  if (!cells || !grid.treeOn(cells)) return tryPlace(state, grid, kind, anchor, lift, rot);
  const sites = treeSites(state);
  const felled: number[] = [];
  for (let k = 0; k < sites.length; k++) if (state.trees[k] >= 0 && cells.some(c => c.i === sites[k].cell.i && c.j === sites[k].cell.j)) felled.push(k);
  const saved = felled.map(k => state.trees[k]);
  for (const k of felled) state.trees[k] = -1;
  const b = tryPlace(state, grid, kind, anchor, lift, rot);
  if (!b) felled.forEach((k, at) => { state.trees[k] = saved[at]; });
  return b;
}
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
    const kind: BuildingKind = floodFate(grid.floorFor("walkway", [cur])) === "safe" ? "walkway" : "raisedWalkway";
    if (!tryPlaceClearing(state, grid, kind, cur)) break;
    laid.push(cur);
    if (grid.neighbors(cur).some(n => n.i === target.i && n.j === target.j)) break;
    const next: Cell[] = grid.neighbors(cur)
      .filter(c => grid.classAt(c) === "flat" && !seen.has(c.i + "," + c.j) && !grid.buildingAt(c))
      .sort((a, b) => dist(a, target) - dist(b, target));
    cur = next[0] ?? null;
  }
  return laid;
}

/**
 * Extend the street by `n` raised walkways (they never flood), each on the free flat cell next to the street with
 * the most free flat neighbours, so houses have somewhere to go.
 */
export function growStreet(state: SimState, grid: Grid, n: number): number {
  let laid = 0;
  for (let k = 0; k < n; k++) {
    const links = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path");
    let best: Cell | null = null, bs = -1;
    const consider = (cells: Cell[]) => { for (const l of cells) for (const c of grid.neighbors(l)) {
      if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
      const free = grid.neighbors(c).filter(x => grid.classAt(x) === "flat" && !grid.buildingAt(x)).length;
      if (free > bs) { bs = free; best = c; }
    } };
    consider(links.map(l => l.cells[0]));
    // Boxed in (a starter whose huts ring its two walkways): grow off the market's edge, itself a street link.
    if (!best) consider(buildingList(state).filter(b => b.kind === "market").flatMap(m => m.cells));
    if (!best || !tryPlaceClearing(state, grid, "raisedWalkway", best)) break;
    laid++;
  }
  return laid;
}

/** Place up to `count` of `kind` where the footprint covers a cell next to a walkway (standard or raised). */
export function placeByWalkway(state: SimState, grid: Grid, kind: BuildingKind, count = 1): Building[] {
  const out: Building[] = [];
  const { w, d } = BUILDINGS[kind];
  const walkways = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path"); // a path is a street too (the motu, the hill)
  for (const wk of walkways) {
    if (out.length >= count) break;
    for (const n of grid.neighbors(wk.cells[0])) {
      if (out.length >= count) break;
      // Every anchor whose footprint would cover the neighbour cell.
      for (let di = 0; di < w && out.length < count; di++) for (let dj = 0; dj < d && out.length < count; dj++) {
        const b = tryPlaceClearing(state, grid, kind, { i: n.i - di, j: n.j - dj });
        if (b) { out.push(b); break; }
      }
    }
  }
  return out;
}

/** BFS over unbuilt flat cells from the street to the nearest flat cell touching high ground; lays walkways along it. */
export function reachHill(state: SimState, grid: Grid): Cell | null {
  const links = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
  const prev = new Map<string, Cell | null>();
  const key = (c: Cell) => c.i + "," + c.j;
  const queue: Cell[] = [];
  for (const l of links) for (const n of grid.neighbors(l.cells[0])) {
    if (grid.classAt(n) !== "flat" || grid.buildingAt(n) || prev.has(key(n))) continue;
    prev.set(key(n), null); queue.push(n);
  }
  let end: Cell | null = null;
  for (let head = 0; head < queue.length && !end; head++) {
    const c = queue[head];
    if (grid.neighbors(c).some(n => grid.classAt(n) === "high")) { end = c; break; }
    for (const n of grid.neighbors(c)) {
      if (grid.classAt(n) !== "flat" || grid.buildingAt(n) || prev.has(key(n))) continue;
      prev.set(key(n), c); queue.push(n);
    }
  }
  if (!end) return null;
  const path: Cell[] = [];
  for (let c: Cell | null = end; c; c = prev.get(key(c)) ?? null) path.push(c);
  // The hill road must survive spring tides too, or the camp idles every fourth cycle.
  for (const c of path.reverse()) {
    const kind: BuildingKind = floodFate(grid.floorFor("walkway", [c])) === "safe" ? "walkway" : "raisedWalkway";
    if (!tryPlaceClearing(state, grid, kind, c)) return null;
  }
  return end;
}

/** A lumber camp on the hill by the street's end: any anchor near it whose footprint the sim accepts. */
export function placeLumberCamp(state: SimState, grid: Grid, streetEnd: Cell): Building | null {
  const anchors: Cell[] = [];
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) anchors.push({ i: streetEnd.i + di, j: streetEnd.j + dj });
  anchors.sort((a, b) => dist(a, streetEnd) - dist(b, streetEnd));
  for (const anchor of anchors) {
    const b = tryPlaceClearing(state, grid, "lumberCamp", anchor);
    if (b) return b;
  }
  return null;
}

/** An edge-class building (pier, outfall, shipyard) on the nearest free shore site at least `minDist` from `near`. */
export function placeEdge(state: SimState, grid: Grid, kind: BuildingKind, near: Cell, minDist = 0): Building | null {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep") continue;
    const fp = grid.footprint(kind, c);
    if (!fp || !grid.canPlace(kind, fp)) continue;
    const d = dist(c, near);
    if (d >= minDist && d < bd) { bd = d; best = c; }
  }
  return best ? tryPlaceClearing(state, grid, kind, best) : null;
}

/** Another pier (a berth for shipyard boats), on the nearest free shore site to `near`. */
export function placeSecondPier(state: SimState, grid: Grid, near: Cell): Building | null {
  return placeEdge(state, grid, "pier", near, 2);
}

/** Beach cells within swimming reach of the town's homes. */
export function beachesNear(state: SimState, grid: Grid): Cell[] {
  const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0);
  const out: Cell[] = [];
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.isBeach(c) && homes.some(h => h.cells.some(x => Math.abs(x.i - i) <= SWIM_RADIUS && Math.abs(x.j - j) <= SWIM_RADIUS))) out.push(c);
  }
  return out;
}

/** A pier full of boats as close as possible to a beach the residents swim from: fish waste where the swimmers are. */
export function pierByBeach(state: SimState, grid: Grid): { pier: Building; beach: Cell } | null {
  const beaches = beachesNear(state, grid);
  let best: { c: Cell; beach: Cell; d: number } | null = null;
  for (const beach of beaches) {
    for (let di = -6; di <= 6; di++) for (let dj = -6; dj <= 6; dj++) {
      const c = { i: beach.i + di, j: beach.j + dj };
      if (grid.classAt(c) !== "deep") continue;
      const fp = grid.footprint("pier", c);
      if (!fp || !grid.canPlace("pier", fp)) continue;
      const d = Math.max(Math.abs(di), Math.abs(dj));
      if (!best || d < best.d) best = { c, beach, d };
    }
  }
  if (!best) return null;
  const pier = tryPlaceClearing(state, grid, "pier", best.c);
  if (!pier) return null;
  pier.boats = BUILDINGS.pier.slots ?? 2; // the shipyard would fill it in time; the ledger takes it directly here
  return { pier, beach: best.beach };
}

/**
 * One breakwater two or three cells off every pier, dock and harbor: enough to count as shelter from storms and
 * the wave without walling the boats in (the sea BFS can't pass built cells).
 */
export function shelterHarbours(state: SimState, grid: Grid): number {
  let laid = 0;
  for (const h of buildingList(state).filter(b => (BUILDINGS[b.kind].slots ?? 0) > 0)) {
    if (sheltered(grid, h)) continue;
    let done = false;
    for (let r = 2; r <= 3 && !done; r++) for (const c of h.cells) {
      for (let di = -r; di <= r && !done; di++) for (let dj = -r; dj <= r && !done; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const n = { i: c.i + di, j: c.j + dj };
        if (grid.classAt(n) === "deep" && !grid.buildingAt(n) && tryPlaceClearing(state, grid, "breakwater", n)) { laid++; done = true; }
      }
      if (done) break;
    }
  }
  return laid;
}

/**
 * A big town for the performance check: streets of raised walkways across the flats with homes packed along
 * them, piers (boats set in the ledger) along the shore, and every home filled. Returns what it managed.
 */
export function bigTown(state: SimState, grid: Grid, target = { buildings: 300, boats: 30 }): { buildings: number; boats: number; residents: number } {
  state.resources.money += 100000; state.resources.planks += 5000; state.resources.timber += 5000;
  // Streets first (homes would block the street's growth), then workplaces for a couple of hundred jobs, then
  // homes along the rest, then more streets if short.
  growStreet(state, grid, 130);
  placeByWalkway(state, grid, "market", 4);
  placeByWalkway(state, grid, "smokehouse", 15);
  placeByWalkway(state, grid, "clamCamp", 15);
  placeByWalkway(state, grid, "oysterBed", 20);
  placeByWalkway(state, grid, "sawmill", 6);
  placeByWalkway(state, grid, "well", 2);
  placeByWalkway(state, grid, "tavern", 2);
  placeByWalkway(state, grid, "house", 100);
  for (let k = 0; k < 8 && buildingList(state).length < target.buildings; k++) {
    if (growStreet(state, grid, 20) === 0) break;
    placeByWalkway(state, grid, "hut", 40);
  }
  // Piers all along the shore, two boats each.
  let boats = 0;
  for (let k = 0; k < 40 && boats < target.boats; k++) {
    const p = placeEdge(state, grid, "pier", { i: 0, j: 0 }, 0);
    if (!p) break;
    p.boats = 2; boats += 2;
  }
  // Everyone moves in at once.
  let residents = 0;
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) { b.residents = grid.capacityOf(b); residents += b.residents; }
  // The flats run out before 300 on this island; breakwater cells (real meshes, real ledger entries) make up the rest.
  for (let r = 3; r < 12 && buildingList(state).length < target.buildings; r++) {
    for (const h of buildingList(state).filter(b => b.kind === "pier")) {
      if (buildingList(state).length >= target.buildings) break;
      for (let di = -r; di <= r && buildingList(state).length < target.buildings; di++) for (let dj = -r; dj <= r && buildingList(state).length < target.buildings; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const c = { i: h.cells[0].i + di, j: h.cells[0].j + dj };
        if (grid.classAt(c) === "deep" && !grid.buildingAt(c) && (di + dj) % 2 === 0) tryPlaceClearing(state, grid, "breakwater", c);
      }
    }
  }
  return { buildings: buildingList(state).length, boats, residents };
}

/** The harbor: 3×3 of water deeper than 1.5, nearest `near`. */
export function placeHarbor(state: SimState, grid: Grid, near: Cell): Building | null {
  let best: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    const fp = grid.classAt(c) === "deep" ? grid.footprint("harbor", c) : null;
    if (!fp || !grid.canPlace("harbor", fp)) continue;
    const d = dist(c, near);
    if (d < bd) { bd = d; best = c; }
  }
  return best ? tryPlaceClearing(state, grid, "harbor", best) : null;
}

/**
 * Raised walkways from a sea piece (harbor, dock) over open water to the nearest mainland street or pier, so the
 * piece joins the walk network. Empty when nothing is within `max` cells.
 */
export function bridgeTo(state: SimState, grid: Grid, from: Building, max = 16): Building[] {
  const key = (c: Cell) => c.i + "," + c.j;
  const own = new Set(from.cells.map(key));
  const isLink = (c: Cell) => { const b = grid.buildingAt(c); return !!b && b.id !== from.id && BUILDINGS[b.kind].network !== "leaf" && !grid.onIsle(b.cells); };
  const open = (c: Cell) => !own.has(key(c)) && !grid.buildingAt(c) && !grid.onIsle([c]) && grid.canPlace("raisedWalkway", [c]);
  const prev = new Map<string, Cell | null>();
  const queue: Cell[] = [];
  for (const c of from.cells) for (const n of grid.neighbors(c)) {
    if (prev.has(key(n)) || !open(n)) continue;
    prev.set(key(n), null); queue.push(n);
  }
  let end: Cell | null = null;
  for (let head = 0; head < queue.length && !end; head++) {
    const c = queue[head];
    if (grid.neighbors(c).some(isLink)) { end = c; break; }
    for (const n of grid.neighbors(c)) {
      if (prev.has(key(n)) || !open(n)) continue;
      prev.set(key(n), c); queue.push(n);
    }
  }
  if (!end) return [];
  const path: Cell[] = [];
  for (let c: Cell | null = end; c; c = prev.get(key(c)) ?? null) path.push(c);
  if (path.length > max) return [];
  const laid: Building[] = [];
  for (const c of path.reverse()) { const b = tryPlaceClearing(state, grid, "raisedWalkway", c); if (!b) break; laid.push(b); }
  return laid;
}

/** A first settlement on the isle (needs the harbor's ferry): a pier on its shore, a raised walkway inland, huts. */
export function settleIsle(state: SimState, grid: Grid): { pier: Building | null; walkways: Building[]; huts: Building[] } {
  const centre = { i: 22, j: 22 };
  const pier = placeEdge(state, grid, "pier", centre);
  const walkways: Building[] = [], huts: Building[] = [];
  if (!pier) return { pier, walkways, huts };
  // From the pier's landward cell, step to whichever free neighbour brings the street nearest the isle's centre.
  let cur = pier.cells.slice().sort((a, b) => dist(a, centre) - dist(b, centre))[0];
  for (let k = 0; k < 4; k++) {
    const options = grid.neighbors(cur).filter(n => !grid.buildingAt(n)).sort((a, b) => dist(a, centre) - dist(b, centre));
    let w: Building | null = null, next: Cell = cur;
    for (const o of options) { w = tryPlaceClearing(state, grid, "raisedWalkway", o); if (w) { next = o; break; } }
    if (!w) break;
    walkways.push(w);
    cur = next;
    for (const n of grid.neighbors(next)) {
      if (huts.length >= 3 || grid.buildingAt(n)) continue;
      const h = tryPlaceClearing(state, grid, "hut", n);
      if (h) huts.push(h);
    }
  }
  return { pier, walkways, huts };
}

/** Deep cells against the shore that take a shipyard, nearest the street. */
export function placeShipyard(state: SimState, grid: Grid, near: Cell): Building | null {
  return placeEdge(state, grid, "shipyard", near);
}

/**
 * The starter town around the free hut: pier, two boats, walkways to the hut, two more huts, a market.
 * Everything paid from the 500$ start.
 */
export function starterTown(state: SimState, grid: Grid): { pier: Building; huts: Building[]; market: Building | null; walkways: Cell[] } {
  const hut0 = buildingList(state).find(b => b.kind === "hut");
  if (!hut0) throw new Error("starter town needs the seeded hut (use newGame)");
  const site = pierSite(grid, hut0.cells[0]);
  const pier = tryPlaceClearing(state, grid, "pier", site);
  if (!pier) throw new Error("could not place pier");
  buyBoat(state, pier);
  buyBoat(state, pier);
  const walkways = layWalkways(state, grid, site, hut0.cells[0]);
  // On a coast where the greedy walk stalls short of the hut (the Fjord's banks), finish with an L of walkways.
  if (!grid.touchesWalkway(hut0.cells) && walkways.length) {
    const last = walkways[walkways.length - 1], to = hut0.cells[0];
    let c = { ...last };
    while (c.i !== to.i || c.j !== to.j) {
      if (c.i !== to.i) c = { i: c.i + Math.sign(to.i - c.i), j: c.j }; else c = { i: c.i, j: c.j + Math.sign(to.j - c.j) };
      if (c.i === to.i && c.j === to.j) break;
      if (grid.buildingAt(c)) continue;
      const w = tryPlaceClearing(state, grid, "walkway", c) ?? tryPlaceClearing(state, grid, "raisedWalkway", c);
      if (w) walkways.push(c);
    }
  }
  const huts = [hut0, ...placeByWalkway(state, grid, "hut", 2)];
  let market = placeByWalkway(state, grid, "market", 1)[0] ?? null;
  // A narrow shore (the Fjord's ledges) may leave no 2×2 by the first walkways: grow the street until one fits.
  for (let k = 0; k < 6 && !market; k++) { if (!growStreet(state, grid, 1)) break; market = placeByWalkway(state, grid, "market", 1)[0] ?? null; }
  // The change from the 500$ buys the outfall, so waste doesn't pile up while the town grows.
  placeEdge(state, grid, "outfall", site, 3);
  return { pier, huts, market, walkways };
}

/** The nearest cell to `near` where `kind` can go, or null. */
export function placeNear(state: SimState, grid: Grid, kind: BuildingKind, near: Cell): Building | null {
  const cells: Cell[] = [];
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) cells.push({ i, j });
  cells.sort((a, b) => dist(a, near) - dist(b, near));
  for (const c of cells) { const b = tryPlaceClearing(state, grid, kind, c); if (b) return b; }
  return null;
}

/**
 * Extend the street by `n` pieces over flats or dry land alike (a path where the ground is dry, a walkway below
 * that), each on the free land cell next to the street with the most free land neighbours: the biome towns use it
 * where the flats run out (the Atoll's motu, the Fjord's ledges). Tidewater's scripts keep growStreet.
 */
export function growStreetAny(state: SimState, grid: Grid, n: number): number {
  let laid = 0;
  const land = (c: Cell) => grid.classAt(c) === "flat" || grid.classAt(c) === "high";
  for (let k = 0; k < n; k++) {
    const links = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path");
    let best: Cell | null = null, bs = -1;
    const consider = (cells: Cell[]) => { for (const l of cells) for (const c of grid.neighbors(l)) {
      if (!land(c) || grid.buildingAt(c)) continue;
      const free = grid.neighbors(c).filter(x => land(x) && !grid.buildingAt(x)).length;
      if (free > bs) { bs = free; best = c; }
    } };
    consider(links.map(l => l.cells[0]));
    if (!best) consider(buildingList(state).filter(b => b.kind === "market").flatMap(m => m.cells));
    if (!best || !layLink(state, grid, best)) break;
    laid++;
  }
  return laid;
}

/** Lay whichever street piece fits on a cell: a path on dry ground, a walkway on the flats, a raised one over water. */
function layLink(state: SimState, grid: Grid, c: Cell): Building | null {
  return tryPlaceClearing(state, grid, "path", c) ?? tryPlaceClearing(state, grid, "walkway", c) ?? tryPlaceClearing(state, grid, "raisedWalkway", c);
}
const isLink = (b: Building | null) => !!b && (b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path" || b.kind === "market" || b.kind === "pier" || b.kind === "dock" || b.kind === "harbor");

/**
 * Join a building to the street: a straight run of street pieces from `from` toward `to` (whatever fits on each
 * free cell), then, if the target still touches no link (a house sat in the way), the shortest free route from the
 * target's footprint to any link, up to eight cells out. Returns how many pieces went down.
 */
export function joinByLine(state: SimState, grid: Grid, from: Cell, to: Cell): number {
  let laid = 0;
  // First the game's own route: the street kinds in the order the player's drag would lay them, stepping within
  // a path's rise, round trees and off cliffs.
  const kinds: BuildingKind[] = ["path", "walkway", "raisedWalkway"];
  const kindAt = (c: Cell): BuildingKind | null => { for (const k of kinds) { const fp = grid.footprint(k, c); if (fp && grid.canPlace(k, fp)) return k; } return null; };
  const fits = (c: Cell) => kindAt(c) !== null;
  const step = (p: Cell, q: Cell) => grid.stepOk(kindAt(p) ?? "walkway", p, kindAt(q) ?? "walkway", q);
  const route = routePath(from, to, fits, MAX_LINE, { step, startCells: grid.buildingAt(from)?.cells, goalCells: grid.buildingAt(to)?.cells });
  if (route) { for (const c of route) if (layLink(state, grid, c)) laid++; if (laid) return laid; }
  const steps = Math.max(Math.abs(to.i - from.i), Math.abs(to.j - from.j));
  for (let k = 1; k < steps; k++) {
    const c = { i: Math.round(from.i + (to.i - from.i) * k / steps), j: Math.round(from.j + (to.j - from.j) * k / steps) };
    if (grid.buildingAt(c)) continue;
    if (layLink(state, grid, c)) laid++;
  }
  const target = grid.buildingAt(to);
  if (!target || target.cells.some(c => grid.neighbors(c).some(n => isLink(grid.buildingAt(n))))) return laid;
  // BFS over free cells from the footprint's neighbours to the first cell that touches a link; lay the route back.
  const key = (c: Cell) => c.i + "," + c.j;
  const prev = new Map<string, Cell | null>();
  const queue: Cell[] = [];
  for (const c of target.cells) for (const n of grid.neighbors(c)) if (!grid.buildingAt(n) && !prev.has(key(n))) { prev.set(key(n), null); queue.push(n); }
  let end: Cell | null = null;
  for (let head = 0; head < queue.length && !end && head < 400; head++) {
    const c = queue[head];
    if (grid.neighbors(c).some(n => isLink(grid.buildingAt(n)))) { end = c; break; }
    for (const n of grid.neighbors(c)) if (!grid.buildingAt(n) && !prev.has(key(n)) && dist(n, to) < 9) { prev.set(key(n), c); queue.push(n); }
  }
  for (let c: Cell | null = end; c; c = prev.get(key(c)) ?? null) if (layLink(state, grid, c)) laid++;
  return laid;
}

/**
 * The starter town plus the coast's own kinds, wherever the catalog has them: the Fjord's racks, ice house,
 * mine and whaling station; the Atoll's grove, pearl house, dive platform and nursery; a toolworks anywhere.
 * `grant` is added to the purse first (the base starter spends the 650$); pass an existing starter town to build on it.
 */
export function biomeTown(state: SimState, grid: Grid, grant = 3000, town: ReturnType<typeof starterTown> = starterTown(state, grid)): { town: ReturnType<typeof starterTown>; extras: Partial<Record<BuildingKind, Building>> } {
  state.resources.money += grant; state.resources.planks += 100;
  growStreet(state, grid, 8);
  const extras: Partial<Record<BuildingKind, Building>> = {};
  const flats: BuildingKind[] = ["stockfishRacks", "iceHouse", "coconutGrove", "pearlHouse", "toolworks"];
  for (const kind of flats) {
    if (!grid.inCatalog(kind)) continue;
    let b = placeByWalkway(state, grid, kind, 1)[0];
    for (let k = 0; k < 6 && !b; k++) { if (!growStreet(state, grid, 2) && !growStreetAny(state, grid, 2)) break; b = placeByWalkway(state, grid, kind, 1)[0]; } // narrow ledges and motu: more street, over dry land too
    if (b) extras[kind] = b;
  }
  placeByWalkway(state, grid, "house", 3);
  if (grid.inCatalog("ironMine")) {
    const mine = placeNear(state, grid, "ironMine", town.market?.cells[0] ?? town.pier.cells[0]);
    if (mine) { extras.ironMine = mine; joinByLine(state, grid, town.market?.cells[0] ?? town.pier.cells[0], mine.cells[0]); }
  }
  if (grid.inCatalog("whalingStation")) {
    const station = placeEdge(state, grid, "whalingStation", town.pier.cells[0], 6);
    if (station) { extras.whalingStation = station; bridgeTo(state, grid, station); }
  }
  for (const kind of ["divePlatform", "reefNursery"] as const) if (grid.inCatalog(kind)) { const b = placeNear(state, grid, kind, town.pier.cells[0]); if (b) extras[kind] = b; }
  return { town, extras };
}
