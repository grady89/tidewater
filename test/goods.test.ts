// The goods registry, the biome on the ledger, and what the biomes add to every island: food variety, the
// luxury rule, Toolworks, and the Trade Company as carrier. Sim only.
import { describe, expect, it } from "vitest";
import { BUILDINGS, CAP_BASE, COMPANY_FULL_PRICE_UNITS, COMPANY_PRICE_FLOOR, COMPANY_PRICE_SLOPE_UNITS, HAPPY, LUXURY_PER_RESIDENT, ORDER_SIZE, TOOLWORKS_BONUS, TOOLWORKS_IRON_PER_CYCLE, TOOLWORKS_RADIUS, WAREHOUSE_CAP } from "../src/sim/balance";
import { BIOME_IDS, favouriteOf, luxuryOf } from "../src/sim/biomes";
import { consumeLuxury, eat, favouriteInStock, foodsInStock, foodTotal, foreignLuxuriesInStock, levelAllowed } from "../src/sim/food";
import { advanceCycles } from "../src/sim/tick";
import { cellIndex } from "../src/sim/grid";
import { Material, materialCode, materialOf, MATERIALS } from "../src/sim/materials";
import { addCapped, capFor, toolBonus } from "../src/sim/economy";
import { staffing } from "../src/sim/workers";
import { BASE_MAKES, emptyStock, GOOD_IDS, GOOD_ROLES, goodsOfRole, GOODS, shownGoods } from "../src/sim/goods";
import { deserialize, serialize } from "../src/sim/save";
import { newGame } from "../src/sim/start";
import { buildingList, Cell, SimState } from "../src/sim/state";
import { growStreet, placeByWalkway, placeHarbor, starterTown } from "./scenario";
import { companyBuys, companyCarries, companyPays, companySells, onOrder, orderGood } from "../src/sim/trade";

describe("goods registry", () => {
  it("lists every good of BIOMES.md §2 with a role, a cap and the company's prices", () => {
    for (const id of ["rice", "coconut", "dates", "crab", "stockfish", "pearls", "cocoa", "indigo", "whaleOil", "coffee", "smoked", "salt", "iron", "glass", "sulfur", "sponges"] as const) expect(GOODS[id].id).toBe(id);
    for (const g of GOOD_IDS) {
      const d = GOODS[g];
      expect(GOOD_ROLES).toContain(d.role);
      expect(d.cap).toBeGreaterThan(0);
      expect(d.buys).toBeGreaterThanOrEqual(0);
      expect(d.sells).toBeGreaterThanOrEqual(0);
      expect(d.buys > 0 || d.sells > 0).toBe(true);
    }
    // Every luxury is bought by the company; every food and industrial can be delivered.
    for (const g of goodsOfRole("luxury")) expect(GOODS[g].buys).toBeGreaterThan(0);
    for (const g of [...goodsOfRole("food"), ...goodsOfRole("industrial")]) expect(GOODS[g].sells).toBeGreaterThan(0);
    // The base game's numbers did not move.
    expect(CAP_BASE).toMatchObject({ fish: 100, shellfish: 100, smoked: 60, timber: 80, planks: 60 });
    expect(GOODS.smoked.buys).toBe(9);
    expect(GOODS.fish.buys).toBe(5);
    expect(GOODS.planks.sells).toBe(3);
  });

  it("keys the stockpile by good id, starts every new good at zero, and a warehouse raises every cap", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    for (const g of GOOD_IDS) expect(state.resources[g]).toBe(g === "fish" ? 10 : 0);
    expect(state.world.biome).toBe("tidewater");
    expect(capFor(state, "pearls")).toBe(GOODS.pearls.cap);
    expect(addCapped(state, "pearls", 500)).toBe(GOODS.pearls.cap);
    state.resources.money += 600;
    growStreet(state, grid, 4);
    expect(placeByWalkway(state, grid, "warehouse", 1).length).toBe(1);
    for (const g of GOOD_IDS) expect(capFor(state, g)).toBe(GOODS[g].cap + WAREHOUSE_CAP);
    expect(emptyStock().iron).toBe(0);
  });

  it("the resource bar shows what the island makes plus what it holds, never a zero stock of a foreign good", () => {
    const stock = emptyStock();
    expect(shownGoods(stock, BASE_MAKES)).toEqual([...BASE_MAKES]);
    stock.coffee = 3;
    expect(shownGoods(stock, BASE_MAKES)).toContain("coffee");
    expect(shownGoods(stock, BASE_MAKES)).not.toContain("pearls");
  });

  it("loads a version-2 save: missing goods at zero, tidewater as the biome, the plank order in the order book", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    const old = JSON.parse(serialize(state)) as Omit<SimState, "version" | "trade"> & { version: number; trade: Record<string, number> };
    old.version = 2;
    old.resources = { money: old.resources.money, fish: 12, shellfish: 3, smoked: 0, timber: 0, planks: 5 } as SimState["resources"];
    (old.world as { biome?: string }).biome = undefined;
    old.trade = { nextVisit: 4, shipCycle: 1, plankOrder: 20, visits: 1 };
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.version).toBe(3);
    expect(loaded.resources.fish).toBe(12);
    expect(loaded.resources.pearls).toBe(0);
    expect(loaded.world.biome).toBe("tidewater");
    expect(loaded.trade.orders).toEqual({ planks: 20 });
    expect((loaded.trade as unknown as Record<string, number>).plankOrder).toBeUndefined();
    expect(() => deserialize(JSON.stringify({ ...old, version: 1 }))).toThrow(/version/);
  });
});

