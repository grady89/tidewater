// The World's sector model: bands and biomes, the packer, write/read round trips, the storage budget with twelve
// 300-building towns, export/import, migration from the autosave and the slots, the active sector.
import { describe, expect, it } from "vitest";
import { BAND_GATING } from "../src/config";
import { compress, decompress, isPacked } from "../src/sim/compress";
import { serialize, stateHash } from "../src/sim/save";
import { agoLabel, bandOf, biomeAllowed, biomeBlurb, BIOMES_BY_BAND, biomesFor, defaultName, isCharted, deleteSector, exportSector, FACES, importSector, listMetas, migrateLegacy, readActive, readMeta, readSector, renameSector, Store, writeActive, writeSector } from "../src/sim/sectors";
import { newGame } from "../src/sim/start";
import { advanceCycles } from "../src/sim/tick";
import { bigTown, starterTown } from "./scenario";

class MapStore implements Store {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  /** UTF-16 code units held, the unit browsers meter. */
  get units() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
}

function town(seed = 7) {
  const { state, grid } = newGame(seed);
  starterTown(state, grid);
  advanceCycles(state, grid, 2);
  return { state, grid };
}

describe("the World's sectors: bands and biomes", () => {
  it("has two polar, five temperate and five tropical faces; Tidewater, the Fjord and the Atoll are charted", () => {
    expect([0, 11].map(bandOf)).toEqual(["polar", "polar"]);
    expect([1, 2, 3, 4, 5].map(bandOf)).toEqual(Array(5).fill("temperate"));
    expect([6, 7, 8, 9, 10].map(bandOf)).toEqual(Array(5).fill("tropical"));
    // The band's own coasts first, then (gating off) every other, Tidewater first wherever it is a guest.
    expect(biomesFor(3).map(b => b.biome)).toEqual(["tidewater", "delta", "dunes", "atoll", "cinder", "fjord"]);
    expect(biomesFor(8).map(b => b.biome)).toEqual(["tidewater", "atoll", "cinder", "delta", "dunes", "fjord"]);
    expect(biomesFor(0).map(b => b.biome)).toEqual(["tidewater", "fjord", "delta", "dunes", "atoll", "cinder"]);
    for (let f = 0; f < FACES; f++) {
      expect(biomeAllowed(f, "tidewater")).toBe(!BAND_GATING || bandOf(f) === "temperate");
      for (const b of biomesFor(f)) expect(b.charted).toBe(isCharted(b.biome) && (!BAND_GATING || BIOMES_BY_BAND[bandOf(f)].includes(b.biome)));
    }
    expect(isCharted("fjord")).toBe(true); expect(isCharted("atoll")).toBe(true); expect(isCharted("delta")).toBe(false);
    expect(biomeBlurb("fjord")).toMatch(/stockfish/);
    expect(BAND_GATING).toBe(false);
  });
});

describe("the packer", () => {
  it("round-trips JSON with unicode and long repeats, and folds a town's save to a fraction", () => {
    const samples = ["", "{}", "{\"name\":\"Bærum Sjø ❤ 🌊\",\"x\":[1,2,3]}", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "abcabcabcabcabcabcabcabcabcabcabcabcabcabcabc"];
    for (const s of samples) expect(decompress(compress(s))).toBe(s);
    const { state } = town();
    const json = serialize(state);
    const packed = compress(json);
    expect(decompress(packed)).toBe(json);
    expect(isPacked(packed)).toBe(true);
    expect(isPacked(json)).toBe(false);
    expect(packed.length).toBeLessThan(json.length * 0.5);
    // Long inputs cross the dictionary reset.
    const long = Array.from({ length: 200000 }, (_, k) => String.fromCharCode(97 + ((k * k) % 26))).join("");
    expect(decompress(compress(long))).toBe(long);
  });
});

