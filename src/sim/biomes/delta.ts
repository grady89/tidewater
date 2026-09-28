// Delta (BIOMES.md §3.4): a braided river mouth — reed flats between channels, mangroves on the banks, a low levee
// along the back as the only high ground, the river springing from behind it and splitting on its way to the sea.
// Tide ×1.0 plus a river swell every 6th cycle; a swell on a spring peak is a king tide. Rice (paddies on the
// fresh-water flats, a harvest every two cycles and all at once at a spring low) and crab (the sampans' catch and
// the pots on the channel edges); indigo from the vats (they foul the water: put them downstream); salt from the
// pans. Crocodiles in the shark role, a warden tower and croc nets against them; fever season every 8th cycle
// where no clinic reaches; storms come more often.
import {
  BUILDINGS, CRAB_POT_PER_SHIFT, FEVER_CLINIC_RADIUS, FEVER_EVERY, FEVER_FIRST, FEVER_SHARE, FRESH_RIVER_RADIUS, HARVEST_BONUS,
  INDIGO_PER_CELL, INDIGO_RADIUS, RICE_CYCLES, RICE_PER_HARVEST, SALT_PER_CYCLE, SALT_STORM_FACTOR,
} from "../balance";
import { cellIndex, HALF } from "../cells";
import { HeightFn, noiseFor } from "../heightfield";
import { isleHeight, isleWeight } from "../isle";
import { Material, materialCode } from "../materials";
import { Building, buildingList, Cell, notify, SimState } from "../state";
import { addCapped } from "../economy";
import { advanceCycles } from "../tick";
import { isKingCycle, isSwellCycle } from "../tide";
import type { TreeSite } from "../trees";
import type { Grid } from "../grid";
import { Biome, registerBiome } from "./registry";

/** The river: it springs behind the levee at the back (−z), runs as one stem to the split, then fans to the sea (+z). */
const LEVEE_Z = -19, STEM_FROM = -17, SPLIT_Z = -6, MOUTH_Z = 34;
const STEM_DEPTH = -0.95, CHANNEL_DEPTH = -1.1, SEA_DEPTH = -4;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface Channel { from: number; x0: number; x1: number; wiggle: number; freq: number; phase: number; w0: number; w1: number; fresh: boolean }

/** The channels for a noise seed: the stem, two distributaries from the split, a third off the western one. */
export function deltaChannels(seed: number): Channel[] {
  const s = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const west = -13 - 4 * s(1), east = 9 + 3 * s(2);
  return [
    { from: STEM_FROM, x0: -1 + 2 * s(3), x1: 0, wiggle: 1.4, freq: 0.3, phase: seed * 0.7, w0: 1.2, w1: 1.4, fresh: true },
    { from: SPLIT_Z, x0: 0, x1: west, wiggle: 1.6, freq: 0.24, phase: seed * 0.3 + 1, w0: 1.3, w1: 2.2, fresh: false },
    { from: SPLIT_Z, x0: 0, x1: east, wiggle: 1.5, freq: 0.27, phase: seed * 0.5 + 2, w0: 1.3, w1: 2.1, fresh: false },
    { from: 7, x0: west * 0.45, x1: -3 + 3 * s(4), wiggle: 1.2, freq: 0.33, phase: seed * 0.9 + 3, w0: 1.1, w1: 1.8, fresh: false },
  ];
}

/** A channel's centre and half-width at z (null where it does not run). */
function channelAt(c: Channel, z: number): { x: number; w: number } | null {
  if (z < c.from) return null;
  const t = smooth(c.from, MOUTH_Z - 4, z);
  const bend = c.from === STEM_FROM ? 0 : 1 - Math.abs(1 - 2 * t); // the branches swing out, then run straight to the sea
  const x = c.x0 + (c.x1 - c.x0) * t + c.wiggle * Math.sin(z * c.freq + c.phase) * (c.from === STEM_FROM ? 1 : 0.4 + 0.6 * bend);
  return { x, w: c.w0 + (c.w1 - c.w0) * t };
}

