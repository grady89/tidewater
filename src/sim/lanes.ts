// Sea lanes (BIOMES.md §4) and the World ledger, behind LANES_ENABLED (config.ts). Every built sea but the one being
// played settles quietly — once per TIDE_PERIOD while the World is up, once per active peak from inside a sea — and
// then the World settles what crosses between them, in a fixed order so the result never depends on which sea went
// first:
//   1. cargo and passengers in transit sail one hop (a hop a cycle; a lane carries its end's cargo ships × the hold;
//      a hub passes only what its warehouses can hold overnight), and what reaches its sea is landed;
//   2. the seas' outboxes are read (an eruption's wave goes to every built neighbour);
//   3. storms drift a face a cycle across the World (the sea they will reach next sees them a cycle early);
//   4. new consignments are loaded (surplus toward want, by shortest lane path) and migrants board;
//   5. the Trade Company's ship is routed: one harbor a cycle along each connected group of harbors.
// A lane joins two built faces that share an edge and both have a harbor. Events for a sea that is not being
// played wait in the ledger (`pending`) until it is entered. Sim-only: sectors and the ledger are read and written
// through the injected Store; face adjacency is the dodecahedron's own table.
import { LANES_ENABLED, PIRATES_ENABLED } from "../config";
import { FACES as FACE_LIST } from "../globe/geometry";
import {
  BUILDINGS, CARGO_HOLD, CARGO_SHIPS_PER_HARBOR, COMPANY_SLIDE_RECOVERY, COMPANY_SLIDE_UNITS,
  FORT_RAID_FACTOR, HUB_BASE_PASS, IMMIGRATION_HAPPINESS, PIRATE_DECAY, PIRATE_GROWTH_PER_UNIT, PIRATE_RAID_CHANCE, LANE_FOOD_SHARE, LANE_RESERVE_FRACTION, LANE_WANT_FRACTION, MIGRANTS_PER_CYCLE, WAREHOUSE_CAP,
  WORLD_STORM_CHANCE, WORLD_STORM_FIRST, WORLD_STORM_LIFE,
} from "./balance";
import { biomeFor } from "./biomes";
import { addCapped, capFor, settleCycle, shiftEnd, shiftStart } from "./economy";
import { startStorm, warnTsunami } from "./events";
import { foodTotal } from "./food";
import { GOOD_IDS, GoodId, GOODS } from "./goods";
import { Grid } from "./grid";
import { updateNetwork } from "./network";
import { readMeta, readSector, SectorMeta, Store, writeSector } from "./sectors";
import { buildingList, notify, population, SimState, WorldEvent } from "./state";
import { peakLevel, troughLevel } from "./tide";
import { harborOf } from "./trade";

/** Faces sharing an edge with `face`. */
export function neighboursOf(face: number): readonly number[] {
  return FACE_LIST[face].neighbours;
}

// ---------- the ledger ----------

/** Goods (or passengers) on their way: the lane path, and the index of the face they are at now. */
export interface Consignment {
  id: number;
  good: GoodId | "people";
  units: number;
  path: number[];
  at: number;
}
/** A storm crossing the World: where it is, where it goes next, how many cycles it has blown. */
export interface WorldStorm { id: number; face: number; next: number; age: number }
/** What a sea took in and sent out at the last World settlement (the card and the Trade panel). */
export interface FaceTrade { imports: Partial<Record<GoodId, number>>; exports: Partial<Record<GoodId, number>>; arrived: number; left: number }

export interface WorldLedger {
  version: 1;
  /** World settlements so far. */
  cycle: number;
  /** The World's own seeded RNG (the storms' births and drift). */
  rng: number;
  nextId: number;
  consignments: Consignment[];
  storms: WorldStorm[];
  /** Events waiting for a sea that is not being played (by face), applied when it is entered. */
  pending: Record<string, WorldEvent[]>;
  /** The company's place on each group's route, and the units it has bought lately World-wide (its prices slide with them). */
  company: { at: Record<string, number>; sold: Partial<Record<GoodId, number>>; visits: Record<string, number> };
  /** Last settlement's traffic, by face. */
  last: Record<string, FaceTrade>;
  /** Pirate presence (0..1) on unbuilt faces beside the lanes (v0, PIRATES_ENABLED). */
  pirates: Record<string, number>;
}

export const WORLD_KEY = "tidewater.world";

