// Pirates v0 (BIOMES.md §4) behind PIRATES_ENABLED (off): presence gathers on unbuilt faces beside busy lanes and
// fades without traffic; a hop can be raided (the hold is lost, the ledger still balances); a staffed fort at an end
// halves the chance; with the flag off nothing of it runs and the fort is not in any catalog.
import { describe, expect, it } from "vitest";
import { PIRATES_ENABLED } from "../src/config";
import { FORT_RAID_FACTOR, PIRATE_RAID_CHANCE } from "../src/sim/balance";
import { catalogFor } from "../src/sim/biomes";
import { neighboursOf, pirateFaces, raidChance, readLedger, settleWorldNow, writeLedger } from "../src/sim/lanes";
import { readSector, Store, writeSector } from "../src/sim/sectors";
import { newGame } from "../src/sim/start";
import { buildingList, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { placeHarbor, starterTown } from "./scenario";

class MapStore implements Store {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}
function harborTown(seed: number, face: number) {
  const { state, grid } = newGame(face, seed);
  const t = starterTown(state, grid);
  state.resources.money += 5000; state.resources.planks += 200;
  expect(placeHarbor(state, grid, t.pier.cells[0])).not.toBeNull();
  advanceCycles(state, grid, 2);
  return { state, grid };
}
const A = 1, B = 6;
const put = (store: Store, f: number, s: SimState) => writeSector(store, f, s, { name: `Sea ${f}`, biome: s.world.biome, created: 1 }, 1);

describe("pirates v0", () => {
  it("is off: the ledger never gathers presence and the fort is in no catalog", () => {
    expect(PIRATES_ENABLED).toBe(false);
    expect(catalogFor("tidewater")).not.toContain("fort");
    const store = new MapStore();
    const a = harborTown(7, A), b = harborTown(8, B);
    a.state.resources.cocoa = 100;
    put(store, B, b.state);
    for (let k = 0; k < 3; k++) settleWorldNow(store, A, a.state, a.grid, { now: 1 });
    expect(readLedger(store).pirates).toEqual({});
  });
  it("gathers on the unbuilt faces beside a busy lane, and fades when the lane is quiet", () => {
    const store = new MapStore();
    const a = harborTown(7, A), b = harborTown(8, B);
    a.state.resources.cocoa = 100;
    put(store, B, b.state);
    settleWorldNow(store, A, a.state, a.grid, { now: 1, pirates: true });
    settleWorldNow(store, A, a.state, a.grid, { now: 1, pirates: true });
    const L = readLedger(store);
    const states = new Map<number, SimState>([[A, a.state], [B, b.state]]);
    const beside = pirateFaces(states, A, B);
    expect(beside.length).toBeGreaterThan(0);
    for (const f of beside) expect(neighboursOf(A).includes(f) || neighboursOf(B).includes(f)).toBe(true);
    expect(Math.max(...beside.map(f => L.pirates[f] ?? 0))).toBeGreaterThan(0);
    const high = Math.max(...Object.values(L.pirates));
    a.state.resources.cocoa = 0;
    for (let k = 0; k < 6; k++) settleWorldNow(store, A, a.state, a.grid, { now: 1, pirates: true });
    expect(Math.max(0, ...Object.values(readLedger(store).pirates))).toBeLessThan(high);
  });
  it("a raid takes the hold, the ledger still balances, and a fort halves the chance", () => {
    const store = new MapStore();
    const a = harborTown(7, A), b = harborTown(8, B);
    put(store, B, b.state);
    const states = new Map<number, SimState>([[A, a.state], [B, b.state]]);
    const L = readLedger(store);
    for (const f of pirateFaces(states, A, B)) L.pirates[f] = 1;
    writeLedger(store, L);
    expect(raidChance(states, readLedger(store), A, B)).toBeCloseTo(PIRATE_RAID_CHANCE, 9);
    // Enough hops that a raid is all but certain; every settlement balances good by good.
    let raided = 0;
    for (let k = 0; k < 16; k++) {
      a.state.resources.cocoa = 100;
      const before = readLedger(store).consignments.reduce((n, c) => n + (c.good === "cocoa" ? c.units : 0), 0);
      const out = settleWorldNow(store, A, a.state, a.grid, { now: 1, pirates: true });
      const after = readLedger(store).consignments.reduce((n, c) => n + (c.good === "cocoa" ? c.units : 0), 0);
      const f = out.flow;
      expect(before + (f.loaded.cocoa ?? 0)).toBeCloseTo((f.landed.cocoa ?? 0) + (f.returned.cocoa ?? 0) + (f.dropped.cocoa ?? 0) + (f.raided.cocoa ?? 0) + after, 6);
      raided += f.raided.cocoa ?? 0;
      const L2 = readLedger(store); for (const x of pirateFaces(states, A, B)) L2.pirates[x] = 1; writeLedger(store, L2);
    }
    expect(raided).toBeGreaterThan(0);
    expect(a.state.log.some(m => /Pirates took/.test(m))).toBe(true);
    // A staffed fort at one end: half the chance (the fort is not in the catalog with the flag off, so it is set
    // down directly here: the rule is what is tested); at both ends, a quarter.
    const fortAt = (st: SimState, id: number) => { st.buildings[id] = { ...buildingList(st)[0], id, kind: "fort", reached: true, damaged: false, workers: 3 }; };
    fortAt(a.state, 9001);
    expect(buildingList(a.state).some(x => x.kind === "fort")).toBe(true);
    expect(raidChance(states, readLedger(store), A, B)).toBeCloseTo(PIRATE_RAID_CHANCE * FORT_RAID_FACTOR, 9);
    fortAt(b.state, 9002);
    expect(raidChance(states, readLedger(store), A, B)).toBeCloseTo(PIRATE_RAID_CHANCE * FORT_RAID_FACTOR * FORT_RAID_FACTOR, 9);
    expect(readSector(store, B)).not.toBeNull();
  });
});
