// The balance probe (docs/world Stage 5), off unless BALANCE=1: a scripted "natural" player on each coast, and two
// connected seas trading, printing when homes first reach levels 2 and 3. `BALANCE=1 npx vitest run test/balance.test.ts`.
// The numbers it prints are recorded in NOTES.md; nothing here asserts them.
import { describe, it } from "vitest";
import { BOAT_CREW, BuildingKind, BUILDINGS } from "../src/sim/balance";
import { addLantern } from "../src/sim/services";
import { BiomeId, costOf, makesOf } from "../src/sim/biomes";
import { canAfford } from "../src/sim/economy";
import { levelAllowed } from "../src/sim/food";
import { GOODS, GOOD_IDS } from "../src/sim/goods";
import { Grid } from "../src/sim/grid";
import { settleWorldNow } from "../src/sim/lanes";
import { readSector, Store, writeSector } from "../src/sim/sectors";
import { newGame } from "../src/sim/start";
import { buildingList, population, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { companyCarries, orderGood } from "../src/sim/trade";
import { joinByLine, placeByWalkway, placeHarbor, placeJoined, starterTown } from "./scenario";
import { updateNetwork } from "../src/sim/network";

const on = !!process.env.BALANCE;
/** The water building a player saves for (the Dunes' wells reach 3), and the coast's luxury maker. */
const WATER: Partial<Record<BiomeId, BuildingKind>> = { dunes: "greatCistern" };
const LUXURY: Partial<Record<BiomeId, BuildingKind>> = { tidewater: "smokehouse", delta: "indigoVats", cinder: "cocoaTerrace", dunes: "coffeeTerrace", atoll: "pearlHouse" };
const SECOND: Partial<Record<BiomeId, BuildingKind>> = { tidewater: "oysterBed", delta: "ricePaddy", cinder: "taroTerrace", dunes: "dateGrove", atoll: "coconutGrove", fjord: "stockfishRacks" };
const BOUND = new Set<BuildingKind>(["taroTerrace", "cocoaTerrace", "dateGrove", "coffeeTerrace", "sulfurWorks", "hotSpring", "lumberCamp", "ironMine"]);

interface Player { state: SimState; grid: Grid; hut: { i: number; j: number } }

/**
 * One cycle of the natural player: a hut whenever there are more jobs than hands; the second food as soon as it is
 * affordable; then a well; then lanterns along the street; then a house when every job is filled and the purse is easy.
 */
function playCycle(p: Player): string | null {
  const { state, grid } = p;
  const biome = state.world.biome;
  const has = (k: BuildingKind) => buildingList(state).some(b => b.kind === k);
  const afford = (k: BuildingKind, spare = 0) => canAfford(state, { ...costOf(k, biome), money: costOf(k, biome).money + spare });
  const put = (k: BuildingKind) => (BOUND.has(k) ? placeJoined(state, grid, k, p.hut) : placeByWalkway(state, grid, k, 1)[0] ?? null);
  const jobs = buildingList(state).reduce((n, b) => n + (b.boats > 0 ? b.boats * BOAT_CREW : BUILDINGS[b.kind].workers), 0);
  const hands = population(state);
  // A workplace left off the street (its line ran out of money): lay the rest of it.
  const stranded = buildingList(state).find(b => !b.reached && (BUILDINGS[b.kind].workers > 0 || !!BUILDINGS[b.kind].service) && BUILDINGS[b.kind].network === "leaf");
  if (stranded && state.resources.money > 40) {
    const links = buildingList(state).filter(x => x.reached && BUILDINGS[x.kind].network !== "leaf").sort((x, y) => Math.hypot(x.cells[0].i - stranded.cells[0].i, x.cells[0].j - stranded.cells[0].j) - Math.hypot(y.cells[0].i - stranded.cells[0].i, y.cells[0].j - stranded.cells[0].j));
    if (links[0]) { joinByLine(state, grid, links[0].cells[0], stranded.cells[0]); updateNetwork(state, grid, state.tide.level); return "join " + stranded.kind; }
  }
  const second = SECOND[biome];
  if (second && grid.inCatalog(second) && !has(second)) return afford(second) && put(second) ? second : null;
  if (hands < jobs - 1 && afford("hut")) return put("hut") ? "hut" : null;
  // Water beside the homes (a well by the first hut: the Dunes' wells reach 3), then the coast's own water building.
  if (!has("well") && afford("well")) return placeJoined(state, grid, "well", p.hut) ? "well" : null;
  const water = WATER[biome];
  if (water && !has(water) && afford(water, 20)) return put(water) ? water : null;
  const lux = LUXURY[biome];
  if (lux && grid.inCatalog(lux) && !has(lux) && afford(lux, 20)) return put(lux) ? lux : null;
  // Idle hands: another of the coast's own workplaces (its producers, in catalog order), the cheapest that fits.
  if (hands > jobs + 1) {
    const kinds = (Object.keys(BUILDINGS) as BuildingKind[]).filter(k => BUILDINGS[k].category === "Production" && BUILDINGS[k].workers > 0 && grid.inCatalog(k) && !["shipyard", "lumberCamp", "sawmill"].includes(k))
      .sort((a, b) => costOf(a, biome).money - costOf(b, biome).money);
    for (const k of kinds) if (afford(k) && buildingList(state).filter(b => b.kind === k).length < 2 && put(k)) return k;
  }
  const dark = buildingList(state).filter(b => b.kind === "walkway" && !b.lantern);
  if (buildingList(state).filter(b => b.lantern).length < 4 && dark.length && state.resources.money >= 30) return addLantern(state, grid, dark[0].cells[0]) ? "lantern" : null;
  if (hands >= jobs && afford("house", 80)) return put("house") ? "house" : null;
  return null;
}

function levels(state: SimState): number {
  return Math.max(0, ...buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0 && b.residents > 0).map(b => b.level));
}

