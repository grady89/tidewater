// The sim fuzzer: plays one seed for N cycles of random valid player actions and checks the ledger's invariants
// at every cycle. Sim-only — no Babylon, no DOM — so it runs in vitest, in a worker thread (test/fuzz.ts) and in
// the page. The action stream comes from its own RNG (the ledger keeps its own), so a seed always replays the
// same session; the last actions before a failure are the repro.
import { SIM_TICK } from "../src/config";
import { BuildingKind, BUILDINGS, FISH_CAP, GoodKind, LIFT_MAX, MAX_LEVEL } from "../src/sim/balance";
import { addCapped, buyBoat, capFor, isHarbour, removeBuilding, tryPlace } from "../src/sim/economy";
import { startStorm, startTsunami } from "../src/sim/events";
import { BiomeId, chartedBiomes, tideScaleOf } from "../src/sim/biomes";
import { emptyStock, GOOD_IDS } from "../src/sim/goods";
import { materialCode } from "../src/sim/materials";
import { ignite } from "../src/sim/fire";
import { cellIndex, Grid, HALF, inBounds } from "../src/sim/grid";
import { addLandfill, clearTree, plantTree } from "../src/sim/land";
import { takeLoan } from "../src/sim/loan";
import { auditMoney, moveMoney } from "../src/sim/money";
import { updateNetwork } from "../src/sim/network";
import { deserialize, serialize, stateHash } from "../src/sim/save";
import { addLantern } from "../src/sim/services";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { tick } from "../src/sim/tick";
import { companyCarries, orderGood } from "../src/sim/trade";
import { jobsAt } from "../src/sim/workers";

export interface Failure {
  seed: number;
  cycle: number;
  invariant: string;
  detail: string;
  /** The last actions before the failure, oldest first. */
  recent: string[];
}

export interface FuzzResult {
  seed: number;
  cycles: number;
  /** How many of each action ran (attempted), and how many placements of each kind succeeded. */
  actions: Record<string, number>;
  placed: Partial<Record<BuildingKind, number>>;
  failures: Failure[];
  /** Ledger hash at the end — a determinism check between runs and builds. */
  hash: string;
  /** The coast this seed played. */
  biome: string;
  /** Cycles that ended with the purse below zero (allowed: upkeep is unconditional; counted for QA.md). */
  negativeMoneyCycles: number;
  ms: number;
}

const KINDS = Object.keys(BUILDINGS) as BuildingKind[];
const GOODS: readonly GoodKind[] = GOOD_IDS;
const TICKS_PER_CYCLE = 120 / SIM_TICK;
const ACTIONS_PER_CYCLE = 6;
const RECENT = 40;

/** mulberry32: a small fast PRNG for the action stream, independent of the ledger's. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Action = "place" | "remove" | "boat" | "loan" | "planks" | "storm" | "tsunami" | "fire" | "landfill" | "plant" | "clear" | "lantern" | "saveLoad" | "speed" | "grant";
const WEIGHTS: [Action, number][] = [
  ["place", 40], ["remove", 8], ["boat", 6], ["loan", 3], ["planks", 3], ["storm", 2], ["tsunami", 1], ["fire", 2],
  ["landfill", 3], ["plant", 3], ["clear", 2], ["lantern", 3], ["saveLoad", 3], ["speed", 2], ["grant", 2],
];
const TOTAL_WEIGHT = WEIGHTS.reduce((n, [, w]) => n + w, 0);

/** Own-cell placement class check: what a standing building must still satisfy on its own cells. */
function ownCellsOk(grid: Grid, b: Building): boolean {
  const def = BUILDINGS[b.kind];
  const cls = (c: Cell) => grid.classAt(c);
  switch (def.cls) {
    case "flat": return b.cells.every(c => cls(c) === "flat");
    case "deep": case "edge": return b.cells.every(c => cls(c) === "deep");
    case "high": case "beach": return b.cells.every(c => cls(c) === "high");
    case "flatOrHigh": return b.cells.every(c => cls(c) === "flat" || cls(c) === "high");
    case "flatOrDeep": return b.cells.every(c => cls(c) === "flat" || cls(c) === "deep");
    case "shore": return b.cells.every(c => cls(c) === "flat");
    case "highOrEdge": return b.cells.every(c => cls(c) === "high") || b.cells.every(c => cls(c) === "deep");
    case "street": return b.cells.every(c => cls(c) === "flat" || cls(c) === "high");
  }
}

interface Ledger { money: number; entries: number; stocks: Record<GoodKind, number> }