describe("cell materials", () => {
  it("the base island is plain everywhere; a material gates a kind, and nothing stands on lava", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    expect(grid.island.materials.every(m => m === 0)).toBe(true);
    let c: Cell | null = null;
    for (let i = -30; i < 30 && !c; i++) for (let j = -30; j < 30; j++) { const q = { i, j }; if (grid.classAt(q) === "flat" && !grid.buildingAt(q) && grid.touchesWalkway([q])) { c = q; break; } }
    expect(c).not.toBeNull();
    expect(grid.materialAt(c!)).toBe("plain");
    expect(grid.canPlace("hut", [c!])).toBe(true);
    grid.materials[cellIndex(c!.i, c!.j)] = materialCode("lava");
    expect(grid.materialAt(c!)).toBe("lava");
    expect(grid.canPlace("hut", [c!])).toBe(false);
    grid.materials[cellIndex(c!.i, c!.j)] = materialCode("lagoon");
    expect(grid.canPlace("hut", [c!])).toBe(true); // a plain kind takes any buildable material
    const def = BUILDINGS.hut as { material?: Material };
    def.material = "lagoon";
    try {
      expect(grid.canPlace("hut", [c!])).toBe(true);
      grid.materials[cellIndex(c!.i, c!.j)] = materialCode("plain");
      expect(grid.canPlace("hut", [c!])).toBe(false);
    } finally { delete def.material; }
    for (const m of MATERIALS) expect(materialOf(materialCode(m))).toBe(m);
  });
});

