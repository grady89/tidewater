// A short fuzz run under vitest: two seeds, twenty cycles each, every invariant clean. The overnight run is
// `npm run fuzz` (50 seeds × 2000 cycles); this keeps the fuzzer itself honest on every `npm run test`.
import { describe, expect, it } from "vitest";
import { runSeed } from "./fuzzCore";

describe("sim fuzzer", () => {
  it("plays random valid actions with every invariant holding, and replays a seed to the same hash", () => {
    const a = runSeed(1, 20), b = runSeed(1, 20);
    expect(a.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
    expect(a.cycles).toBe(20);
    expect(Object.values(a.actions).reduce((n, v) => n + v, 0)).toBeGreaterThan(40);
    expect(a.hash).toBe(b.hash);
    const c = runSeed(5, 12); // every fifth seed plays a generated island
    expect(c.failures.map(f => f.invariant + " · " + f.detail)).toEqual([]);
  });
});