/** Every invariant, as a list of violations (empty = clean). `ledger` is the money/stock baseline from the last check. */
export function checkInvariants(state: SimState, grid: Grid, ledger: Ledger): string[] {
  const out: string[] = [];
  const r = state.resources;
  const fin = (v: number) => Number.isFinite(v);
  // 1. Stocks: finite, never negative; the purse finite.
  for (const g of GOODS) if (!fin(r[g]) || r[g] < -1e-9) out.push(`stock ${g} = ${r[g]}`);
  if (!fin(r.money)) out.push(`money = ${r.money}`);
  // 2. Caps: a stock above its cap may only have got there by a grant or a lost warehouse, never by growing.
  for (const g of GOODS) {
    const cap = capFor(state, g);
    if (r[g] > Math.max(cap, ledger.stocks[g]) + 1e-9) out.push(`stock ${g} = ${r[g].toFixed(3)} over cap ${cap} (was ${ledger.stocks[g].toFixed(3)})`);
  }
  // 2b. The coast's own state: bleaching is a 0..1 fraction on lagoon cells only; every biome counter is finite.
  const lagoon = materialCode("lagoon");
  for (let k = 0; k < state.fields.bleach.length; k++) {
    const b = state.fields.bleach[k];
    if (!fin(b) || b < -1e-9 || b > 1 + 1e-9) out.push(`bleach[${k}] = ${b}`);
    if (b > 0 && grid.materials[k] !== lagoon) out.push(`bleach on a non-lagoon cell ${k}`);
  }
  for (const [key, v] of Object.entries(state.biomeState)) if (!fin(v)) out.push(`biomeState.${key} = ${v}`);
  if (state.tide.scale !== tideScaleOf(state.world.biome)) out.push(`tide scale ${state.tide.scale} ≠ the coast's ${tideScaleOf(state.world.biome)}`);
  // 3. Double entry: the purse moved exactly by the sum of the entries since the last check.
  const expected = ledger.money + ledger.entries;
  if (Math.abs(r.money - expected) > 1e-6) out.push(`money ${r.money.toFixed(4)} ≠ ${ledger.money.toFixed(4)} + entries ${ledger.entries.toFixed(4)}`);
  // 4. Workers: every assignment's home and work stand; counts agree with the buildings.
  const byWork = new Map<number, number>(), byHome = new Map<number, number>();
  for (const a of state.assignments) {
    const home = state.buildings[a.home], work = state.buildings[a.work];
    if (!home) out.push(`assignment home #${a.home} is gone`);
    if (!work) out.push(`assignment work #${a.work} is gone`);
    if (!(a.n > 0)) out.push(`assignment ${a.home}→${a.work} n = ${a.n}`);
    byWork.set(a.work, (byWork.get(a.work) ?? 0) + a.n);
    byHome.set(a.home, (byHome.get(a.home) ?? 0) + a.n);
  }
  for (const b of buildingList(state)) {
    const w = byWork.get(b.id) ?? 0;
    if (w !== b.workers) out.push(`${b.kind} #${b.id} workers ${b.workers} but assignments give ${w}`);
    if (b.workers > jobsAt(b)) out.push(`${b.kind} #${b.id} workers ${b.workers} > jobs ${jobsAt(b)}`);
    const h = byHome.get(b.id) ?? 0;
    if (h > b.residents - b.injured) out.push(`${b.kind} #${b.id} employs ${h} of ${b.residents} residents (${b.injured} injured)`);
  }
  // 5 + 8. Save → load → save is the same JSON, and the loaded copy agrees on reached/cut at this water level.
  const json = serialize(state);
  let copy: SimState | null = null;
  try {
    copy = deserialize(json);
    const again = serialize(copy);
    if (again !== json) out.push(`save→load→save differs (${json.length} vs ${again.length} chars)`);
  } catch (e) {
    out.push(`load threw: ${(e as Error).message}`);
  }
  if (copy) {
    const g2 = new Grid(copy);
    updateNetwork(copy, g2, state.tide.level);
    for (const b of buildingList(state)) {
      const c = copy.buildings[b.id];
      if (c.reached !== b.reached || c.cut !== b.cut) out.push(`${b.kind} #${b.id} reached/cut ${b.reached}/${b.cut} but the network says ${c.reached}/${c.cut}`);
    }
  }
  // 6. Buildings stand on cells they may stand on, once each, and the index agrees.
  const seen = new Set<number>();
  let maxId = 0;
  for (const b of buildingList(state)) {
    maxId = Math.max(maxId, b.id);
    for (const c of b.cells) {
      if (!inBounds(c.i, c.j)) { out.push(`${b.kind} #${b.id} cell off the map ${c.i},${c.j}`); continue; }
      const k = cellIndex(c.i, c.j);
      if (seen.has(k)) out.push(`${b.kind} #${b.id} shares cell ${c.i},${c.j}`);
      seen.add(k);
      if (grid.buildingAt(c) !== b) out.push(`${b.kind} #${b.id} not in the index at ${c.i},${c.j}`);
    }
    if (!ownCellsOk(grid, b)) out.push(`${b.kind} #${b.id} stands on the wrong class of cell (${b.cells.map(c => grid.classAt(c)).join(",")})`);
    if (!grid.terrainOk(b.kind, b.cells)) out.push(`${b.kind} #${b.id} stands outside its terrain window`);
    if (!fin(b.floorY) || b.floorY < grid.groundUnder(b.cells) - 1e-6) out.push(`${b.kind} #${b.id} floor ${b.floorY} under the ground`);
    if (b.level < 1 || b.level > MAX_LEVEL) out.push(`${b.kind} #${b.id} level ${b.level}`);
    if (b.residents < 0 || b.residents > grid.capacityOf(b)) out.push(`${b.kind} #${b.id} residents ${b.residents} of ${grid.capacityOf(b)}`);
    if (b.injured < 0 || b.injured > b.residents) out.push(`${b.kind} #${b.id} injured ${b.injured} of ${b.residents}`);
    if (b.boats < 0 || b.boats > (BUILDINGS[b.kind].slots ?? 0)) out.push(`${b.kind} #${b.id} boats ${b.boats} of ${BUILDINGS[b.kind].slots ?? 0}`);
    if (b.atSea && b.boats === 0) out.push(`${b.kind} #${b.id} at sea with no boats`);
    if (b.fire < 0 || b.progress < 0 || b.workers < 0) out.push(`${b.kind} #${b.id} negative counter`);
    if (![b.output, b.happiness, b.floorY].every(fin)) out.push(`${b.kind} #${b.id} non-finite number`);
    if (b.rot < 0 || b.rot > 3) out.push(`${b.kind} #${b.id} rot ${b.rot}`);
  }
  if (state.nextId <= maxId) out.push(`nextId ${state.nextId} ≤ highest id ${maxId}`);
  // 7. Fields within their range. Fire risk is the one field that is not a fraction: the game's own rule is that
  // a cluster ignites once its risk climbs past FIRE_IGNITE_THRESHOLD (1.0), so it is only held to finite and ≥ 0.
  const f = state.fields;
  const range = (name: string, field: number[], hi: number) => {
    for (let k = 0; k < field.length; k++) if (!(field[k] >= 0 && field[k] <= hi + 1e-9)) { out.push(`field ${name}[${k}] = ${field[k]}`); return; }
  };
  range("pollution", f.pollution, 1); range("shark", f.shark, 1); range("fire", f.fire, Infinity); range("fish", f.fish, FISH_CAP);
  for (const [name, layer] of Object.entries(f.coverage)) range(`coverage.${name}`, layer, 1);
  if (!fin(state.tide.level) || !fin(state.time)) out.push(`tide ${state.tide.level} time ${state.time}`);
  if (!(state.happiness >= 0 && state.happiness <= 1)) out.push(`happiness ${state.happiness}`);
  return out;
}