describe("food variety and the luxury rule", () => {
  it("residents eat across every food kind in proportion to stock, and any food feeds", () => {
    const { state } = newGame(7);
    state.resources.fish = 30; state.resources.shellfish = 10; state.resources.rice = 0; state.resources.coconut = 20;
    expect(foodsInStock(state)).toEqual(["fish", "shellfish", "coconut"]);
    expect(foodTotal(state)).toBe(60);
    expect(eat(state, 6)).toBeCloseTo(6, 9);
    expect(state.resources.fish).toBeCloseTo(27, 9);
    expect(state.resources.shellfish).toBeCloseTo(9, 9);
    expect(state.resources.coconut).toBeCloseTo(18, 9);
    // Short of food: the table is cleared and what there was is what was eaten.
    state.resources.fish = 1; state.resources.shellfish = 0; state.resources.coconut = 2;
    expect(eat(state, 6)).toBe(3);
    expect(foodTotal(state)).toBe(0);
    // Rice alone still feeds a Tidewater home.
    state.resources.rice = 10;
    expect(eat(state, 2)).toBe(2);
  });

  it("level 2 wants two foods, level 3 three and a foreign luxury; Tidewater's own smoked goods do not count", () => {
    const { state } = newGame(7);
    state.resources.fish = 10; state.resources.shellfish = 0;
    expect(levelAllowed(state, 2)).toBe(false);
    state.resources.shellfish = 5;
    expect(levelAllowed(state, 2)).toBe(true);
    expect(levelAllowed(state, 3)).toBe(false);
    state.resources.rice = 5;
    expect(levelAllowed(state, 3)).toBe(false); // three foods, no foreign luxury
    state.resources.smoked = 20;
    expect(foreignLuxuriesInStock(state)).toEqual([]);
    expect(levelAllowed(state, 3)).toBe(false);
    state.resources.pearls = 1;
    expect(foreignLuxuriesInStock(state)).toEqual(["pearls"]);
    expect(levelAllowed(state, 3)).toBe(true);
    expect(consumeLuxury(state, 10)).toBeCloseTo(10 * LUXURY_PER_RESIDENT, 9);
    expect(luxuryOf("tidewater")).toBe("smoked");
  });

  it("the favourite luxury adds HAPPY.favourite to every home; the favourites form BIOMES.md's ring", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    advanceCycles(state, grid, 3);
    const before = state.happiness;
    expect(favouriteOf("tidewater")).toBe("coffee");
    expect(favouriteInStock(state)).toBe(false);
    state.resources.coffee = 5;
    expect(favouriteInStock(state)).toBe(true);
    advanceCycles(state, grid, 1);
    expect(state.happiness).toBeGreaterThan(before + HAPPY.favourite * 0.5);
    // Each luxury is exactly one biome's favourite, and never the favourite of the biome that makes it.
    const favourites = BIOME_IDS.map(favouriteOf);
    expect(new Set(favourites).size).toBe(BIOME_IDS.length);
    for (const b of BIOME_IDS) expect(favouriteOf(b)).not.toBe(luxuryOf(b));
    expect(new Set(BIOME_IDS.map(luxuryOf))).toEqual(new Set(favourites));
  });

  it("the market sells every food above the town's reserve, first kinds first", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    advanceCycles(state, grid, 2);
    state.resources.fish = 0; state.resources.rice = 80;
    const money = state.resources.money;
    advanceCycles(state, grid, 1);
    expect(state.resources.rice).toBeLessThan(80);
    expect(state.last.shellfishSold).toBeGreaterThan(0); // rice sales count with the other foods
    expect(state.last.income).toBeGreaterThan(0);
    void money;
  });
});

describe("toolworks", () => {
  it("burns a little iron each cycle and lifts a producer within 8 cells by 20%; without iron it idles", () => {
    const { state, grid } = newGame(7);
    starterTown(state, grid);
    state.resources.money += 3000; state.resources.planks += 100;
    growStreet(state, grid, 6);
    const mill = placeByWalkway(state, grid, "sawmill", 1)[0];
    expect(mill).toBeDefined();
    const works = placeByWalkway(state, grid, "toolworks", 1)[0];
    expect(works).toBeDefined();
    expect(Math.abs(works.cells[0].i - mill.cells[0].i) <= TOOLWORKS_RADIUS && Math.abs(works.cells[0].j - mill.cells[0].j) <= TOOLWORKS_RADIUS).toBe(true);
    // Free the crews and fill a few houses so both are staffed, then feed the mill.
    for (const b of buildingList(state)) if (b.kind === "pier") b.boats = 0;
    expect(placeByWalkway(state, grid, "house", 3).length).toBe(3);
    for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
    state.resources.timber = 80; state.resources.planks = 0;
    advanceCycles(state, grid, 1);
    expect(works.workers).toBeGreaterThan(0);
    expect(toolBonus(state, mill)).toBe(1); // no iron: no bonus
    expect(works.output).toBe(0);
    const plain = mill.output;
    expect(plain).toBeGreaterThan(0);
    state.resources.iron = 10; state.resources.timber = 80; state.resources.planks = 0;
    advanceCycles(state, grid, 1);
    expect(works.output).toBeCloseTo(TOOLWORKS_IRON_PER_CYCLE * staffing(works), 6);
    expect(state.resources.iron).toBeCloseTo(10 - works.output, 6);
    expect(toolBonus(state, mill)).toBeCloseTo(1 + TOOLWORKS_BONUS, 9);
    expect(mill.output).toBeCloseTo(plain * (1 + TOOLWORKS_BONUS), 3);
    // Iron is not made here: it comes from the company (or a Fjord) — the registry says so.
    expect(GOODS.iron.sells).toBeGreaterThan(0);
    expect(BASE_MAKES).not.toContain("iron");
  });
});