describe.skipIf(!on)("balance probe", () => {
  it("one coast alone: money over four cycles, the first level 2, the first level 3 with a company purchase", { timeout: 900_000 }, () => {
    const rows: string[] = [];
    for (const biome of ["tidewater", "delta", "cinder", "dunes", "atoll", "fjord"] as BiomeId[]) for (const seed of [2, 4, 7]) {
      const { state, grid } = newGame(3, seed, biome);
      const town = starterTown(state, grid);
      const p: Player = { state, grid, hut: town.huts[0].cells[0] };
      const m0 = state.resources.money;
      let m4 = 0, l2 = -1, l3 = -1;
      const log: string[] = [];
      for (let c = 1; c <= 30; c++) {
        const did = playCycle(p);
        if (did) log.push(`c${c} ${did}`);
        if (c === 9) { // a harbor (granted, as the earlier passes did) and, next cycle, a third food and a foreign luxury ordered
          const cost = costOf("harbor", biome);
          state.resources.money += cost.money; state.resources.planks += cost.planks ?? 0;
          placeHarbor(state, grid, town.pier.cells[0]);
        }
        if (c === 10) {
          const carries = companyCarries(state);
          const food = carries.find(g => GOODS[g].role === "food" && !makesOf(biome).includes(g));
          const lux = carries.find(g => GOODS[g].role === "luxury" && !makesOf(biome).includes(g));
          if (food) orderGood(state, food, 30);
          if (lux) orderGood(state, lux, 20);
        }
        advanceCycles(state, grid, 1);
        if (process.env.TRACE === biome && seed === Number(process.env.TSEED ?? 2)) {
          const homes = buildingList(state).filter(b => BUILDINGS[b.kind].residents > 0);
          const cov = state.fields.coverage.water;
          console.log(`  c${c} ${did ?? ""} pop ${population(state)} work ${buildingList(state).reduce((n, b) => n + b.workers, 0)} happy ${state.happiness.toFixed(2)} money ${state.resources.money.toFixed(0)} foods ${GOOD_IDS.filter(g => GOODS[g].role === "food" && state.resources[g] > 0).join("+")} homes ${homes.map(h => h.residents + ":" + h.happiness.toFixed(2) + "w" + cov[(h.cells[0].i + 32) * 64 + h.cells[0].j + 32].toFixed(1)).join(" ")}`);
        }
        if (c === 4) m4 = state.resources.money - m0;
        const lv = levels(state);
        if (lv >= 2 && l2 < 0) l2 = c;
        if (lv >= 3 && l3 < 0) l3 = c;
      }
      rows.push(`${biome.padEnd(9)} seed ${seed}: +${m4.toFixed(0)}$ over 4 · level 2 at c${l2} · level 3 at c${l3} · pop ${population(state)} happy ${state.happiness.toFixed(2)} · ${log.slice(0, 6).join(", ")}`);
    }
    console.log(rows.join("\n"));
  });

  it("two connected seas, no purchases: each gets the other's food and luxury over the lane", { timeout: 900_000 }, () => {
    const store = new MemStore();
    const pair: [BiomeId, BiomeId][] = [["cinder", "dunes"], ["delta", "tidewater"], ["dunes", "fjord"]];
    const rows: string[] = [];
    for (const [ba, bb] of pair) {
      store.map.clear();
      const A = 1, B = 6;
      const a = newGame(A, 4, ba), b = newGame(B, 4, bb);
      const ta = starterTown(a.state, a.grid), tb = starterTown(b.state, b.grid);
      const pa: Player = { ...a, hut: ta.huts[0].cells[0] };
      writeSector(store, B, b.state, { name: "B", biome: bb, created: 1 }, 1);
      writeSector(store, A, a.state, { name: "A", biome: ba, created: 1 }, 1);
      let l3a = -1, l3b = -1, l2a = -1, l2b = -1, oka = -1, okb = -1;
      for (let c = 1; c <= 30; c++) {
        playCycle(pa);
        // The stored sea's player acts between its settlements.
        const rec = readSector(store, B)!;
        const pb: Player = { state: rec.state, grid: new Grid(rec.state), hut: tb.huts[0].cells[0] };
        playCycle(pb);
        if (c === 6) for (const [p, t, biome] of [[pa, ta, ba], [pb, tb, bb]] as const) {
          const cost = costOf("harbor", biome);
          p.state.resources.money += cost.money; p.state.resources.planks += cost.planks ?? 0;
          placeHarbor(p.state, p.grid, t.pier.cells[0]);
        }
        writeSector(store, B, pb.state, { name: "B", biome: bb, created: 1 }, 1);
        advanceCycles(a.state, a.grid, 1);
        const out = settleWorldNow(store, A, a.state, a.grid, { now: 1 });
        const sb = readSector(store, B)!.state;
        if (process.env.TRACE && c % 3 === 0) console.log(`  c${c} harbors ${!!buildingList(a.state).find(x => x.kind === "harbor")}/${!!buildingList(sb).find(x => x.kind === "harbor")} moved ${JSON.stringify(out.moved)} loaded ${JSON.stringify(out.flow.loaded)} A[${GOOD_IDS.filter(g => a.state.resources[g] > 0.5).map(g => g + ":" + a.state.resources[g].toFixed(0)).join(" ")}] B[${GOOD_IDS.filter(g => sb.resources[g] > 0.5).map(g => g + ":" + sb.resources[g].toFixed(0)).join(" ")}] pop ${population(a.state)}/${population(sb)} happy ${a.state.happiness.toFixed(2)}/${sb.happiness.toFixed(2)}`);
        if (levels(a.state) >= 2 && l2a < 0) l2a = c;
        if (levels(sb) >= 2 && l2b < 0) l2b = c;
        if (levels(a.state) >= 3 && l3a < 0) l3a = c;
        if (levelAllowed(a.state, 3) && oka < 0) oka = c;
        if (levelAllowed(sb, 3) && okb < 0) okb = c;
        if (levels(sb) >= 3 && l3b < 0) l3b = c;
      }
      const sb = readSector(store, B)!.state;
      const foods = (s: SimState) => GOOD_IDS.filter(g => GOODS[g].role === "food" && s.resources[g] > 0.01).join("+");
      rows.push(`${ba} ⇄ ${bb}: level 2 at c${l2a} / c${l2b} · level 3 allowed (3 foods + a foreign luxury) from c${oka} / c${okb} · level 3 at c${l3a} / c${l3b} · foods ${foods(a.state)} / ${foods(sb)}`);
    }
    console.log(rows.join("\n"));
  });
});

class MemStore implements Store {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}
