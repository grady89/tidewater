// Achievements: milestones the ledger notices about itself. Earned ids live in state.achievements in the order
// they were won (so a save keeps them); the check runs once a second of sim time and notifies on each new one.
import { totalBoats } from "./economy";
import { Grid } from "./grid";
import { BUILDINGS } from "./balance";
import { notify, population, SimState } from "./state";

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  done(state: SimState, grid: Grid): boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "firstBoat", title: "First boat", desc: "A boat is tied up at the pier.", done: s => totalBoats(s) >= 1 },
  { id: "firstCatch", title: "First catch", desc: "The boats came home with fish.", done: s => s.last.fishCaught > 0 },
  { id: "firstTrade", title: "First trade", desc: "The trade ship called at the harbor.", done: s => s.trade.visits >= 1 },
  { id: "fifty", title: "Fifty residents", desc: "Fifty people live on the flats.", done: s => population(s) >= 50 },
  { id: "hundred", title: "A hundred residents", desc: "A hundred people call the town home.", done: s => population(s) >= 100 },
  { id: "level3", title: "A fine home", desc: "A home reached its third level.", done: s => Object.values(s.buildings).some(b => BUILDINGS[b.kind].residents > 0 && b.level >= 3) },
  { id: "weathered", title: "Weathered", desc: "The town came through a storm.", done: s => s.storm.lastCycle >= 0 && !s.storm.active },
  { id: "keeper", title: "The keeper", desc: "A lighthouse sees the boats home.", done: s => Object.values(s.buildings).some(b => b.kind === "lighthouse") },
  { id: "isle", title: "Across the water", desc: "The first building stands on the isle.", done: (s, g) => Object.values(s.buildings).some(b => g.onIsle(b.cells)) },
];

export function achievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

/** Award anything newly done. Returns the ids won this call. */
export function checkAchievements(state: SimState, grid: Grid): string[] {
  const won: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id) || !a.done(state, grid)) continue;
    state.achievements.push(a.id);
    notify(state, `★ ${a.title}: ${a.desc}`);
    won.push(a.id);
  }
  return won;
}
