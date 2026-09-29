// Jobs are kept: a new workplace hires only free hands, and nobody leaves a job for a nearer one.
import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../src/sim/balance";
import { newGame } from "../src/sim/start";
import { buildingList, population, SimState } from "../src/sim/state";
import { advanceCycles } from "../src/sim/tick";
import { jobsAt } from "../src/sim/workers";
import { placeByWalkway, starterTown } from "./scenario";

const held = (state: SimState, work: number) => state.assignments.filter(a => a.work === work).reduce((n, a) => n + (a.held ?? a.n), 0);
const free = (state: SimState) => population(state) - state.assignments.reduce((n, a) => n + (a.held ?? a.n), 0);

describe("jobs", () => {
  it("a market keeps its worker when a workplace opens nearer the homes; the new one hires only free hands", () => {
    const { state, grid } = newGame(3, 4, "fjord");
    starterTown(state, grid);
    state.resources.money += 2000;
    advanceCycles(state, grid, 3);
    const market = buildingList(state).find(b => b.kind === "market")!;
    expect(market.workers).toBe(1);
    const before = state.assignments.find(a => a.work === market.id)!;
    const spare = free(state);
    // Racks beside the homes: two more jobs than the town has hands for (this took the market's worker before).
    const racks = placeByWalkway(state, grid, "stockfishRacks", 1)[0];
    expect(racks).toBeDefined();
    advanceCycles(state, grid, 1);
    expect(market.workers).toBe(1);
    expect(state.assignments.find(a => a.work === market.id)).toMatchObject({ home: before.home, work: market.id });
    expect(held(state, racks.id)).toBeLessThanOrEqual(spare);
    // Everyone who works still works where they did; the racks got whoever had no job.
    for (let c = 0; c < 4; c++) { advanceCycles(state, grid, 1); expect(market.workers).toBe(1); }
  });

  it("an injured worker keeps the job and goes back to it when healed", () => {
    const { state, grid, t } = (() => { const g = newGame(3, 7, "tidewater"); return { ...g, t: starterTown(g.state, g.grid) }; })();
    advanceCycles(state, grid, 3);
    const a = state.assignments.find(x => x.n > 0)!;
    const home = state.buildings[a.home], work = state.buildings[a.work];
    home.injured = home.residents;
    advanceCycles(state, grid, 1);
    const kept = state.assignments.find(x => x.home === home.id && x.work === work.id)!;
    expect(kept.n).toBe(0);
    expect(kept.held).toBeGreaterThan(0);
    home.injured = 0;
    advanceCycles(state, grid, 1);
    expect(state.assignments.find(x => x.home === home.id && x.work === work.id)!.n).toBe(kept.held);
    void t;
  });

  it("jobs held never outnumber a workplace's jobs or a home's people", () => {
    const { state, grid } = newGame(3, 2, "tidewater");
    starterTown(state, grid);
    state.resources.money += 3000;
    placeByWalkway(state, grid, "hut", 4);
    placeByWalkway(state, grid, "oysterBed", 2);
    for (let c = 0; c < 8; c++) {
      advanceCycles(state, grid, 1);
      for (const b of buildingList(state)) {
        expect(held(state, b.id)).toBeLessThanOrEqual(jobsAt(b));
        if (BUILDINGS[b.kind].residents > 0) expect(state.assignments.filter(x => x.home === b.id).reduce((n, x) => n + (x.held ?? x.n), 0)).toBeLessThanOrEqual(b.residents);
      }
    }
  });
});