export function newLedger(): WorldLedger {
  return { version: 1, cycle: 0, rng: 0x9e3779b9, nextId: 1, consignments: [], storms: [], pending: {}, company: { at: {}, sold: {}, visits: {} }, last: {}, pirates: {} };
}
export function readLedger(store: Store): WorldLedger {
  try {
    const raw = store.getItem(WORLD_KEY);
    if (!raw) return newLedger();
    const L = JSON.parse(raw) as WorldLedger;
    if (L.version !== 1) return newLedger();
    const base = newLedger();
    return { ...base, ...L, company: { ...base.company, ...L.company } };
  } catch {
    return newLedger();
  }
}
export function writeLedger(store: Store, L: WorldLedger): void {
  store.setItem(WORLD_KEY, JSON.stringify(L));
}

/** The World's RNG: a 32-bit LCG on the ledger (deterministic, JSON-safe). */
function worldRand(L: WorldLedger): number {
  L.rng = (Math.imul(L.rng, 1664525) + 1013904223) >>> 0;
  return L.rng / 4294967296;
}

// ---------- one sea's quiet settlement ----------

/**
 * A settlement without the ticks between: the cycle's two shifts run quietly (the boats fish the high water, the
 * flats, pots and paddies are worked at low water; nothing is lost, no one swims), then the clock moves one cycle to
 * its peak and the ledger settles.
 */
export function settleOnly(state: SimState, grid: Grid): void {
  const t = state.tide;
  if (!state.storm.active) {
    shiftStart(state, grid, "high");
    shiftEnd(state, grid, "high");
    const level = t.level;
    t.level = troughLevel(t.cycle, t.scale);
    shiftStart(state, grid, "low");
    shiftEnd(state, grid, "low");
    t.level = level;
  }
  t.cycle++;
  t.phase = Math.PI / 2 + t.cycle * Math.PI * 2;
  t.level = peakLevel(t.cycle, t.scale, t.surge);
  t.wetLevel = Math.max(t.level, t.wetLevel);
  t.peaked = false;
  state.time += 120;
  updateNetwork(state, grid, t.level);
  settleCycle(state, grid, { quiet: true });
  biomeFor(state).settle?.(state, grid);
  if (state.storm.active && state.storm.lastCycle < t.cycle) state.storm.active = false; // a drifted storm blows one cycle
}

// ---------- what a sea can spare and wants ----------

/**
 * What an island can spare of a good. Foods: a share of each food it grows itself (the market sells every food above
 * the town's reserve at each settlement, so nothing is ever "left over"; the neighbours want the variety, and the
 * market sells a little less). Everything else: the stock above a fraction of its cap.
 */
export function surplusOf(state: SimState, good: GoodId): number {
  const stock = state.resources[good];
  const b = biomeFor(state);
  if (GOODS[good].role === "food") return b.foods.includes(good) || (b.catch ?? "fish") === good ? LANE_FOOD_SHARE * stock : 0;
  // A luxury is only any use to a town that does not make it (level 3 wants a foreign one): the maker sends it all;
  // a hub passes on only what is above its own want of it.
  if (GOODS[good].role === "luxury") return b.luxury === good ? stock : Math.max(0, stock - LANE_WANT_FRACTION * capFor(state, good));
  return Math.max(0, stock - LANE_RESERVE_FRACTION * capFor(state, good));
}

/** What an island wants of a good: room under its want line, for goods it does not make itself. */
export function wantOf(state: SimState, good: GoodId): number {
  const makes = biomeFor(state);
  if ([...makes.foods, makes.luxury, ...makes.industrials, ...makes.minor].includes(good)) return 0;
  return Math.max(0, LANE_WANT_FRACTION * capFor(state, good) - state.resources[good]);
}

/** One cycle of cargo from `from` to `to` straight across one lane: the hold over the goods `to` wants most. Returns what moved. */
export function flowLane(from: SimState, to: SimState, hold: number): Partial<Record<GoodId, number>> {
  const moved: Partial<Record<GoodId, number>> = {};
  const wants = GOOD_IDS.map(g => ({ g, want: Math.min(wantOf(to, g), surplusOf(from, g)) })).filter(w => w.want > 0).sort((a, b) => b.want - a.want);
  let room = hold;
  for (const w of wants) {
    if (room <= 0) break;
    const units = Math.min(w.want, room);
    const taken = Math.min(units, from.resources[w.g]);
    from.resources[w.g] -= taken;
    const landed = addCapped(to, w.g, taken);
    from.resources[w.g] += taken - landed; // what would not fit sails back
    if (landed > 0) { moved[w.g] = landed; room -= landed; }
  }
  return moved;
}