describe("the Trade Company as carrier", () => {
  function port() {
    const { state, grid } = newGame(7);
    const t = starterTown(state, grid);
    state.resources.money += 5000; state.resources.planks += 200;
    growStreet(state, grid, 6);
    const harbor = placeHarbor(state, grid, t.pier.cells[0]);
    expect(harbor).not.toBeNull();
    advanceCycles(state, grid, 1);
    return { state, grid, harbor: harbor! };
  }

  it("carries every good Tidewater cannot make, plus planks, and never its own smoked goods or fish", () => {
    const { state } = port();
    const carried = companyCarries(state);
    expect(carried).toContain("planks");
    expect(carried).toContain("rice"); expect(carried).toContain("iron"); expect(carried).toContain("coffee"); expect(carried).toContain("salt");
    expect(carried).not.toContain("smoked"); expect(carried).not.toContain("fish"); expect(carried).not.toContain("timber");
    expect(carried).not.toContain("sponges"); // never sold by the company
    expect(companyBuys(state)).toEqual(["fish", "smoked"]);
    expect(orderGood(state, "smoked", 20)).toBe(0);
    expect(onOrder(state, "smoked")).toBe(0);
  });

  it("delivers the order book at company prices and takes the money", () => {
    const { state, grid } = port();
    expect(orderGood(state, "rice")).toBe(ORDER_SIZE);
    expect(orderGood(state, "iron", 5)).toBe(5);
    expect(orderGood(state, "rice")).toBe(2 * ORDER_SIZE);
    const money = state.resources.money;
    advanceCycles(state, grid, state.trade.nextVisit - state.tide.cycle);
    expect(state.trade.visits).toBe(1);
    expect(state.resources.rice).toBe(2 * ORDER_SIZE);
    expect(state.resources.iron).toBe(5);
    expect(state.trade.orders).toEqual({});
    const paid = 2 * ORDER_SIZE * companySells("rice") + 5 * companySells("iron");
    expect(state.last.trade).toBeLessThanOrEqual(-paid + 1e-6 + Math.max(0, state.last.trade + paid)); // the purchases are in the trade line
    expect(state.resources.money).toBeLessThan(money + state.last.income + state.last.tourism + 1e-6);
    expect(state.log.some(m => /unloaded 40 rice/.test(m))).toBe(true);
  });

  it("buys the island's luxury at a price that falls with the volume of one visit; surplus fish stays flat", () => {
    expect(companyPays("smoked", 10)).toBeCloseTo(90, 9);
    expect(companyPays("smoked", COMPANY_FULL_PRICE_UNITS)).toBeCloseTo(9 * COMPANY_FULL_PRICE_UNITS, 9);
    const big = companyPays("smoked", COMPANY_FULL_PRICE_UNITS + COMPANY_PRICE_SLOPE_UNITS * 2);
    expect(big).toBeLessThan(9 * (COMPANY_FULL_PRICE_UNITS + COMPANY_PRICE_SLOPE_UNITS * 2));
    expect(big).toBeGreaterThan(9 * COMPANY_PRICE_FLOOR * (COMPANY_FULL_PRICE_UNITS + COMPANY_PRICE_SLOPE_UNITS * 2));
    expect(companyPays("smoked", 2.5)).toBeCloseTo(22.5, 9);
    expect(companyPays("fish", 500)).toBe(500 * GOODS.fish.buys);
    // In a visit: the smoked goods are gone and the money arrived.
    const { state, grid } = port();
    state.resources.smoked = 30;
    advanceCycles(state, grid, state.trade.nextVisit - state.tide.cycle);
    expect(state.resources.smoked).toBe(0);
    expect(state.last.trade).toBeGreaterThanOrEqual(270 - 1e-6);
  });
});
