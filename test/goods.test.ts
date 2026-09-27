// The goods registry, the biome on the ledger, and what the biomes add to every island: food variety, the
// luxury rule, Toolworks, and the Trade Company as carrier. Sim only.
import { describe, expect, it } from "vitest";
import { BUILDINGS, CAP_BASE, WAREHOUSE_CAP } from "../src/sim/balance";
import { cellIndex } from "../src/sim/grid";
import { Material, materialCode, materialOf, MATERIALS } from "../src/sim/materials";
import { addCapped, capFor } from "../src/sim/economy";
import { BASE_MAKES, emptyStock, GOOD_IDS, GOOD_ROLES, goodsOfRole, GOODS, shownGoods } from "../src/sim/goods";
import { deserialize, serialize } from "../src/sim/save";
import { newGame } from "../src/sim/start";
import { Cell, SimState } from "../src/sim/state";
import { growStreet, placeByWalkway, starterTown } from "./scenario";

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