/** Cargo ships a sea sails: its harbor's own, and every one its shipyard has built. None without a harbor. */
export function cargoShipsOf(state: SimState): number {
  return harborOf(state) ? CARGO_SHIPS_PER_HARBOR + (state.cargoShips ?? 0) : 0;
}

/** What a hub passes through of one good in a cycle: a little on the quay, the rest what its warehouses hold overnight. */
export function hubRoom(state: SimState, _good: GoodId): number {
  const warehouses = buildingList(state).filter(b => b.kind === "warehouse" && !b.damaged).length;
  return HUB_BASE_PASS + warehouses * WAREHOUSE_CAP;
}

/** Homes with room on the network: what migrants can move into. */
export function freeHousing(state: SimState, grid: Grid): number {
  let n = 0;
  for (const b of buildingList(state)) {
    if (BUILDINGS[b.kind].residents === 0 || !b.reached || b.cut) continue;
    n += Math.max(0, grid.capacityOf(b) - b.residents);
  }
  return n;
}

// ---------- the lane graph ----------

/** The lanes out of a face: every neighbour that is built and has a harbor (the face itself must have one too). */
export function lanesOf(states: Map<number, SimState>, face: number): number[] {
  const own = states.get(face);
  if (!own || !harborOf(own)) return [];
  return neighboursOf(face).filter(n => { const s = states.get(n); return !!s && !!harborOf(s); }).slice().sort((a, b) => a - b);
}