/** One seed's session. `onProgress` is called at the end of every cycle. */
export function runSeed(seed: number, cycles: number, onProgress?: (cycle: number) => void): FuzzResult {
  const t0 = performance.now();
  const rand = rng(seed * 7919 + 13);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  // Every fifth seed plays a generated island, and those take turns round the charted coasts (the original island is Tidewater's).
  const biome: BiomeId = seed % 5 === 0 ? chartedBiomes()[Math.floor(seed / 5) % chartedBiomes().length] : "tidewater";
  let { state, grid } = newGame(1, seed % 5 === 0 ? seed : 0, biome);
  const actions: Record<string, number> = {};
  const placed: Partial<Record<BuildingKind, number>> = {};
  const failures: Failure[] = [];
  const recent: string[] = [];
  const note = (s: string) => { recent.push(`c${state.tide.cycle} t${state.tick} ${s}`); if (recent.length > RECENT) recent.shift(); };
  let entries = 0;
  auditMoney(e => { entries += e.amount; });
  const ledger: Ledger = { money: state.resources.money, entries: 0, stocks: emptyStock() };
  const rebase = () => { ledger.money = state.resources.money; ledger.entries = 0; entries = 0; for (const g of GOODS) ledger.stocks[g] = state.resources[g]; };
  rebase();
  let speed = 1;
  let negativeMoneyCycles = 0;

  const randomCell = (): Cell => ({ i: Math.floor(rand() * 64) - HALF, j: Math.floor(rand() * 64) - HALF });
  const nearTown = (): Cell => {
    const bs = buildingList(state);
    if (!bs.length || rand() < 0.3) return randomCell();
    const c = pick(pick(bs).cells);
    return { i: c.i + Math.floor(rand() * 7) - 3, j: c.j + Math.floor(rand() * 7) - 3 };
  };

  const act = (): void => {
    let roll = rand() * TOTAL_WEIGHT;
    let action: Action = "place";
    for (const [a, w] of WEIGHTS) { roll -= w; if (roll < 0) { action = a; break; } }
    // Mid-event, a save/load is what a player might do; make sure it happens.
    if ((state.storm.active || state.tsunami.stage) && rand() < 0.3) action = "saveLoad";
    actions[action] = (actions[action] ?? 0) + 1;
    switch (action) {
      case "place": {
        const kind = pick(KINDS);
        const at = nearTown();
        const rot = rand() < 0.5 ? null : Math.floor(rand() * 4);
        const lift = rand() < 0.2 ? Math.floor(rand() * (LIFT_MAX + 1)) : 0;
        const b = tryPlace(state, grid, kind, at, lift, rot);
        if (b) placed[kind] = (placed[kind] ?? 0) + 1;
        note(`place ${kind} ${at.i},${at.j} rot ${rot} lift ${lift} → ${b ? "#" + b.id : "no"}`);
        break;
      }
      case "remove": {
        const bs = buildingList(state);
        if (!bs.length) break;
        const b = pick(bs);
        note(`remove ${b.kind} #${b.id}${b.atSea ? " (boats out)" : ""}`);
        removeBuilding(state, grid, b);
        break;
      }
      case "boat": {
        const hs = buildingList(state).filter(isHarbour);
        if (!hs.length) break;
        const h = pick(hs);
        note(`boat at ${h.kind} #${h.id} → ${buyBoat(state, h)}`);
        break;
      }
      case "loan": note(`loan → ${takeLoan(state)}`); break;
      case "planks": { const g = pick(companyCarries(state)); note(`order ${g} → ${orderGood(state, g)}`); break; }
      case "storm": note("storm"); startStorm(state, grid); break;
      case "tsunami": note("tsunami"); startTsunami(state, grid); break;
      case "fire": {
        const bs = buildingList(state);
        if (!bs.length) break;
        const b = pick(bs);
        note(`fire ${b.kind} #${b.id}`);
        ignite(state, b);
        break;
      }
      case "landfill": { const c = nearTown(); note(`landfill ${c.i},${c.j} → ${addLandfill(state, grid, c)}`); break; }
      case "plant": { const c = randomCell(); note(`plant ${c.i},${c.j} → ${plantTree(state, grid, c)}`); break; }
      case "clear": { const c = randomCell(); note(`clear ${c.i},${c.j} → ${clearTree(state, grid, c)}`); break; }
      case "lantern": {
        const ws = buildingList(state).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
        if (!ws.length) break;
        const w = pick(ws);
        note(`lantern on #${w.id} → ${addLantern(state, grid, w.cells[0])}`);
        break;
      }
      case "saveLoad": {
        const json = serialize(state);
        const loaded = deserialize(json);
        note(`save/load${state.storm.active ? " in a storm" : ""}${state.tsunami.stage ? " in a tsunami (" + state.tsunami.stage + ")" : ""}`);
        state = loaded;
        grid = new Grid(state);
        break;
      }
      case "speed": speed = pick([1, 2, 4]); note(`speed ${speed}`); break;
      case "grant": {
        moveMoney(state, 500, "grant");
        const g = pick(GOODS);
        addCapped(state, g, 40);
        note(`grant 500$ + 40 ${g}`);
        rebase();
        break;
      }
    }
  };

  try {
    while (state.tide.cycle < cycles) {
      const before = state.tide.cycle;
      if (rand() < (ACTIONS_PER_CYCLE * speed) / TICKS_PER_CYCLE) act();
      for (let k = 0; k < speed; k++) tick(state, grid);
      if (state.tide.cycle !== before) {
        ledger.entries = entries;
        const bad = checkInvariants(state, grid, ledger);
        if (state.resources.money < 0) negativeMoneyCycles++;
        if (bad.length) {
          failures.push({ seed, cycle: state.tide.cycle, invariant: bad[0], detail: bad.slice(0, 6).join(" | "), recent: recent.slice() });
          if (failures.length >= 3) break;
        }
        rebase();
        onProgress?.(state.tide.cycle);
      }
    }
  } catch (e) {
    failures.push({ seed, cycle: state.tide.cycle, invariant: "exception", detail: (e as Error).stack ?? String(e), recent: recent.slice() });
  } finally {
    auditMoney(null);
  }
  return { seed, cycles: state.tide.cycle, actions, placed, failures, hash: stateHash(state), negativeMoneyCycles, ms: performance.now() - t0, biome };
}
