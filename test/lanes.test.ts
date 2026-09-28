// Sea lanes (BIOMES.md §4) and the World ledger: every built sea but the active one settles once per World cycle,
// quietly; cargo sails a hop a cycle along the shortest lane path, as much as the lane's cargo ships hold and a hub's
// warehouses pass; migrants take the cargo ship; storms drift a face a cycle; an eruption's wave reaches the
// neighbours; the company's ship calls at one harbor a cycle along each connected group.
import { describe, expect, it } from "vitest";
import { LANES_ENABLED } from "../src/config";
import { CARGO_HOLD, CARGO_SHIPS_PER_HARBOR, HUB_BASE_PASS, WAREHOUSE_CAP } from "../src/sim/balance";
import { Grid } from "../src/sim/grid";
import {
  applyPending, cargoShipsOf, flowLane, hubRoom, lanePath, lanesOf, neighboursOf, readLedger, settleOnly, settleWorld, settleWorldNow,
  surplusOf, wantOf, writeLedger,
} from "../src/sim/lanes";
import { readSector, Store, writeSector } from "../src/sim/sectors";
import { newGame } from "../src/sim/start";
import { Building, buildingList, population, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { placeByWalkway, placeHarbor, starterTown } from "./scenario";
import type { BiomeId } from "../src/sim/biomes";

class MapStore implements Store {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clone(): MapStore { const m = new MapStore(); for (const [k, v] of this.map) m.map.set(k, v); return m; }
}

function harborTown(seed = 7, biome: BiomeId = "tidewater", face = 1) {
  const { state, grid } = newGame(face, seed, biome);
  const t = starterTown(state, grid);
  state.resources.money += 5000; state.resources.planks += 200;
  const harbor = placeHarbor(state, grid, t.pier.cells[0]);
  expect(harbor).not.toBeNull();
  advanceCycles(state, grid, 2);
  return { state, grid };
}

// Faces 1 and 6 share an edge; C is a neighbour of 6 that does not touch 1 (so 1 → C is two hops, through 6).
const A = 1, B = 6;
const C = neighboursOf(B).find(f => f !== A && !neighboursOf(A).includes(f))!;
const name = (f: number) => `Sea ${f}`;
const put = (store: Store, f: number, s: SimState) => writeSector(store, f, s, { name: name(f), biome: s.world.biome, created: 1 }, 1);
const get = (store: Store, f: number) => readSector(store, f)!.state;

describe("sea lanes: the flag", () => {
  it("is on, and kept: settleWorld runs the ledger", () => {
    expect(LANES_ENABLED).toBe(true);
    const store = new MapStore();
    put(store, A, harborTown().state);
    const out = settleWorld(store, null, null, null, 1);
    expect(out).not.toBeNull();
    expect(out!.settled).toEqual([A]);
  });
});

describe("sea lanes: the World ledger", () => {
  it("adjacency comes from the dodecahedron: five neighbours each, symmetric", () => {
    for (let f = 0; f < 12; f++) {
      expect(neighboursOf(f).length).toBe(5);
      for (const n of neighboursOf(f)) expect(neighboursOf(n)).toContain(f);
    }
    expect(C).toBeDefined();
  });
  it("settleOnly moves the clock one cycle and settles without hazards", () => {
    const { state, grid } = harborTown();
    const cycle = state.tide.cycle, fires = state.fires;
    for (let k = 0; k < 20; k++) settleOnly(state, grid);
    expect(state.tide.cycle).toBe(cycle + 20);
    expect(state.fires).toBe(fires);
    expect(Number.isFinite(state.resources.money)).toBe(true);
  });
  it("surplus keeps the food reserve; want is only for goods the coast cannot make", () => {
    const { state } = harborTown();
    state.resources.fish = 500;
    expect(surplusOf(state, "fish")).toBeGreaterThan(0);
    expect(surplusOf(state, "fish")).toBeLessThan(500);
    state.resources.fish = 0;
    expect(surplusOf(state, "fish")).toBe(0);
    expect(wantOf(state, "fish")).toBe(0);
    expect(wantOf(state, "cocoa")).toBeGreaterThan(0);
  });
  it("one lane's straight flow never passes the hold or the cap", () => {
    const a = harborTown(7), b = harborTown(8);
    a.state.resources.cocoa = 100;
    b.state.resources.cocoa = 0;
    const moved = flowLane(a.state, b.state, CARGO_HOLD);
    expect(moved.cocoa).toBeGreaterThan(0);
    expect(moved.cocoa!).toBeLessThanOrEqual(CARGO_HOLD);
    expect(a.state.resources.cocoa + b.state.resources.cocoa).toBeCloseTo(100, 6);
  });
  it("a lane needs a harbor at both ends and a shared edge; paths are shortest", () => {
    const a = harborTown(7), b = harborTown(8), c = harborTown(9);
    const states = new Map<number, SimState>([[A, a.state], [B, b.state]]);
    expect(lanesOf(states, A)).toEqual([B]);
    expect(lanesOf(states, B)).toEqual([A]);
    states.set(3, newGame(3, 9).state);
    expect(lanesOf(states, 3)).toEqual([]);
    states.set(C, c.state);
    expect(lanePath(states, A, C)).toEqual([A, B, C]);
    expect(cargoShipsOf(a.state)).toBe(CARGO_SHIPS_PER_HARBOR);
    a.state.cargoShips = 2;
    expect(cargoShipsOf(a.state)).toBe(CARGO_SHIPS_PER_HARBOR + 2);
  });
});

describe("sea lanes: cargo", () => {
  it("a hop a cycle: loaded at one settlement, landed at the next, the hold the limit; goods conserved", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8);
    a.state.resources.cocoa = 100;
    b.state.resources.cocoa = 0;
    put(store, A, a.state); put(store, B, b.state);
    const s1 = settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    expect(s1.settled).toEqual([B]);
    const loaded = 100 - a.state.resources.cocoa;
    expect(loaded).toBeGreaterThan(0);
    expect(loaded).toBeLessThanOrEqual(CARGO_SHIPS_PER_HARBOR * CARGO_HOLD + 1e-6);
    const L1 = readLedger(store);
    expect(L1.consignments.filter(c => c.good === "cocoa").reduce((n, c) => n + c.units, 0)).toBeCloseTo(loaded, 6);
    expect(get(store, B).resources.cocoa).toBe(0);
    expect(get(store, B).cargo.due).toBe(get(store, B).tide.cycle + 1);
    const s2 = settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    expect(s2.moved.some(m => m.from === A && m.to === B && (m.goods.cocoa ?? 0) > 0)).toBe(true);
    const b2 = get(store, B);
    const inTransit = readLedger(store).consignments.filter(c => c.good === "cocoa").reduce((n, c) => n + c.units, 0);
    expect(a.state.resources.cocoa + b2.resources.cocoa + inTransit).toBeCloseTo(100, 6);
    expect(b2.log.some(m => m.includes(`From ${name(A)}:`) && /cocoa/.test(m))).toBe(true);
    expect(readLedger(store).last[B].imports.cocoa).toBeGreaterThan(0);
  });
  it("multi-hop through a hub: two cycles to cross two lanes; a hub without a warehouse passes a trickle, a warehouse opens it", () => {
    const run = (warehouse: boolean) => {
      const store = new MapStore();
      const a = harborTown(7), hub = harborTown(3, "cinder", B), c = harborTown(9);
      a.state.resources.cocoa = 100; c.state.resources.cocoa = 0; hub.state.resources.cocoa = 0;
      a.state.cargoShips = 3; hub.state.cargoShips = 3; // ships enough that the hub, not the hold, is the limit
      if (warehouse) { hub.state.resources.money += 500; expect(placeByWalkway(hub.state, hub.grid, "warehouse", 1).length).toBe(1); }
      put(store, B, hub.state); put(store, C, c.state);
      const got: number[] = [];
      for (let k = 0; k < 5; k++) {
        const out = settleWorldNow(store, A, a.state, a.grid, { now: 1 });
        got.push(out.moved.filter(m => m.to === C).reduce((n, m) => n + (m.goods.cocoa ?? 0), 0));
        const L = readLedger(store);
        for (const cons of L.consignments) if (cons.good === "cocoa") expect(cons.path).toEqual([A, B, C]);
      }
      const total = a.state.resources.cocoa + get(store, C).resources.cocoa + get(store, B).resources.cocoa + readLedger(store).consignments.reduce((n, x) => n + (x.good === "cocoa" ? x.units : 0), 0);
      expect(total).toBeCloseTo(100, 6);
      return { got, room: hubRoom(get(store, B), "cocoa") };
    };
    const thin = run(false), wide = run(true);
    expect(thin.got[0]).toBe(0); // nothing lands in one cycle across two lanes
    expect(thin.got[1]).toBe(0);
    expect(thin.room).toBe(HUB_BASE_PASS);
    for (const g of thin.got) expect(g).toBeLessThanOrEqual(HUB_BASE_PASS + 1e-6);
    expect(thin.got.some(g => g > 0)).toBe(true);
    expect(wide.room).toBe(HUB_BASE_PASS + WAREHOUSE_CAP);
    expect(Math.max(...wide.got)).toBeGreaterThan(HUB_BASE_PASS);
  });
});