/** Shortest lane path from `a` to `b` (breadth first, neighbours in face order), or null. */
export function lanePath(states: Map<number, SimState>, a: number, b: number): number[] | null {
  if (a === b) return [a];
  const prev = new Map<number, number>([[a, -1]]);
  const queue = [a];
  while (queue.length) {
    const f = queue.shift()!;
    for (const n of lanesOf(states, f)) {
      if (prev.has(n)) continue;
      prev.set(n, f);
      if (n === b) {
        const path = [b];
        for (let p = f; p !== -1; p = prev.get(p)!) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** Faces reachable from `a` by lanes, nearest first (ties by face). */
function byDistance(states: Map<number, SimState>, a: number): number[] {
  const seen = new Set([a]);
  const out: number[] = [];
  let ring = [a];
  while (ring.length) {
    const next: number[] = [];
    for (const f of ring) for (const n of lanesOf(states, f)) if (!seen.has(n)) { seen.add(n); next.push(n); }
    next.sort((x, y) => x - y);
    out.push(...next);
    ring = next;
  }
  return out;
}

/** The connected groups of harbors (two or more faces joined by lanes), each sorted. */
export function laneGroups(states: Map<number, SimState>): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const f of [...states.keys()].sort((a, b) => a - b)) {
    if (seen.has(f) || !lanesOf(states, f).length) continue;
    const group = [f, ...byDistance(states, f)].sort((a, b) => a - b);
    for (const g of group) seen.add(g);
    out.push(group);
  }
  return out;
}

/** Every lane once, as [lower face, higher face]. */
export function allLanes(states: Map<number, SimState>): [number, number][] {
  const out: [number, number][] = [];
  for (const f of [...states.keys()].sort((a, b) => a - b)) for (const n of lanesOf(states, f)) if (n > f) out.push([f, n]);
  return out;
}

/** A lane's capacity out of `from` this cycle: its cargo ships' holds, shared over its lanes. */
function laneCap(states: Map<number, SimState>, from: number): number {
  const s = states.get(from)!;
  return (cargoShipsOf(s) * CARGO_HOLD) / Math.max(1, lanesOf(states, from).length);
}

/** The lanes as the World card and the globe see them, from the sectors' metadata alone (no ledger read): [lower, higher]. */
export function lanesFromMetas(metas: readonly (SectorMeta | null)[]): [number, number][] {
  const out: [number, number][] = [];
  metas.forEach((m, f) => { if (m?.harbor) for (const n of neighboursOf(f)) if (n > f && metas[n]?.harbor) out.push([f, n]); });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** What is at sea on the World right now, by lane leg: [from, to, units of goods, passengers] (the globe's cargo ships, the Trade panel). */
export function shipsAtSea(L: WorldLedger): { from: number; to: number; goods: Partial<Record<GoodId, number>>; people: number }[] {
  const legs = new Map<string, { from: number; to: number; goods: Partial<Record<GoodId, number>>; people: number }>();
  for (const c of L.consignments) {
    const from = c.path[c.at], to = c.path[c.at + 1];
    const k = `${from}>${to}`;
    const leg = legs.get(k) ?? { from, to, goods: {}, people: 0 };
    if (c.good === "people") leg.people += c.units; else leg.goods[c.good] = (leg.goods[c.good] ?? 0) + c.units;
    legs.set(k, leg);
  }
  return [...legs.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

/** A sea is cleared: what was bound to or from it is lost with it, and nothing waits for it any more. */
export function forgetFace(store: Store, face: number): void {
  const L = readLedger(store);
  L.consignments = L.consignments.filter(c => !c.path.includes(face));
  delete L.pending[face];
  delete L.last[face];
  writeLedger(store, L);
}

// ---------- events ----------

/** Apply what the World sent a sea: a wave booked for its next settlement, a storm that blows through this one. */
export function applyWorldEvent(state: SimState, grid: Grid, e: WorldEvent, quiet = false): void {
  if (e.kind === "tsunami") {
    if (state.tsunami.stage || state.tsunami.due >= 0) return;
    warnTsunami(state);
    notify(state, `The mountain on ${e.from} erupted: a wave is crossing to us`);
  } else {
    if (state.storm.active || state.storm.lastCycle >= state.tide.cycle - 1) return;
    if (quiet) {
      state.storm.active = true; state.storm.lastCycle = state.tide.cycle; state.storm.count++;
      notify(state, `A storm drifted through from ${e.from}`);
    } else {
      startStorm(state, grid);
      notify(state, `The storm drifted in from ${e.from}`);
    }
  }
}

/** Entering a sea: what waited for it in the ledger. Returns how many events were applied. */
export function applyPending(store: Store, face: number, state: SimState, grid: Grid): number {
  const L = readLedger(store);
  const list = L.pending[face] ?? [];
  if (!list.length) return 0;
  for (const e of list) applyWorldEvent(state, grid, e);
  delete L.pending[face];
  writeLedger(store, L);
  return list.length;
}

// ---------- the settlement ----------

export interface WorldSettlement {
  settled: number[];
  /** Goods and people landed this settlement: from → to. */
  moved: { from: number; to: number; goods: Partial<Record<GoodId, number>>; people: number }[];
  /** Units by good (and "people") that boarded, landed, sailed back to their first sea, went down with a cleared one, or were taken by pirates: in transit before + loaded = landed + returned + dropped + raided + in transit after. */
  flow: Record<"loaded" | "landed" | "returned" | "dropped" | "raided", Partial<Record<string, number>>>;
  ledger: WorldLedger;
}
const acc = (m: Partial<Record<string, number>>, k: string, n: number) => { m[k] = (m[k] ?? 0) + n; };

/**
 * One World cycle. `active` is the sea being played (its state settles on its own clock and is not written here;
 * pass its grid so migrants and storms can land in it), or null when the World itself is up.
 */
export function settleWorld(store: Store, active: number | null, activeState: SimState | null, activeGrid: Grid | null = null, now = Date.now()): WorldSettlement | null {
  if (!LANES_ENABLED) return null;
  return settleWorldNow(store, active, activeState, activeGrid, { now });
}

/** The ledger itself, flag or no flag (tests). `order` is the order the other seas settle in: it never changes the result. */
export function settleWorldNow(store: Store, active: number | null, activeState: SimState | null, activeGrid: Grid | null = null, opts: { now?: number; order?: number[]; pirates?: boolean } = {}): WorldSettlement {
  const steps = settleWorldSteps(store, active, activeState, activeGrid, opts);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** The World settlement as a job main can run a slice a frame: it yields after each stored sea is settled and after each is written back. */
export function worldJob(store: Store, active: number | null, activeState: SimState | null, activeGrid: Grid | null = null): Generator<void, WorldSettlement, void> | null {
  return LANES_ENABLED ? settleWorldSteps(store, active, activeState, activeGrid, {}) : null;
}

/** The settlement itself, step by step (settleWorldNow runs it to the end). */
export function* settleWorldSteps(store: Store, active: number | null, activeState: SimState | null, activeGrid: Grid | null = null, opts: { now?: number; order?: number[]; pirates?: boolean } = {}): Generator<void, WorldSettlement, void> {
  const now = opts.now ?? Date.now();
  const L = readLedger(store);
  const out: WorldSettlement = { settled: [], moved: [], flow: { loaded: {}, landed: {}, returned: {}, dropped: {}, raided: {} }, ledger: L };
  const pirates = opts.pirates ?? PIRATES_ENABLED;
  const states = new Map<number, SimState>();
  const grids = new Map<number, Grid>();
  const names = new Map<number, string>();
  const metas = new Map<number, { name: string; biome: SimState["world"]["biome"]; created: number }>();
  const order = opts.order ?? FACE_LIST.map(f => f.index);
  for (const f of order) {
    if (f === active && activeState) {
      states.set(f, activeState);
      if (activeGrid) grids.set(f, activeGrid);
      names.set(f, readMeta(store, f)?.name ?? "the next sea");
      continue;
    }
    const rec = readSector(store, f);
    if (!rec) continue;
    const grid = new Grid(rec.state);
    settleOnly(rec.state, grid);
    states.set(f, rec.state); grids.set(f, grid);
    names.set(f, rec.meta.name);
    metas.set(f, { name: rec.meta.name, biome: rec.meta.biome, created: rec.meta.created });
    out.settled.push(f);
    yield;
  }
  out.settled.sort((a, b) => a - b);
  const faces = [...states.keys()].sort((a, b) => a - b);
  const gridOf = (f: number) => { let g = grids.get(f); if (!g) { g = new Grid(states.get(f)!); grids.set(f, g); } return g; };
  const nameOf = (f: number) => names.get(f) ?? "the next sea";
  const trade: Record<string, FaceTrade> = {};
  const tradeOf = (f: number) => (trade[f] ??= { imports: {}, exports: {}, arrived: 0, left: 0 });
  L.cycle++;

  // 1. Sail: every consignment one hop, in id order; a lane's cargo ships carry so much, a hub holds so much.
  const used = new Map<string, number>();
  const atHub = new Map<string, number>();
  for (const c of L.consignments) if (c.at > 0 && c.at < c.path.length - 1) atHub.set(`${c.path[c.at]}:${c.good}`, (atHub.get(`${c.path[c.at]}:${c.good}`) ?? 0) + c.units);
  const landed: Consignment[] = [];
  const keep: Consignment[] = [];
  for (const c of [...L.consignments].sort((a, b) => a.id - b.id)) {
    const from = c.path[c.at], to = c.path[c.at + 1];
    // A lane that has gone (a harbor lost, a sea cleared): the cargo goes home.
    if (!states.has(to) || !lanesOf(states, from).includes(to)) {
      if (states.has(c.path[0])) returnHome(states, c, out.flow); else acc(out.flow.dropped, c.good, c.units);
      continue;
    }
    const lane = `${from}>${to}`;
    const last = c.at + 1 === c.path.length - 1;
    // How much of it can sail: the lane's hold left, and (into a hub) what the hub can hold overnight. The rest waits.
    let can = c.units;
    if (c.good !== "people") {
      can = Math.min(can, laneCap(states, from) - (used.get(lane) ?? 0));
      if (!last) can = Math.min(can, hubRoom(states.get(to)!, c.good) - (atHub.get(`${to}:${c.good}`) ?? 0));
      can = Math.floor(can + 1e-9);
    }
    if (can < 1) { keep.push(c); continue; }
    let go = c;
    if (can < c.units) { go = { ...c, id: L.nextId++, path: c.path.slice(), units: can }; c.units -= can; keep.push(c); }
    // Pirates (v0): the hop may be raided; the hold is lost.
    if (pirates && go.good !== "people") {
      const chance = raidChance(states, L, from, to);
      if (chance > 0 && worldRand(L) < chance) {
        used.set(lane, (used.get(lane) ?? 0) + go.units);
        if (go.at > 0) { const k = `${from}:${go.good}`; atHub.set(k, (atHub.get(k) ?? 0) - go.units); }
        acc(out.flow.raided, go.good, go.units);
        const line = `Pirates took ${Math.round(go.units)} ${GOODS[go.good].name} off the cargo ship between ${nameOf(from)} and ${nameOf(to)}`;
        notify(states.get(from)!, line); notify(states.get(to)!, line);
        continue;
      }
    }
    if (go.good !== "people") {
      used.set(lane, (used.get(lane) ?? 0) + go.units);
      if (!last) atHub.set(`${to}:${go.good}`, (atHub.get(`${to}:${go.good}`) ?? 0) + go.units);
      if (go.at > 0) { const k = `${from}:${go.good}`; atHub.set(k, (atHub.get(k) ?? 0) - go.units); }
    }
    go.at++;
    if (last) landed.push(go); else keep.push(go);
  }
  keep.sort((a, b) => a.id - b.id);
  // Pirates (v0): presence fades, then grows on the unbuilt faces beside every lane that carried cargo this cycle.
  if (pirates) {
    for (const k of Object.keys(L.pirates)) { const v = L.pirates[k] * PIRATE_DECAY; if (v > 0.001) L.pirates[k] = v; else delete L.pirates[k]; }
    for (const [lane, units] of [...used.entries()].sort()) {
      const [a, b] = lane.split(">").map(Number);
      for (const n of pirateFaces(states, a, b)) L.pirates[n] = Math.min(1, (L.pirates[n] ?? 0) + units * PIRATE_GROWTH_PER_UNIT);
    }
  }
  L.consignments = keep;
  for (const c of landed) {
    const origin = c.path[0], dest = c.path[c.path.length - 1];
    const s = states.get(dest)!;
    if (c.good === "people") {
      const moved = moveIn(s, gridOf(dest), c.units);
      if (moved > 0) {
        notify(s, `From ${nameOf(origin)}: ${moved} new resident${moved > 1 ? "s" : ""} off the cargo ship`);
        tradeOf(dest).arrived += moved;
        out.moved.push({ from: origin, to: dest, goods: {}, people: moved });
      }
      acc(out.flow.landed, "people", moved);
      if (c.units - moved > 0) returnHome(states, { ...c, units: c.units - moved }, out.flow);
    } else {
      const got = addCapped(s, c.good, c.units);
      if (got > 0) {
        tradeOf(dest).imports[c.good] = (tradeOf(dest).imports[c.good] ?? 0) + got;
        out.moved.push({ from: origin, to: dest, goods: { [c.good]: got }, people: 0 });
      }
      acc(out.flow.landed, c.good, got);
      if (c.units - got > 1e-9) returnHome(states, { ...c, units: c.units - got }, out.flow);
    }
    s.cargo = { due: s.cargo?.due ?? -1, cycle: s.tide.cycle };
  }
  // One ledger line per sea and sender for the goods.
  const lines = new Map<string, Partial<Record<GoodId, number>>>();
  for (const m of out.moved) {
    if (m.people) continue;
    const k = `${m.from}>${m.to}`;
    const g = lines.get(k) ?? {};
    for (const [good, u] of Object.entries(m.goods)) g[good as GoodId] = (g[good as GoodId] ?? 0) + (u as number);
    lines.set(k, g);
  }
  for (const [k, goods] of [...lines.entries()].sort()) {
    const [from, to] = k.split(">").map(Number);
    const list = Object.entries(goods).map(([g, u]) => `${Math.round(u as number)} ${GOODS[g as GoodId].name}`).join(", ");
    notify(states.get(to)!, `From ${nameOf(from)}: ${list}`);
  }

  // 2. The outboxes: an eruption's wave goes to every built neighbour.
  const deliver = (face: number, e: WorldEvent) => {
    const s = states.get(face);
    if (!s) return;
    if (face === active && activeState) applyWorldEvent(s, gridOf(face), e);
    else if (e.kind === "storm") applyWorldEvent(s, gridOf(face), e, true);
    else (L.pending[face] ??= []).push(e);
  };
  for (const f of faces) {
    const s = states.get(f)!;
    for (const e of s.outbox ?? []) {
      if (e.kind === "tsunami") for (const n of [...neighboursOf(f)].sort((a, b) => a - b)) if (states.has(n)) deliver(n, { kind: "tsunami", from: nameOf(f), fromFace: f, cycle: e.cycle });
    }
    s.outbox = [];
  }

  // 3. The storms: each drifts to the face it was bound for, then picks its next; one may be born.
  const stormsNext: WorldStorm[] = [];
  for (const st of [...L.storms].sort((a, b) => a.id - b.id)) {
    st.age++;
    if (st.age > WORLD_STORM_LIFE) continue;
    st.face = st.next;
    deliver(st.face, { kind: "storm", from: stormFrom(names, st.face), cycle: L.cycle });
    const ns = neighboursOf(st.face);
    st.next = ns[Math.floor(worldRand(L) * ns.length)];
    stormsNext.push(st);
  }
  if (L.cycle >= WORLD_STORM_FIRST && faces.length && worldRand(L) < WORLD_STORM_CHANCE) {
    const face = faces[Math.floor(worldRand(L) * faces.length)];
    const ns = neighboursOf(face);
    const st: WorldStorm = { id: L.nextId++, face, next: ns[Math.floor(worldRand(L) * ns.length)], age: 0 };
    deliver(face, { kind: "storm", from: "the open sea", cycle: L.cycle });
    stormsNext.push(st);
  }
  L.storms = stormsNext;
  for (const f of faces) {
    const s = states.get(f)!;
    const coming = L.storms.filter(st => st.next === f && st.age < WORLD_STORM_LIFE).sort((a, b) => a.id - b.id)[0];
    s.stormComing = coming ? { at: s.tide.cycle + 1, from: stormFrom(names, coming.face) } : null;
  }

  // 4. Load: for each good, each sea that wants it takes from the nearest sea that can spare it, up to the first
  // lane's room this cycle; then migrants board for the nearest sea with homes free.
  const planned = new Map<string, number>(); // lane > units already committed for the next sailing
  for (const c of L.consignments) if (c.good !== "people") { const k = `${c.path[c.at]}>${c.path[c.at + 1]}`; planned.set(k, (planned.get(k) ?? 0) + c.units); }
  const inbound = new Map<string, number>();
  for (const c of L.consignments) { const k = `${c.path[c.path.length - 1]}:${c.good}`; inbound.set(k, (inbound.get(k) ?? 0) + c.units); }
  const spare = new Map<string, number>();
  const spareOf = (f: number, g: GoodId) => { const k = `${f}:${g}`; if (!spare.has(k)) spare.set(k, surplusOf(states.get(f)!, g)); return spare.get(k)!; };
  const harbors = faces.filter(f => lanesOf(states, f).length > 0);
  for (const g of GOOD_IDS) {
    for (const d of harbors) {
      let want = wantOf(states.get(d)!, g) - (inbound.get(`${d}:${g}`) ?? 0);
      if (want < 1) continue;
      for (const src of byDistance(states, d)) {
        if (want < 1) break;
        const have = spareOf(src, g);
        if (have < 1) continue;
        const path = lanePath(states, src, d);
        if (!path) continue;
        const lane = `${path[0]}>${path[1]}`;
        const room = laneCap(states, src) - (planned.get(lane) ?? 0);
        const units = Math.floor(Math.min(want, have, room));
        if (units < 1) continue;
        const s = states.get(src)!;
        s.resources[g] -= units;
        spare.set(`${src}:${g}`, have - units);
        planned.set(lane, (planned.get(lane) ?? 0) + units);
        want -= units;
        L.consignments.push({ id: L.nextId++, good: g, units, path, at: 0 });
        acc(out.flow.loaded, g, units);
        tradeOf(src).exports[g] = (tradeOf(src).exports[g] ?? 0) + units;
      }
    }
  }
  for (const f of harbors) {
    const s = states.get(f)!;
    const pop = population(s);
    if (pop <= MIGRANTS_PER_CYCLE) continue;
    const unhappy = s.happiness < IMMIGRATION_HAPPINESS;
    const full = !unhappy && freeHousing(s, gridOf(f)) === 0;
    if (!unhappy && !full) continue;
    for (const d of byDistance(states, f)) {
      const t = states.get(d)!;
      if (t.happiness < IMMIGRATION_HAPPINESS || foodTotal(t) <= 0) continue;
      const room = freeHousing(t, gridOf(d)) - (inbound.get(`${d}:people`) ?? 0);
      const n = Math.min(MIGRANTS_PER_CYCLE, room);
      if (n < 1) continue;
      const left = moveOut(s, n);
      if (left < 1) break;
      const path = lanePath(states, f, d)!;
      L.consignments.push({ id: L.nextId++, good: "people", units: left, path, at: 0 });
      acc(out.flow.loaded, "people", left);
      inbound.set(`${d}:people`, (inbound.get(`${d}:people`) ?? 0) + left);
      tradeOf(f).left += left;
      notify(s, `${left} resident${left > 1 ? "s" : ""} took the cargo ship for ${nameOf(d)}${unhappy ? ", hoping for better" : ": there is no room here"}`);
      break;
    }
  }
  // The ship a sea should see coming next high water.
  for (const f of faces) {
    const s = states.get(f)!;
    const due = L.consignments.some(c => c.at + 1 === c.path.length - 1 && c.path[c.path.length - 1] === f);
    s.cargo = { due: due ? s.tide.cycle + 1 : -1, cycle: s.cargo?.cycle ?? -1 };
  }

  // 5. The Trade Company: one harbor a cycle along each group; its prices slide with what it has bought lately.
  for (const g of GOOD_IDS) { const v = (L.company.sold[g] ?? 0) * COMPANY_SLIDE_RECOVERY; if (v > 0.01) L.company.sold[g] = v; else delete L.company.sold[g]; }
  for (const f of faces) {
    const t = states.get(f)!.trade;
    if (t.routed && t.shipCycle === states.get(f)!.tide.cycle && t.bought) for (const [g, u] of Object.entries(t.bought)) L.company.sold[g as GoodId] = (L.company.sold[g as GoodId] ?? 0) + (u as number);
  }
  const slide: Partial<Record<GoodId, number>> = {};
  for (const [g, u] of Object.entries(L.company.sold)) slide[g as GoodId] = 1 / (1 + (u as number) / COMPANY_SLIDE_UNITS);
  const groups = laneGroups(states);
  const routed = new Set<number>();
  const keys = new Set<string>();
  for (const group of groups) {
    const key = group.join("-");
    keys.add(key);
    const at = L.company.at[key] ?? 0;
    const visit = group[at % group.length];
    L.company.at[key] = at + 1;
    for (const f of group) {
      routed.add(f);
      const t = states.get(f)!.trade;
      t.routed = true;
      t.slide = slide;
      t.nextVisit = f === visit ? states.get(f)!.tide.cycle + 1 : -1;
    }
    L.company.visits[key] = visit;
  }
  for (const k of Object.keys(L.company.at)) if (!keys.has(k)) { delete L.company.at[k]; delete L.company.visits[k]; }
  for (const f of faces) {
    const t = states.get(f)!.trade;
    if (t.routed && !routed.has(f)) { t.routed = false; t.slide = {}; t.nextVisit = -1; } // back to its own ship's visits
  }

  L.last = trade;
  for (const f of faces) {
    if (f === active) continue;
    const m = metas.get(f);
    if (m) { writeSector(store, f, states.get(f)!, m, now); yield; }
  }
  writeLedger(store, L);
  return out;
}

/** The unbuilt faces beside a lane (neighbours of either end nobody has built): where pirates gather. */
export function pirateFaces(states: Map<number, SimState>, a: number, b: number): number[] {
  return [...new Set([...neighboursOf(a), ...neighboursOf(b)])].filter(n => n !== a && n !== b && !states.has(n)).sort((x, y) => x - y);
}

/** A hop's raid chance (v0): the strongest presence beside the lane × PIRATE_RAID_CHANCE, halved by a staffed fort at either end. */
export function raidChance(states: Map<number, SimState>, L: WorldLedger, from: number, to: number): number {
  let p = 0;
  for (const n of pirateFaces(states, from, to)) p = Math.max(p, L.pirates[n] ?? 0);
  if (p <= 0) return 0;
  const fort = (f: number) => buildingList(states.get(f)!).some(b => b.kind === "fort" && b.reached && !b.damaged && b.workers > 0);
  return p * PIRATE_RAID_CHANCE * (fort(from) ? FORT_RAID_FACTOR : 1) * (fort(to) ? FORT_RAID_FACTOR : 1);
}

function stormFrom(names: Map<number, string>, face: number): string {
  return names.get(face) ?? "the open sea";
}

/** Cargo that cannot go on sails back to its first sea (landed at once: the conservation of goods). */
function returnHome(states: Map<number, SimState>, c: Consignment, flow: WorldSettlement["flow"]): void {
  const s = states.get(c.path[0]);
  if (!s) { acc(flow.dropped, c.good, c.units); return; }
  acc(flow.returned, c.good, c.units);
  if (c.good === "people") moveIn(s, new Grid(s), c.units);
  else s.resources[c.good] += c.units;
}

/** Take up to `n` residents out of the unhappiest homes (ties by id). Returns how many left. */
function moveOut(state: SimState, n: number): number {
  const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0 && b.residents > 0).sort((a, b) => a.happiness - b.happiness || a.id - b.id);
  let left = 0;
  for (const b of homes) {
    while (left < n && b.residents > 0) { b.residents--; left++; }
    if (left >= n) break;
  }
  return left;
}

/** Settle up to `n` newcomers into connected homes with room (id order). Returns how many found a home. */
function moveIn(state: SimState, grid: Grid, n: number): number {
  let placed = 0;
  for (const b of buildingList(state).sort((a, b) => a.id - b.id)) {
    if (placed >= n) break;
    const cap = grid.capacityOf(b);
    if (cap === 0 || !b.reached || b.cut || b.residents >= cap) continue;
    const k = Math.min(n - placed, cap - b.residents);
    b.residents += k; placed += k;
  }
  return placed;
}