/** How far (x, z) is into the nearest channel: 1 on its line, 0 a bank away. `fresh` asks only for the stem. */
function channelWeight(chs: Channel[], x: number, z: number, freshOnly = false): number {
  let best = 0;
  for (const c of chs) {
    if (freshOnly && !c.fresh) continue;
    const a = channelAt(c, z);
    if (!a) continue;
    const d = Math.abs(x - a.x) / a.w;
    best = Math.max(best, 1 - smooth(0.55, 1.35, d));
  }
  return best;
}

/** The island's outline: an oval, the edge wandering with the noise. 0 inside, 1 at sea. */
function seaward(x: number, z: number, n: number): number {
  const r = Math.hypot(x / 26.5, (z - 1.5) / 25.5) + n * 0.1;
  return smooth(0.88, 1.03, r);
}

/** The Delta's heightfield for one noise seed. */
export function deltaHeight(seed: number): HeightFn {
  const { fbm } = noiseFor(seed);
  const chs = deltaChannels(seed);
  return (x: number, z: number): number => {
    const n = fbm(x + 40, z - 20, 4, 1 / 10) - 0.5;
    const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.12;
    // The flats: low toward the sea, a little higher toward the levee, rippled.
    let h = 0.16 + 0.24 * smooth(12, -16, z) + n * 0.34;
    // The levee: a low ridge across the back, the only dry ground.
    const lz = LEVEE_Z + 2.2 * Math.sin(x * 0.17 + seed * 0.5);
    const levee = Math.exp(-((z - lz) ** 2) / 6) * (1 - smooth(18, 25, Math.abs(x)));
    h += (1.05 + n * 0.3 - h) * levee;
    // The channels: carved to below low water; the stem cuts a gap through the levee where the river comes out.
    const cw = channelWeight(chs, x, z);
    const depth = z < SPLIT_Z ? STEM_DEPTH : CHANNEL_DEPTH;
    h = h * (1 - cw) + (depth + n * 0.3) * cw;
    // The sea all round: the flats fall away past the outline.
    const sea = seaward(x, z, n);
    h = h * (1 - sea) + SEA_DEPTH * sea;
    h += detail;
    const w = isleWeight(x, z);
    if (w > 0) h = h * (1 - w) + (isleHeight(x, z) + detail * 0.5) * w;
    return h;
  };
}

/** Mangroves: flat cells on the seaward half, along the channel banks and the outer shore, in patches. */
export function deltaMaterial(seed: number): (i: number, j: number, h: number) => Material {
  const { fbm } = noiseFor(seed + 911);
  const chs = deltaChannels(seed);
  return (i, j, h) => {
    const x = i + 0.5, z = j + 0.5;
    if (h < -0.35 || h > 0.6 || z < SPLIT_Z + 2 || isleWeight(x, z) > 0) return "plain";
    const bank = channelWeight(chs, x, z) > 0 || channelWeight(chs, x + 1.6, z) > 0.2 || channelWeight(chs, x - 1.6, z) > 0.2;
    const shore = seaward(x, z, 0) > 0 || seaward(x * 1.12, (z - 1.5) * 1.12 + 1.5, 0) > 0.05;
    const patch = fbm(x, z, 3, 1 / 5) > 0.47;
    return (bank || shore) && patch ? "mangrove" : "plain";
  };
}

/** A mangrove on every mangrove cell (they must be cleared to build there). */
function mangroveSites(seed: number): (height: HeightFn) => TreeSite[] {
  const mat = deltaMaterial(seed);
  return height => {
    const sites: TreeSite[] = [];
    let s = 41;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const h = height(i + 0.5, j + 0.5);
      if (mat(i, j, h) !== "mangrove") { rnd(); rnd(); continue; }
      sites.push({ x: i + 0.25 + rnd() * 0.5, z: j + 0.25 + rnd() * 0.5, s: 0.8 + 0.4 * ((i * 7 + j * 13) % 5) / 5, cell: { i, j } });
    }
    return sites;
  };
}

// ---------- the river's fresh water ----------

const freshCache = new Map<number, Cell[]>();
/** The stem's water cells (above the split): fresh water for the paddies and the homes along it. */
export function freshCells(grid: Grid): Cell[] {
  const seed = grid.island.noiseSeed;
  let cells = freshCache.get(seed);
  if (!cells) {
    const chs = deltaChannels(seed);
    cells = [];
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < SPLIT_Z; j++) {
      if (grid.heights[cellIndex(i, j)] < grid.tides.lo && channelWeight(chs, i + 0.5, j + 0.5, true) > 0.3) cells.push({ i, j });
    }
    freshCache.set(seed, cells);
  }
  return cells;
}