describe("sea lanes: people, weather, the company", () => {
  it("migration: an unhappy sea's residents take the cargo ship to a connected sea with homes free", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8);
    placeByWalkway(a.state, a.grid, "house", 3);
    for (const h of buildingList(a.state)) if (h.kind === "house" || h.kind === "hut") h.residents = a.grid.capacityOf(h);
    placeByWalkway(b.state, b.grid, "house", 4); // empty homes waiting
    b.state.resources.fish = 80;
    put(store, B, b.state);
    a.state.happiness = 0.2;
    const pop0 = population(a.state);
    settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    const left = pop0 - population(a.state);
    expect(left).toBeGreaterThan(0);
    expect(readLedger(store).consignments.some(c => c.good === "people" && c.path[0] === A)).toBe(true);
    expect(a.state.log.some(m => /took the cargo ship/.test(m))).toBe(true);
    const bPop = population(get(store, B));
    a.state.happiness = 0.9;
    const out = settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    expect(out.moved.some(m => m.to === B && m.people === left)).toBe(true);
    expect(population(get(store, B))).toBeGreaterThanOrEqual(bPop + left - 0); // the newcomers (and any immigrants)
  });
  it("storm drift: a World storm moves to the face it was bound for, picks a neighbour, and that sea sees it a cycle early", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8);
    put(store, B, b.state);
    const L = readLedger(store);
    L.storms = [{ id: 99, face: C, next: B, age: 0 }];
    writeLedger(store, L);
    settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    const L2 = readLedger(store);
    const st = L2.storms.find(s => s.id === 99)!;
    expect(st.face).toBe(B);
    expect(neighboursOf(B)).toContain(st.next);
    const b2 = get(store, B);
    expect(b2.storm.active).toBe(true);
    expect(b2.log.some(m => /storm drifted through/.test(m))).toBe(true);
    // The sea the storm is bound for next sees it coming.
    if (st.next === A) expect(a.state.stormComing?.at).toBe(a.state.tide.cycle + 1);
    else expect(a.state.stormComing).toBeNull();
    // Force it toward the active sea: it arrives there at the next World settlement, as a real storm.
    st.next = A; writeLedger(store, L2);
    a.state.storm.lastCycle = -99;
    settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    expect(a.state.storm.active).toBe(true);
    expect(a.state.log.some(m => /drifted in from/.test(m))).toBe(true);
  });
  it("an eruption sends a wave to every built neighbour: at once to the sea being played, on entry to the others", () => {
    const store = new MapStore();
    const volcano = harborTown(3, "cinder", A), b = harborTown(8), far = harborTown(9);
    const farFace = [...Array(12).keys()].find(f => f !== A && !neighboursOf(A).includes(f))!;
    put(store, A, volcano.state); put(store, farFace, far.state);
    // The volcano (a stored sea) erupts; the sea being played is its neighbour B.
    const v = get(store, A);
    v.outbox.push({ kind: "tsunami", from: "eruption", cycle: v.tide.cycle });
    put(store, A, v);
    settleWorldNow(store, B, b.state, b.grid, { now: 1 });
    expect(b.state.tsunami.due).toBe(b.state.tide.cycle + 1);
    expect(b.state.log.some(m => /erupted/.test(m))).toBe(true);
    expect(get(store, A).outbox).toEqual([]);
    expect(get(store, farFace).tsunami.due).toBe(-1);
    // Now the sea being played erupts: its stored neighbour holds the wave until it is entered.
    b.state.tsunami.due = -1;
    const v2 = get(store, A);
    put(store, A, v2);
    const w = harborTown(4, "cinder", B);
    w.state.outbox.push({ kind: "tsunami", from: "eruption", cycle: 1 });
    settleWorldNow(store, B, w.state, w.grid, { now: 1 });
    expect(readLedger(store).pending[A]?.length).toBe(1);
    const entered = get(store, A);
    const g = new Grid(entered);
    expect(applyPending(store, A, entered, g)).toBe(1);
    expect(entered.tsunami.due).toBe(entered.tide.cycle + 1);
    expect(readLedger(store).pending[A]).toBeUndefined();
  });
  it("the company: one harbor a cycle along a connected group; its prices slide with what it bought; a lone sea keeps its own ship", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8), lone = harborTown(9);
    const loneFace = [...Array(12).keys()].find(f => f !== A && f !== B && !neighboursOf(A).includes(f) && !neighboursOf(B).includes(f))!;
    put(store, B, b.state); put(store, loneFace, lone.state);
    const visits: number[] = [];
    for (let k = 0; k < 4; k++) {
      a.state.resources.smoked = 40;
      settleWorldNow(store, A, a.state, a.grid, { now: 1 });
      advanceCycles(a.state, a.grid, 1); // the sea being played runs to its next peak
      const L = readLedger(store);
      visits.push(L.company.visits[`${Math.min(A, B)}-${Math.max(A, B)}`]);
      expect(a.state.trade.routed).toBe(true);
      expect(get(store, B).trade.routed).toBe(true);
      expect(get(store, loneFace).trade.routed ?? false).toBe(false);
    }
    expect(new Set(visits)).toEqual(new Set([A, B]));
    expect(visits[0]).not.toBe(visits[1]);
    // A's own calls sold smoked goods: the World's slide has them.
    settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    const L = readLedger(store);
    expect(L.company.sold.smoked ?? 0).toBeGreaterThan(0);
    expect(a.state.trade.slide?.smoked ?? 1).toBeLessThan(1);
    expect(get(store, loneFace).trade.nextVisit).toBeGreaterThanOrEqual(0);
  });
  it("the idle World settles every built sea once per World cycle", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8);
    put(store, A, a.state); put(store, B, b.state);
    const ca = a.state.tide.cycle, cb = b.state.tide.cycle;
    const out = settleWorldNow(store, null, null, null, { now: 1 });
    expect(out.settled).toEqual([A, B]);
    expect(get(store, A).tide.cycle).toBe(ca + 1);
    expect(get(store, B).tide.cycle).toBe(cb + 1);
    expect(readLedger(store).cycle).toBe(1);
  });
  it("the order the seas settle in never changes the result: two orderings, one hash", () => {
    const store = new MapStore();
    const a = harborTown(7), b = harborTown(8, "atoll", B), c = harborTown(9);
    a.state.resources.cocoa = 80; b.state.resources.smoked = 30;
    placeByWalkway(a.state, a.grid, "house", 3);
    put(store, A, a.state); put(store, B, b.state); put(store, C, c.state);
    const L = readLedger(store); L.storms = [{ id: 7, face: B, next: A, age: 0 }]; writeLedger(store, L);
    const one = store.clone(), two = store.clone();
    for (let k = 0; k < 6; k++) {
      settleWorldNow(one, null, null, null, { now: 1, order: [...Array(12).keys()] });
      settleWorldNow(two, null, null, null, { now: 1, order: [...Array(12).keys()].reverse() });
    }
    const dump = (s: MapStore) => [...s.map.entries()].sort().map(([k, v]) => `${k}=${v}`).join("\n");
    expect(dump(two)).toBe(dump(one));
    expect(readLedger(one).cycle).toBe(6);
  });
});

describe("sea lanes: the shipyard", () => {
  it("builds a cargo ship once every fishing berth is full, from planks, money and iron", () => {
    const { state, grid } = harborTown(7);
    state.resources.money += 2000; state.resources.planks = 200; state.resources.iron = 30;
    const yard = placeByWalkway(state, grid, "shipyard", 1)[0] as Building | undefined;
    if (!yard) return; // no shipyard site on this island's street
    for (const b of buildingList(state)) if ((b.kind === "pier" || b.kind === "dock" || b.kind === "harbor")) b.boats = b.kind === "pier" ? 2 : b.kind === "dock" ? 4 : 6;
    for (const b of buildingList(state)) if (b.kind === "hut" || b.kind === "house") b.residents = grid.capacityOf(b);
    advanceCycles(state, grid, 6);
    if (yard.workers > 0) expect(state.cargoShips).toBeGreaterThan(0);
  });
});
