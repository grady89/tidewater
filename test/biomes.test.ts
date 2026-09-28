// The biome framework: the identity biome reproduces Tidewater exactly; a biome's tide multiplier scales the
// classes, the clearances, the marks and the fixed floors; islands are cached per (biome, seed). Sim only.
import { describe, expect, it } from "vitest";
import { CLEARANCE, SPRING_HI, STILT_MIN, TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { BUILDINGS, LANDFILL_HEIGHT, WAVE_HEIGHT } from "../src/sim/balance";
import { catalogFor, catalogOf, chartedBiomes, makesOf, tideScaleOf } from "../src/sim/biomes";
import { tryPlace } from "../src/sim/economy";
import { newGame as newGame, suggestPier } from "../src/sim/start";
import { Cell } from "../src/sim/state";
import { candidate, island } from "../src/sim/island";
import { deserialize, serialize } from "../src/sim/save";

import { advanceCycles } from "../src/sim/tick";
import { floodFate, tickTide } from "../src/sim/tide";
import { BASE_TIDES, classFor, tidesFor } from "../src/sim/tides";
import { starterTown } from "./scenario";

describe("biome framework", () => {
  it("Tidewater is the identity: base tides, the base catalog, the original island at seed 0", () => {
    expect(tideScaleOf("tidewater")).toBe(1);
    expect(tidesFor(1)).toEqual(BASE_TIDES);
    expect(BASE_TIDES).toMatchObject({ lo: TIDE_LO, hi: TIDE_HI, springHi: SPRING_HI, dryTerrain: SPRING_HI + CLEARANCE, springFloodTerrain: SPRING_HI - STILT_MIN, waveHeight: WAVE_HEIGHT, landfillHeight: LANDFILL_HEIGHT, pierFloor: 1, raisedFloor: 1.2 });
    const all = Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[];
    expect(catalogFor("tidewater")).toContain("toolworks"); // base: no biome owns it
    expect(catalogFor("tidewater")).not.toContain("stockfishRacks");
    expect(catalogOf("tidewater", all, new Set(all))).toEqual(all);
    expect(island(0, "tidewater")).toBe(island(0));
    expect(makesOf("tidewater")).toEqual(["fish", "shellfish", "smoked", "timber", "planks"]);
    expect(chartedBiomes()).toContain("tidewater");
  });

  it("a ×1.6 tide scales every level, the class thresholds, the clearances and the fixed floors", () => {
    const t = tidesFor(1.6);
    expect(t.hi).toBeCloseTo(0.96, 9); expect(t.springHi).toBeCloseTo(1.36, 9); expect(t.lo).toBeCloseTo(-0.56, 9);
    expect(t.highMark).toBeCloseTo(0.4, 9); expect(t.dryTerrain).toBeCloseTo(1.46, 9); expect(t.waveHeight).toBeCloseTo(1.36 + CLEARANCE + 0.45, 9);
    expect(classFor(0.8, BASE_TIDES)).toBe("high"); expect(classFor(0.8, t)).toBe("flat");
    expect(classFor(-0.5, BASE_TIDES)).toBe("deep"); expect(classFor(-0.5, t)).toBe("flat");
    const { state, grid } = newGame(1, 7, "fjord");
    expect(grid.tides.scale).toBe(1.6);
    expect(state.tide.scale).toBe(1.6);
    expect(state.tide.level).toBeCloseTo(TIDE_HI * 1.6, 9);
    // Flats run wider: more cells are flat than on the same ground at Tidewater's tide.
    // The clock peaks at the scaled levels and the spring is scaled too.
    const clock = state.tide;
    let max = -Infinity, min = Infinity;
    for (let s = 0; s < TIDE_PERIOD * 4; s += 1 / 20) { tickTide(clock, 1 / 20); max = Math.max(max, clock.level); min = Math.min(min, clock.level); }
    expect(max).toBeCloseTo(SPRING_HI * 1.6, 2);
    expect(min).toBeLessThan(TIDE_LO * 1.6 + 0.01);
    // Floors: a hut clears the scaled spring peak; a pier's fixed deck is scaled; the flood fate reads the scaled lines.
    const town = starterTown(state, grid);
    expect(town.pier.floorY).toBeCloseTo(1.6, 6);
    for (const h of town.huts) expect(h.floorY).toBeGreaterThanOrEqual(1.36 + CLEARANCE - 1e-9);
    expect(floodFate(1.0, grid.tides)).toBe("spring");
    expect(floodFate(1.5, grid.tides)).toBe("safe");
    expect(floodFate(1.0)).toBe("safe");
    // And the town still runs a few cycles and saves.
    advanceCycles(state, grid, 2);
    const back = deserialize(serialize(state));
    expect(back.tide.scale).toBe(1.6);
    expect(back.world.biome).toBe("fjord");
  });

  it("caches islands per biome and seed, applies the biome's thresholds, and the catalog is base ∪ unique − excluded", () => {
    expect(island(3, "fjord")).toBe(island(3, "fjord"));
    expect(island(3, "fjord")).not.toBe(island(3));
    expect(candidate(3, 0, "fjord").stats.materials.length).toBeGreaterThan(0);
    const cat = catalogFor("fjord");
    expect(cat).toContain("toolworks");
    expect(cat).toContain("stockfishRacks");
    expect(cat).not.toContain("oysterBed");
    expect(cat).toContain("hut");
    expect(makesOf("fjord")).toEqual(["fish", "stockfish", "whaleOil", "iron", "timber", "planks"]);
  });
});

describe("catalog per biome and the starter town", () => {
  it("the grid refuses kinds outside the biome's catalog, the HUD list follows, and any biome seeds a starter hut with a pier site", () => {
    const cat = catalogFor("fjord");
    expect(cat).toContain("toolworks");
    expect(cat).not.toContain("oysterBed");
    expect(catalogFor("tidewater")).toContain("oysterBed");
    const { state, grid } = newGame(1, 11, "fjord");
    expect(grid.inCatalog("oysterBed")).toBe(false);
    expect(grid.inCatalog("hut")).toBe(true);
    state.resources.money += 500;
    let bed: Cell | null = null;
    for (let i = -30; i < 30 && !bed; i++) for (let j = -30; j < 30; j++) { const c = { i, j }; if (grid.classAt(c) === "flat" && !grid.buildingAt(c) && grid.heightAt(c) >= 0 && grid.heightAt(c) <= 0.45 * 1.6) { bed = c; break; } }
    expect(bed).not.toBeNull();
    expect(tryPlace(state, grid, "oysterBed", bed!)).toBeNull();
    // The starter: a hut on the flats and a pier site beside it, on this seed and biome.
    const hut = Object.values(state.buildings)[0];
    expect(hut?.kind).toBe("hut");
    expect(grid.classAt(hut.cells[0])).toBe("flat");
    expect(suggestPier(grid)).not.toBeNull();
    for (const seed of [2, 3, 5]) {
      const g = newGame(1, seed, "fjord");
      expect(Object.values(g.state.buildings).length).toBe(1);
      expect(suggestPier(g.grid)).not.toBeNull();
    }
  });
});