describe("sector records", () => {
  it("writes, lists, reads back an identical state, renames and deletes", () => {
    const store = new MapStore();
    const { state } = town();
    const meta = writeSector(store, 3, state, { name: "Salt Marsh", biome: "tidewater" }, 1000);
    expect(meta).toMatchObject({ version: 1, face: 3, name: "Salt Marsh", seed: 0, biome: "tidewater", band: "temperate", cycles: 2, created: 1000, lastPlayed: 1000 });
    expect(meta.buildings).toBe(Object.keys(state.buildings).length);
    expect(meta.population).toBeGreaterThanOrEqual(0);
    expect(listMetas(store).map(m => (m ? m.face : null))).toEqual([null, null, null, 3, null, null, null, null, null, null, null, null]);
    const rec = readSector(store, 3)!;
    expect(stateHash(rec.state)).toBe(stateHash(state));
    expect(rec.meta.name).toBe("Salt Marsh");
    expect(renameSector(store, 3, "  Low Water ")!.name).toBe("Low Water");
    expect(readMeta(store, 3)!.name).toBe("Low Water");
    expect(readSector(store, 5)).toBeNull();
    writeActive(store, 3);
    expect(readActive(store)).toBe(3);
    deleteSector(store, 3);
    expect(readMeta(store, 3)).toBeNull();
    expect(readSector(store, 3)).toBeNull();
    expect(readActive(store)).toBeNull();
    expect(() => writeSector(store, 12, state, { name: "x", biome: "tidewater" })).toThrow(/face/);
  });

  it("twelve 300-building towns fit a 5 MB localStorage (UTF-16 units) once packed", () => {
    const store = new MapStore();
    const { state, grid } = newGame(1);
    starterTown(state, grid);
    state.resources.money += 100000; state.resources.planks += 5000; state.resources.timber += 5000;
    bigTown(state, grid);
    advanceCycles(state, grid, 3);
    const plain = serialize(state).length;
    for (let f = 0; f < FACES; f++) writeSector(store, f, state, { name: `Sea ${f}` , biome: "tidewater" }, 5000 + f);
    const units = store.units;
    // 5 MB is 2.62 M UTF-16 units; plain JSON would be twelve × ~340 K = 4 M units and would not fit.
    expect(plain * FACES).toBeGreaterThan(2_600_000);
    expect(units).toBeLessThan(2_600_000);
    expect(readSector(store, 11)!.state.buildings).toEqual(state.buildings);
  });

  it("exports a portable record and imports it onto another face; rejects garbage and foreign saves", () => {
    const store = new MapStore();
    const { state } = town(3);
    writeSector(store, 2, state, { name: "Exported", biome: "tidewater" }, 100);
    const json = exportSector(store, 2)!;
    const parsed = JSON.parse(json) as { version: number; meta: { name: string }; state: { version: number } };
    expect(parsed.version).toBe(1);
    expect(parsed.meta.name).toBe("Exported");
    expect(parsed.state.version).toBe(3);
    const meta = importSector(store, 7, json, 200);
    expect(meta).toMatchObject({ face: 7, name: "Exported", band: "tropical", created: 100, lastPlayed: 200 });
    expect(stateHash(readSector(store, 7)!.state)).toBe(stateHash(state));
    expect(exportSector(store, 9)).toBeNull();
    expect(() => importSector(store, 8, "nope")).toThrow(/JSON/);
    expect(() => importSector(store, 8, JSON.stringify({ version: 1, meta: { name: "x" } }))).toThrow(/record/);
    expect(() => importSector(store, 8, JSON.stringify({ version: 1, meta: { name: "x" }, state: { version: 1 } }))).toThrow(/version/);
    expect(readMeta(store, 8)).toBeNull();
  });

  it("migrates the autosave and the slots once, keeping seeds and names", () => {
    const store = new MapStore();
    const a = newGame(1, 0), s1 = newGame(1, 7), s3 = newGame(1, 42);
    starterTown(a.state, a.grid);
    store.setItem("tidewater.autosave", serialize(a.state));
    store.setItem("tidewater.slot.1", serialize(s1.state));
    store.setItem("tidewater.slot.1.meta", JSON.stringify({ name: "Herring Bay", savedAt: 1234, cycle: 0 }));
    store.setItem("tidewater.slot.3", serialize(s3.state));
    store.setItem("tidewater.slot.3.meta", JSON.stringify({ name: "", savedAt: 99, cycle: 0 }));
    const moved = migrateLegacy(store, 5000);
    expect(moved.map(m => [m.face, m.name, m.seed])).toEqual([[1, "First Sea", 0], [2, "Herring Bay", 7], [4, "Town 3", 42]]);
    expect(readActive(store)).toBe(1);
    expect(readMeta(store, 3)).toBeNull();
    expect(stateHash(readSector(store, 2)!.state)).toBe(stateHash(s1.state));
    expect(readMeta(store, 2)!.lastPlayed).toBe(1234);
    expect(migrateLegacy(store, 6000)).toEqual([]); // once
    expect(store.getItem("tidewater.autosave")).not.toBeNull(); // the old keys are left alone
  });

  it("names new seas by count, and says how long ago", () => {
    const store = new MapStore();
    expect(defaultName(store)).toBe("First Sea");
    writeSector(store, 1, town().state, { name: "First Sea", biome: "tidewater" }, 1);
    expect(defaultName(store)).toBe("Second Sea");
    writeSector(store, 2, town().state, { name: "Second Sea", biome: "tidewater" }, 2);
    renameSector(store, 2, "Third Sea");
    expect(defaultName(store)).toBe("Fourth Sea");
    expect(agoLabel(1000, 1000 + 30 * 1000)).toBe("just now");
    expect(agoLabel(1000, 1000 + 5 * 60 * 1000)).toBe("5 minutes ago");
    expect(agoLabel(1000, 1000 + 3 * 3600 * 1000)).toBe("3 hours ago");
    expect(agoLabel(1000, 1000 + 5 * 86400 * 1000)).toBe("5 days ago");
  });
});