// ---------- the seasons ----------

/** Fever season: every FEVER_EVERY cycles from FEVER_FIRST. */
export function feverSeason(cycle: number): boolean {
  return cycle >= FEVER_FIRST && (cycle - FEVER_FIRST) % FEVER_EVERY === 0;
}

/** A clinic within FEVER_CLINIC_RADIUS of the home, staffed and reached. */
function clinicNear(state: SimState, home: Building): boolean {
  return buildingList(state).some(c => c.kind === "clinic" && c.reached && !c.cut && !c.damaged && c.workers > 0
    && c.cells.some(a => home.cells.some(h => Math.abs(a.i - h.i) <= FEVER_CLINIC_RADIUS && Math.abs(a.j - h.j) <= FEVER_CLINIC_RADIUS)));
}

/** Settlement in a fever cycle: a share of every home out of a clinic's reach falls sick (off work until healed). */
function fever(state: SimState): number {
  let sick = 0;
  for (const h of buildingList(state).sort((a, b) => a.id - b.id)) {
    if (BUILDINGS[h.kind].residents === 0 || h.residents === 0 || clinicNear(state, h)) continue;
    const n = Math.min(h.residents - h.injured, Math.ceil(h.residents * FEVER_SHARE));
    if (n > 0) { h.injured += n; sick += n; }
  }
  notify(state, sick > 0 ? `Fever season: ${sick} fell sick — a clinic keeps it from the homes within ${FEVER_CLINIC_RADIUS}` : "Fever season: the clinics kept it off the homes");
  return sick;
}

/** A paddy has fresh water: the river's reach or a well's. */
function watered(state: SimState, b: Building): boolean {
  return b.cells.some(c => state.fields.coverage.water[cellIndex(c.i, c.j)] > 0);
}


/** The harvest: a paddy's crop comes in, `bonus` times over at the spring low. */
function harvest(state: SimState, b: Building, s: number, bonus = 1): number {
  const got = addCapped(state, "rice", RICE_PER_HARVEST * s * bonus);
  b.progress = 0;
  return got;
}
/** Advance whole cycles until `done` (the console's forced moments). */
function until(state: SimState, grid: Grid, done: () => boolean): void {
  for (let k = 0; k < 24 && !done(); k++) advanceCycles(state, grid, 1);
}

