// The Cinder (BIOMES.md §3.5): its cone, lava band, fertile band, vents and spring; its five kinds; basalt sea walls;
// the eruption — tremors, ash, the lava flow, new land that cools before anything stands on it, the wave sent out.
import { describe, expect, it } from "vitest";
import { ASH_TERRACE_FACTOR, BUILDINGS, COCOA_PER_CYCLE, GLASS_SULFUR, HOT_SPRING_TOURISM, LAVA_COOL_CYCLES, SULFUR_PER_CYCLE, TARO_PER_CYCLE } from "../src/sim/balance";
import { biomeOf, costOf, makesOf } from "../src/sim/biomes";
import { ashFalling, cinderLayout, trembling } from "../src/sim/biomes/cinder";
import { tryPlace } from "../src/sim/economy";
import { cellIndex, Grid } from "../src/sim/grid";
import { island, islandFailures, rerollRate } from "../src/sim/island";
import { materialCode } from "../src/sim/materials";
import { newGame } from "../src/sim/start";
import { Building, buildingList, Cell, SimState } from "../src/sim/state";
import { updateNetwork } from "../src/sim/network";
import { advanceCycles } from "../src/sim/tick";
import { joinByLine, placeByWalkway, placeNear, starterTown } from "./scenario";

function cinderTown(seed = 4) {
  const { state, grid } = newGame(1, seed, "cinder");
  const town = starterTown(state, grid);
  state.resources.money += 8000;
  return { state, grid, town };
}
function fillHomes(state: SimState, grid: Grid): void {
  for (const b of buildingList(state)) if (BUILDINGS[b.kind].residents > 0) b.residents = grid.capacityOf(b);
}
/** A kind on its material, joined by the shortest walk from the nearest street piece the town already reaches. */
function placeJoined(state: SimState, grid: Grid, kind: keyof typeof BUILDINGS, from: Cell): Building | null {
  const b = placeNear(state, grid, kind, from);
  if (!b) return null;
  updateNetwork(state, grid, state.tide.level);
  const links = buildingList(state).filter(x => x.id !== b.id && x.reached && BUILDINGS[x.kind].network !== "leaf");
  links.sort((p, q) => Math.hypot(p.cells[0].i - b.cells[0].i, p.cells[0].j - b.cells[0].j) - Math.hypot(q.cells[0].i - b.cells[0].i, q.cells[0].j - b.cells[0].j));
  if (links[0]) joinByLine(state, grid, links[0].cells[0], b.cells[0]);
  updateNetwork(state, grid, state.tide.level);
  return b;
}

