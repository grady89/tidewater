// Sea lanes (BIOMES.md §4), the first cut, behind LANES_ENABLED (config.ts, off). The World ledger: while one sea
// is played, every other built sea ticks settlement-only — one settlement per active cycle, no hazards ("your
// absence is safe") — and goods flow along lanes: a lane joins two built faces that share an edge and each have a
// harbor; per cycle each harbor's cargo ships carry, along each of its lanes, what its island has above its
// reserve toward what the neighbour holds below its want, one hop, applied at the neighbour's next settlement.
// Sim-only: sectors are read and written through the injected Store, the face adjacency comes from the
// dodecahedron's own table. Nothing here runs until the flag is on.
import { LANES_ENABLED } from "../config";
import { FACES as FACE_LIST } from "../globe/geometry";
import { CARGO_HOLD, CARGO_SHIPS_PER_HARBOR, FOOD_PER_CYCLE, FOOD_RESERVE_CYCLES, IMMIGRANTS_PER_CYCLE, LANE_RESERVE_FRACTION, LANE_WANT_FRACTION } from "./balance";
import { biomeFor } from "./biomes";
import { addCapped, capFor, settleCycle } from "./economy";
import { GOOD_IDS, GoodId, GOODS } from "./goods";
import { Grid } from "./grid";
import { updateNetwork } from "./network";
import { readSector, Store, writeSector } from "./sectors";
import { notify, population, SimState } from "./state";
import { peakLevel } from "./tide";
import { harborOf } from "./trade";

/** Faces sharing an edge with `face`. */
export function neighboursOf(face: number): readonly number[] {
  return FACE_LIST[face].neighbours;
}

/** A settlement without the ticks between: the clock moves one cycle to its peak and the ledger settles, quietly. */
export function settleOnly(state: SimState, grid: Grid): void {
  const t = state.tide;
  t.cycle++;
  t.phase = Math.PI / 2 + t.cycle * Math.PI * 2;
  t.level = peakLevel(t.cycle, t.scale);
  t.wetLevel = Math.max(t.level, t.wetLevel);
  t.peaked = false;
  state.time += 120;
  updateNetwork(state, grid, t.level);
  settleCycle(state, grid, { quiet: true });
  biomeFor(state).settle?.(state, grid);
}

/** What an island can spare of a good: stock above its reserve (food keeps the town's reserve; the rest a fraction of the cap). */
export function surplusOf(state: SimState, good: GoodId): number {
  const stock = state.resources[good];
  const reserve = GOODS[good].role === "food"
    ? (population(state) + IMMIGRANTS_PER_CYCLE) * FOOD_PER_CYCLE * FOOD_RESERVE_CYCLES
    : LANE_RESERVE_FRACTION * capFor(state, good);
  return Math.max(0, stock - reserve);
}

/** What an island wants of a good: room under its want line, for goods it does not make itself. */
export function wantOf(state: SimState, good: GoodId): number {
  const makes = biomeFor(state);
  if ([...makes.foods, makes.luxury, ...makes.industrials, ...makes.minor].includes(good)) return 0;
  return Math.max(0, LANE_WANT_FRACTION * capFor(state, good) - state.resources[good]);
}

/** One cycle of cargo from `from` to `to` along one lane: the hold, spread over the goods `to` wants most. Returns what moved. */
export function flowLane(from: SimState, to: SimState, hold: number): Partial<Record<GoodId, number>> {
  const moved: Partial<Record<GoodId, number>> = {};
  const wants = GOOD_IDS.map(g => ({ g, want: Math.min(wantOf(to, g), surplusOf(from, g)) })).filter(w => w.want > 0).sort((a, b) => b.want - a.want);
  let room = hold;
  for (const w of wants) {
    if (room <= 0) break;
    const units = Math.min(w.want, room);
    const taken = Math.min(units, from.resources[w.g]);
    from.resources[w.g] -= taken;
    const landed = addCapped(to, w.g, taken);
    from.resources[w.g] += taken - landed; // what would not fit sails back
    if (landed > 0) { moved[w.g] = landed; room -= landed; }
  }
  return moved;
}

/** The lanes out of a face: every neighbour that is built and has a harbor (the face itself must have one too). */
export function lanesOf(states: Map<number, SimState>, face: number): number[] {
  const own = states.get(face);
  if (!own || !harborOf(own)) return [];
  return neighboursOf(face).filter(n => { const s = states.get(n); return !!s && !!harborOf(s); });
}

export interface WorldSettlement { settled: number[]; moved: { from: number; to: number; goods: Partial<Record<GoodId, number>> }[] }

/**
 * One World cycle: every built sea but the active one settles once, then cargo flows along every lane (each
 * harbor's ships split their hold across its lanes). The active sea takes part in the flow but settles on its
 * own clock. `active` may be null (the player is on the World: everything settles).
 */
export function settleWorld(store: Store, active: number | null, activeState: SimState | null, now = Date.now()): WorldSettlement {
  if (!LANES_ENABLED) return { settled: [], moved: [] };
  return settleWorldNow(store, active, activeState, now);
}

/** The ledger itself, flag or no flag (tests). */
export function settleWorldNow(store: Store, active: number | null, activeState: SimState | null, now = Date.now()): WorldSettlement {
  const out: WorldSettlement = { settled: [], moved: [] };
  const states = new Map<number, SimState>();
  const metas = new Map<number, { name: string; biome: SimState["world"]["biome"]; created: number }>();
  for (let f = 0; f < FACE_LIST.length; f++) {
    if (f === active && activeState) { states.set(f, activeState); continue; }
    const rec = readSector(store, f);
    if (!rec) continue;
    states.set(f, rec.state);
    metas.set(f, { name: rec.meta.name, biome: rec.meta.biome, created: rec.meta.created });
    const grid = new Grid(rec.state);
    settleOnly(rec.state, grid);
    out.settled.push(f);
  }
  for (const [f, s] of states) {
    const lanes = lanesOf(states, f);
    if (!lanes.length) continue;
    const hold = (CARGO_SHIPS_PER_HARBOR * CARGO_HOLD) / lanes.length;
    for (const n of lanes) {
      const goods = flowLane(s, states.get(n)!, hold);
      if (Object.keys(goods).length) {
        out.moved.push({ from: f, to: n, goods });
        const list = Object.entries(goods).map(([g, u]) => `${Math.round(u as number)} ${GOODS[g as GoodId].name}`).join(", ");
        notify(states.get(n)!, `Cargo from the next sea: ${list}`);
      }
    }
  }
  for (const [f, s] of states) {
    if (f === active) continue;
    const m = metas.get(f);
    if (m) writeSector(store, f, s, m, now);
  }
  return out;
}
