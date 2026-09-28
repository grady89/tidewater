// A short fuzz run under vitest: two seeds, twenty cycles each, every invariant clean. The overnight run is
// `npm run fuzz` (50 seeds × 2000 cycles); this keeps the fuzzer itself honest on every `npm run test`.
import { describe, expect, it } from "vitest";
import { chartedBiomes } from "../src/sim/biomes";
import { runSeed, runWorld } from "./fuzzCore";

describe("sim fuzzer", () => {
  it("plays random valid actions with every invariant holding, and replays a seed to the same hash", () => {
    const a = runSeed(1, 20), b = runSeed(1, 20);
    expect(a.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
    expect(a.cycles).toBe(20);
    expect(Object.values(a.actions).reduce((n, v) => n + v, 0)).toBeGreaterThan(40);
    expect(a.hash).toBe(b.hash);
    // Every fifth seed plays a generated island on the next charted coast (chartedBiomes() in BIOME_IDS order): one
    // seed per coast other than Tidewater.
    const coasts = chartedBiomes();
    for (let k = 1; k < coasts.length; k++) {
      const c = runSeed(5 * k, 12);
      expect(c.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
      expect(c.biome).toBe(coasts[k]);
    }
  });
  it("plays a three-sea World over its lanes with every lane invariant holding, and the order the seas settle in never changes its hash", () => {
    const up = runWorld(3, 14, "up"), down = runWorld(3, 14, "down");
    expect(up.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
    expect(down.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
    expect(up.hash).toBe(down.hash);
  });
});