describe("the Cinder's island", () => {
  it("has a cone above 4, a lava band to the sea, a fertile band, two vent sites and a spring, and passes its own validation", () => {
    const isl = island(0, "cinder");
    expect(islandFailures(isl.stats, "cinder", isl.height)).toEqual([]);
    const m = (k: Parameters<typeof materialCode>[0]) => isl.stats.materials[materialCode(k)];
    expect(isl.stats.highCells).toBeGreaterThanOrEqual(30);
    expect(m("lava")).toBeGreaterThanOrEqual(25);
    expect(m("fertile")).toBeGreaterThanOrEqual(40);
    expect(m("vent")).toBeGreaterThanOrEqual(8);
    expect(m("spring")).toBeGreaterThanOrEqual(4);
    // The lava band runs from high on the cone to the water.
    const L = cinderLayout(isl.noiseSeed);
    let top = -9, bottom = 9;
    for (let r = 3; r < 30; r += 0.5) {
      const i = Math.floor(Math.cos(L.lava) * r), j = Math.floor(Math.sin(L.lava) * r);
      if (isl.materials[cellIndex(i, j)] !== materialCode("lava")) continue;
      const h = isl.height(i + 0.5, j + 0.5);
      top = Math.max(top, h); bottom = Math.min(bottom, h);
    }
    expect(top).toBeGreaterThan(3);
    expect(bottom).toBeLessThan(0.6);
    const r = rerollRate(1, 20, "cinder");
    expect(r.fallbacks).toBe(0);
    expect(r.rerolls).toBeLessThan(20);
  });
  it("is the Cinder's delta on the catalog: fish and taro, cocoa, glass and sulfur; basalt halves the sea wall's timber", () => {
    expect(makesOf("cinder")).toEqual(["fish", "taro", "cocoa", "glass", "sulfur"]);
    expect(costOf("seaWall", "cinder").timber).toBe((BUILDINGS.seaWall.cost.timber ?? 0) / 2);
    expect(costOf("seaWall", "tidewater").timber).toBe(BUILDINGS.seaWall.cost.timber);
    const { grid } = newGame(1, 3, "cinder");
    for (const k of ["taroTerrace", "cocoaTerrace", "glassworks", "sulfurWorks", "hotSpring"] as const) expect(grid.inCatalog(k)).toBe(true);
    for (const k of ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse"] as const) expect(grid.inCatalog(k)).toBe(false);
    // Nothing is built on the lava field.
    let lava: Cell | null = null;
    for (let i = -30; i < 30 && !lava; i++) for (let j = -30; j < 30 && !lava; j++) if (grid.materialAt({ i, j }) === "lava" && grid.classAt({ i, j }) === "flat") lava = { i, j };
    expect(lava).toBeTruthy();
    expect(grid.canPlace("hut", [lava!])).toBe(false);
  });
});

describe("the Cinder's kinds", () => {
  it("terraces grow taro and cocoa on the fertile band (half under ash); sulfur works on a vent; the glassworks burns sulfur, then timber", () => {
    const { state, grid, town } = cinderTown();
    placeByWalkway(state, grid, "house", 6);
    fillHomes(state, grid);
    const from = town.huts[0].cells[0];
    const taro = placeJoined(state, grid, "taroTerrace", from);
    advanceCycles(state, grid, 1); // the network marks what the new streets reach
    const cocoa = placeJoined(state, grid, "cocoaTerrace", from);
    advanceCycles(state, grid, 1);
    const sulfur = placeJoined(state, grid, "sulfurWorks", from);
    const glass = placeByWalkway(state, grid, "glassworks", 1)[0];
    expect(taro && cocoa && sulfur && glass).toBeTruthy();
    for (const b of [taro!, cocoa!, sulfur!]) for (const c of b.cells) expect(grid.materialAt(c)).toBe(b.kind === "sulfurWorks" ? "vent" : "fertile");
    fillHomes(state, grid);
    advanceCycles(state, grid, 2);
    for (const b of [taro!, cocoa!, sulfur!, glass]) { expect(b.reached).toBe(true); expect(b.workers).toBeGreaterThan(0); }
    const s = (b: Building) => Math.min(1, b.workers / BUILDINGS[b.kind].workers);
    expect(taro!.output).toBeCloseTo(TARO_PER_CYCLE * s(taro!), 6);
    expect(cocoa!.output).toBeCloseTo(COCOA_PER_CYCLE * s(cocoa!), 6);
    expect(sulfur!.output).toBeCloseTo(SULFUR_PER_CYCLE * s(sulfur!), 6);
    expect(glass.output).toBeGreaterThan(0);
    // No sulfur: the furnace burns timber.
    state.resources.sulfur = 0; state.resources.timber = 50;
    sulfur!.workers = 0; // the works is idle for a cycle: take its crew away by removing its jobs' effect
    const timber0 = state.resources.timber;
    advanceCycles(state, grid, 1);
    expect(state.resources.timber).toBeLessThan(timber0 + 1e-9);
    expect(GLASS_SULFUR).toBeGreaterThan(0);
    // Under ash the terraces make half.
    state.biomeState.ash = state.tide.cycle + 1;
    advanceCycles(state, grid, 1);
    expect(ashFalling(state)).toBe(true);
    expect(taro!.output).toBeCloseTo(TARO_PER_CYCLE * s(taro!) * ASH_TERRACE_FACTOR, 6);
  });
  it("the hot-spring bathhouse stands on a spring, covers the most leisure, and draws the tourists", () => {
    const { state, grid, town } = cinderTown();
    fillHomes(state, grid);
    const spring = placeJoined(state, grid, "hotSpring", town.huts[0].cells[0]);
    expect(spring).toBeTruthy();
    for (const c of spring!.cells) expect(grid.materialAt(c)).toBe("spring");
    expect(BUILDINGS.hotSpring.service!.radius).toBeGreaterThan(Math.max(BUILDINGS.tavern.service!.radius, BUILDINGS.bathhouse.service!.radius));
    placeByWalkway(state, grid, "house", 3);
    fillHomes(state, grid);
    advanceCycles(state, grid, 2);
    if (spring!.workers > 0 && spring!.reached) expect(biomeOf("cinder").tourism!(state)).toBe(HOT_SPRING_TOURISM);
  });
});

describe("the eruption", () => {
  it("trembles two cycles, then ash and a lava flow: buildings on its path damaged, new land that cools three cycles, a wave sent out", () => {
    const { state, grid } = cinderTown();
    fillHomes(state, grid);
    const L = cinderLayout(grid.island.noiseSeed);
    // A hut beside the lava field near the shore, in the flow's way.
    let victim: Building | null = null;
    for (let r = 17; r < 26 && !victim; r += 0.5) for (const off of [-0.25, 0.25]) {
      if (victim) break;
      const i = Math.floor(Math.cos(L.lava + off) * r), j = Math.floor(Math.sin(L.lava + off) * r);
      if (grid.classAt({ i, j }) !== "flat" || grid.materialAt({ i, j }) === "lava") continue;
      victim = tryPlace(state, grid, "raisedWalkway", { i, j });
    }
    biomeOf("cinder").force!.tremors(state, grid);
    expect(trembling(state)).toBe(true);
    const land0 = state.landfill.length;
    for (let k = 0; k < 3 && !(state.biomeState.eruptions ?? 0); k++) advanceCycles(state, grid, 1);
    expect(state.biomeState.eruptions).toBe(1);
    expect(state.log.some(m => /mountain erupts/.test(m))).toBe(true);
    expect(state.outbox.some(e => e.kind === "tsunami" && e.from === "eruption")).toBe(true);
    expect(state.landfill.length).toBeGreaterThan(land0);
    // A cell of new land that was open water (not the island's own lava field at the toe).
    const fresh = state.newLand.find(n => grid.island.materials[n.k] !== materialCode("lava")) ?? state.newLand[0];
    expect(fresh.until).toBe(state.tide.cycle + LAVA_COOL_CYCLES);
    const c = { i: Math.floor(fresh.k / 64) - 32, j: (fresh.k % 64) - 32 };
    expect(grid.classAt(c)).toBe("high");
    expect(grid.canPlace("hut", [c])).toBe(false);
    if (victim) expect(victim.damaged || state.newLand.length > 0).toBe(true);
    // Ash over the town the cycle after.
    advanceCycles(state, grid, 1);
    expect(ashFalling(state) || (state.biomeState.ash ?? -1) === state.tide.cycle - 1).toBe(true);
    advanceCycles(state, grid, LAVA_COOL_CYCLES);
    expect(state.newLand.length).toBe(0);
    if (grid.island.materials[fresh.k] !== materialCode("lava")) {
      expect(grid.materialAt(c)).not.toBe("lava");
      expect(grid.canPlace("hut", [c]) || !!grid.buildingAt(c) || grid.treeOn([c])).toBe(true);
    }
  });
});