export const DELTA: Biome = registerBiome({
  id: "delta",
  label: "Delta",
  bands: ["temperate", "tropical"],
  tide: 1,
  catch: "crab",
  foods: ["rice", "crab"],
  luxury: "indigo",
  industrials: ["salt"],
  minor: [],
  cannotMake: ["timber", "planks", "fish", "shellfish", "smoked", "iron"],
  favourite: "pearls",
  unique: ["ricePaddy", "crabPots", "saltPan", "indigoVats", "wardenTower", "crocNet"],
  excluded: ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse", "tallHouse", "lifeguard", "sharkNet"],
  surge: { every: 6, first: 6, rise: 0.15, king: 0.3 },
  predator: "crocodile",
  storm: { swell: 1, loss: 1, name: "rainstorm", chance: 1.5 },
  startNear: { i: 5, j: -11 },
  shape: seed => ({ height: deltaHeight(seed), material: deltaMaterial(seed), trees: mangroveSites(seed) }),
  thresholds: { flats: 450, region: 250, piers: 6, harbors: 1, treed: 0 },
  validate: (s, height) => {
    const out: string[] = [];
    const mangrove = s.materials[materialCode("mangrove")] ?? 0;
    if (mangrove < 60) out.push(`mangrove ${mangrove} cells < 60`);
    if (height) {
      // The river: its stem runs out through the levee; the levee stands dry either side of it.
      let stem = 0, levee = 0;
      for (let z = STEM_FROM + 1; z < SPLIT_Z; z++) for (let x = -6; x <= 6; x++) if (height(x + 0.5, z + 0.5) < -0.35) { stem++; break; }
      for (let x = -16; x <= 16; x++) for (let z = LEVEE_Z - 5; z <= LEVEE_Z + 5; z++) { const h = height(x + 0.5, z + 0.5); if (h > 0.62 && h < 1.6) { levee++; break; } }
      if (stem < (SPLIT_Z - STEM_FROM - 1) * 0.8) out.push(`river stem ${stem} rows of ${SPLIT_Z - STEM_FROM - 1}`);
      if (levee < 20) out.push(`levee ${levee} columns < 20`);
      let channels = 0;
      for (const zz of [10, 20]) { let inside = false; for (let x = -24; x <= 24; x++) { const w = height(x + 0.5, zz + 0.5) < -0.35; if (w && !inside) channels++; inside = w; } }
      if (channels < 5) out.push(`channels ${channels} crossings < 5`);
    }
    return out;
  },
  coverage: (_state, grid) => [{ kind: "water", cells: freshCells(grid), radius: FRESH_RIVER_RADIUS, value: 1 }],
  seasonLabel: state => {
    const c = state.tide.cycle + 1;
    if (isKingCycle(c, state.tide.surge)) return "King tide at the next high water: the river meets the spring";
    if (isSwellCycle(c, state.tide.surge)) return "The river is swelling: a higher high water next";
    if (feverSeason(state.tide.cycle)) return "Fever season";
    return null;
  },
  producers: {
    saltPan: (state, _grid, _b, s) => addCapped(state, "salt", SALT_PER_CYCLE * s * (state.storm.active ? SALT_STORM_FACTOR : 1)),
    // The wild indigo grows on the open flats: every unbuilt flat cell within reach is a patch to cut.
    indigoVats: (state, grid, b, s) => addCapped(state, "indigo", INDIGO_PER_CELL * grid.exposedFlatsNear(b.cells, INDIGO_RADIUS, -Infinity) * s),
  },
  shiftEnd: (state, _grid, phase, springLow) => {
    if (phase !== "low") return;
    let n = 0, got = 0;
    for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
      if (!b.reached || b.cut || b.damaged || b.workers === 0) continue;
      if (b.kind === "crabPots") b.output += addCapped(state, "crab", CRAB_POT_PER_SHIFT * Math.min(1, b.workers / BUILDINGS.crabPots.workers));
      if (b.kind !== "ricePaddy" || !watered(state, b)) continue;
      // Planted at low water, flooded at high: the crop grows at every low it has fresh water, and comes in after
      // RICE_CYCLES of them — or at a spring low, whatever its age: the rice harvest, every paddy at once.
      const s = Math.min(1, b.workers / BUILDINGS.ricePaddy.workers);
      b.progress += s;
      if (springLow) { const r = harvest(state, b, s, HARVEST_BONUS); b.output += r; got += r; n++; }
      else if (b.progress >= RICE_CYCLES) b.output += harvest(state, b, s);
    }
    if (n > 0) { state.biomeState.harvests = (state.biomeState.harvests ?? 0) + 1; state.biomeState.harvestCycle = state.tide.cycle; notify(state, `The rice harvest: ${n} paddies came in at once — ${Math.round(got)} rice`); }
  },
  settle: (state, grid) => {
    const cycle = state.tide.cycle;
    const bs = state.biomeState;
    // A king tide over the bunds washes the standing crop out of every paddy.
    if (isKingCycle(cycle, state.tide.surge)) {
      let washed = 0;
      for (const b of buildingList(state)) if (b.kind === "ricePaddy" && b.progress > 0) { b.progress = 0; washed++; }
      bs.kingTides = (bs.kingTides ?? 0) + 1;
      notify(state, `A king tide: the river met the spring${washed ? ` and washed out ${washed} paddies` : ""}`);
    } else if (isSwellCycle(cycle, state.tide.surge)) notify(state, "The river is in swell: the water stands higher");
    if (feverSeason(cycle)) bs.fever = (bs.fever ?? 0) + fever(state);
    void grid;
  },
  force: {
    kingTide: (state, grid) => until(state, grid, () => isKingCycle(state.tide.cycle, state.tide.surge)),
    fever: (state, grid) => until(state, grid, () => feverSeason(state.tide.cycle)),
    harvest: (state, grid) => { const n = state.biomeState.harvests ?? 0; until(state, grid, () => (state.biomeState.harvests ?? 0) > n); },
  },
});
