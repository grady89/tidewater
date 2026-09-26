// Sim-only unit checks. Nothing here may pull in Babylon; the hygiene test enforces that for src/sim/**.
import { describe, expect, it } from "vitest";
import { TIDE_HI, TIDE_LO, TIDE_PERIOD } from "../src/config";
import { TideClock } from "../src/sim/tide";

const simSources = import.meta.glob("../src/sim/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("sim hygiene", () => {
  it("has sim sources to check", () => {
    expect(Object.keys(simSources).length).toBeGreaterThan(0);
  });
  it("never imports Babylon directly", () => {
    for (const [file, src] of Object.entries(simSources)) {
      expect(src.includes("@babylonjs"), `${file} imports Babylon`).toBe(false);
    }
  });
});

describe("tide clock", () => {
  it("starts at high tide and completes a cycle in TIDE_PERIOD seconds", () => {
    const tide = new TideClock();
    expect(tide.level).toBeCloseTo(TIDE_HI, 5);
    const dt = 1 / 60;
    let peaks = 0;
    for (let t = 0; t < TIDE_PERIOD * 2.5; t += dt) { tide.update(dt); if (tide.peaked) peaks++; }
    expect(peaks).toBe(2);
    expect(tide.cycle).toBe(2);
  });

  it("reaches low tide half way through the cycle", () => {
    const tide = new TideClock();
    const dt = 1 / 60;
    for (let t = 0; t < TIDE_PERIOD / 2; t += dt) tide.update(dt);
    expect(tide.level).toBeCloseTo(TIDE_LO, 2);
    expect(tide.normalized).toBeCloseTo(0, 2);
    expect(tide.rising).toBe(true);
  });

  it("wet sand lags the falling water", () => {
    const tide = new TideClock();
    for (let i = 0; i < 60 * 10; i++) tide.update(1 / 60);
    expect(tide.wetLevel).toBeGreaterThan(tide.level);
  });

  it("honours a level override", () => {
    const tide = new TideClock();
    tide.override = 0.97;
    tide.update(1 / 60);
    expect(tide.level).toBe(0.97);
    tide.override = null;
    tide.update(1 / 60);
    expect(tide.level).toBeLessThan(0.97);
  });
});
