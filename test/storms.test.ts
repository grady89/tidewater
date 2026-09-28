// Storms and the fleet: before STORM_LOSS_FIRST_CYCLE a storm only keeps the boats in; after it, unsheltered
// boats may be lost — but never a town's last one (the first blind playtests died to a lost only boat).
import { describe, expect, it } from "vitest";
import { STORM_LOSS_FIRST_CYCLE } from "../src/sim/balance";
import { totalBoats } from "../src/sim/economy";
import { startStorm } from "../src/sim/events";
import { newGame } from "../src/sim/start";
import { advanceCycles } from "../src/sim/tick";
import { starterTown } from "./scenario";

function port() {
  const { state, grid } = newGame(7);
  starterTown(state, grid);
  advanceCycles(state, grid, 2);
  return { state, grid };
}

describe("storms and the fleet", () => {
  it("takes no boats before STORM_LOSS_FIRST_CYCLE", () => {
    const { state, grid } = port();
    expect(state.tide.cycle).toBeLessThan(STORM_LOSS_FIRST_CYCLE);
    const boats = totalBoats(state);
    expect(boats).toBeGreaterThan(0);
    for (let k = 0; k < 40; k++) { state.storm.active = false; startStorm(state, grid); }
    expect(totalBoats(state)).toBe(boats);
    expect(state.log.some(m => /storm took/.test(m))).toBe(false);
  });
  it("never takes the last boat, however many storms blow", () => {
    const { state, grid } = port();
    state.tide.cycle = STORM_LOSS_FIRST_CYCLE;
    expect(totalBoats(state)).toBe(2);
    let k = 0;
    for (; k < 60 && totalBoats(state) === 2; k++) { state.storm.active = false; startStorm(state, grid); }
    expect(totalBoats(state)).toBe(1);
    expect(state.log[state.log.length - 1]).toMatch(/storm took 1 boat/);
    for (; k < 60; k++) { state.storm.active = false; startStorm(state, grid); }
    expect(totalBoats(state)).toBe(1);
  });
});
