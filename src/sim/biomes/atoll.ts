// Atoll (BIOMES.md §3.2): a ring of low motu round a shallow lagoon, one or two passes through the ring for
// ships, few high cells, lots of flats. Tide ×0.6. Fish and coconut, pearls from the lagoon, sponges, no timber.
// Cyclones (a storm with twice the swell and a harder hand on the boats), coral bleaching where pollution reaches
// the lagoon (reef nurseries recover it), and on a spring night the turtles hatch: lanterns near the beach go dark
// on their own and the town earns a lasting tourism bonus.
import {
  BLEACH_POLLUTION, BLEACH_RATE, BLEACH_RECOVER, BUILDINGS, HATCHING_BONUS, HATCHING_BONUS_MAX, HATCHING_LANTERN_RADIUS,
  NURSERY_POLLUTION_MAX, NURSERY_RADIUS, NURSERY_RECOVER,
} from "../balance";
import { cellIndex, HALF, inBounds } from "../cells";
import { at, CELLS } from "../fields";
import { HeightFn, noiseFor } from "../heightfield";
import { isleHeight, isleWeight } from "../isle";
import { Material, materialCode } from "../materials";
import { Building, buildingList, notify, SimState } from "../state";
import { isSpringCycle } from "../tide";
import type { TreeSite } from "../trees";
import { Biome, registerBiome } from "./registry";
import type { Grid } from "../grid";

/** The ring's mean radius, its width, the lagoon's depth and the passes through it. */
const RING_R = 20, RING_HALF = 2.2, FLAT_BAND = 2.6;
const LAGOON_DEPTH = -0.75, PASS_DEPTH = -1.4, SEA_DEPTH = -4;
const PALM_COUNT = 70;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The ring's radius in a direction: an ellipse with two low harmonics, so no outline is a circle. */
function ringRadius(theta: number, seed: number): number {
  return RING_R * (1 + 0.07 * Math.sin(2 * theta + seed * 0.3) + 0.05 * Math.sin(3 * theta + 1.7 + seed * 0.11) + 0.04 * Math.sin(5 * theta + 0.4));
}

/** Where the passes cut the ring: one always, a second on odd seeds; each ~5 cells wide. */
export function passAngles(seed: number): number[] {
  const a0 = 0.9 + ((seed * 0.37) % 1) * 2.4;
  return (seed & 1) ? [a0, a0 + Math.PI * 1.05] : [a0];
}

/** How close the direction is to a pass, 0..1 (1 in the middle of the pass). */
function passWeight(theta: number, seed: number): number {
  let w = 0;
  for (const a of passAngles(seed)) {
    let d = Math.abs(theta - a) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    w = Math.max(w, 1 - smooth(0.09, 0.16, d));
  }
  return w;
}

/** The Atoll's heightfield for one noise seed: a profile in the distance from the ring, swept round it. */
export function atollHeight(seed: number): HeightFn {
  const { fbm } = noiseFor(seed);
  return (x: number, z: number): number => {
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    const R = ringRadius(theta, seed);
    const d = r - R; // distance from the ring's crest, outward positive
    const n = (fbm(x + 40, z - 20, 4, 1 / 9) - 0.5);
    const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.12;
    let h: number;
    const ad = Math.abs(d);
    if (ad < RING_HALF) {
      // The motu: a low crest with palms, higher where the noise piles the sand.
      h = 0.55 + 0.75 * (1 - smooth(0.6, RING_HALF, ad)) * (0.55 + 0.45 * n * 2) + n * 0.5;
    } else if (ad < RING_HALF + FLAT_BAND) {
      // The reef flats on both sides: just under and over the tide line, sloping away from the crest.
      const t = smooth(RING_HALF, RING_HALF + FLAT_BAND, ad);
      h = 0.3 - 0.55 * t + n * 0.25;
    } else if (d < 0) {
      // The lagoon: shallow and bright, a little deeper toward the middle.
      const t = smooth(RING_HALF + FLAT_BAND, RING_HALF + FLAT_BAND + 8, ad);
      h = -0.25 + (LAGOON_DEPTH + 0.25) * t - 0.25 * smooth(0.55, 1, 1 - r / R) + n * 0.3;
    } else {
      // The open sea: the reef drops away fast.
      const t = smooth(RING_HALF + FLAT_BAND, RING_HALF + FLAT_BAND + 5, ad);
      h = -0.25 + (SEA_DEPTH + 0.25) * t + n * 0.3 * (1 - t);
    }
    // The passes: a channel through the ring and its flats, deep enough for the ship.
    const pw = passWeight(theta, seed) * (1 - smooth(RING_HALF + FLAT_BAND + 1, RING_HALF + FLAT_BAND + 4, ad));
    h = Math.min(h, h * (1 - pw) + PASS_DEPTH * pw);
    h += detail;
    const w = isleWeight(x, z);
    if (w > 0) h = h * (1 - w) + (isleHeight(x, z) * 0.6 + detail * 0.5) * w;
    return h;
  };
}

/** The lagoon: water inside the ring (its flats and passes excluded). */
function atollMaterial(seed: number): (i: number, j: number, h: number) => Material {
  return (i, j, h) => {
    const x = i + 0.5, z = j + 0.5;
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    const R = ringRadius(theta, seed);
    const nearRing = r > R - RING_HALF - FLAT_BAND - 4;
    if (r < R - RING_HALF - 1.2 && h < -0.21 && (!nearRing || passWeight(theta, seed) < 0.5) && isleWeight(x, z) === 0) return "lagoon";
    return "plain";
  };
}

/** Palms on the motu: the ring's crest, between the tide line and its top. */
function palmSites(height: HeightFn): TreeSite[] {
  let seed = 29;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sites: TreeSite[] = [];
  for (let tries = 0; tries < 8000 && sites.length < PALM_COUNT; tries++) {
    const x = (rnd() - 0.5) * 60, z = (rnd() - 0.5) * 60;
    const h = height(x, z);
    if (h < 0.5 || h > 1.5) continue;
    const s = 0.85 + rnd() * 0.5;
    rnd();
    sites.push({ x, z, s, cell: { i: Math.floor(x), j: Math.floor(z) } });
  }
  return sites;
}

// ---------- the lagoon's health ----------

/** Settlement: pollution on a lagoon cell bleaches it; clean water and nurseries bring it back. */
function settleBleaching(state: SimState, grid: Grid): void {
  const bleach = state.fields.bleach, pollution = state.fields.pollution;
  const lagoon = materialCode("lagoon");
  const nurseries = buildingList(state).filter(b => b.kind === "reefNursery" && b.reached && !b.cut && !b.damaged && b.workers > 0 && at(pollution, b.cells[0]) < NURSERY_POLLUTION_MAX);
  let bleached = 0;
  for (let k = 0; k < CELLS; k++) {
    if (grid.materials[k] !== lagoon) { bleach[k] = 0; continue; }
    const i = Math.floor(k / 64) - HALF, j = (k % 64) - HALF;
    if (pollution[k] > BLEACH_POLLUTION) bleach[k] = Math.min(1, bleach[k] + BLEACH_RATE);
    else bleach[k] = Math.max(0, bleach[k] - BLEACH_RECOVER);
    for (const n of nurseries) if (Math.abs(n.cells[0].i - i) <= NURSERY_RADIUS && Math.abs(n.cells[0].j - j) <= NURSERY_RADIUS) bleach[k] = Math.max(0, bleach[k] - NURSERY_RECOVER);
    if (bleach[k] > 0.5) bleached++;
  }
  const before = state.biomeState.bleached ?? 0;
  state.biomeState.bleached = bleached;
  if (bleached > 0 && before === 0) notify(state, "The reef is bleaching: foul water in the lagoon");
  if (bleached === 0 && before > 0) notify(state, "The reef has recovered its colour");
}

/** Lagoon cells within reach of a lagoon-side building: the nursery's and the platform's ground. */
export function lagoonCellsNear(grid: Grid, cells: { i: number; j: number }[], radius: number): number {
  const lagoon = materialCode("lagoon");
  let n = 0;
  for (const c of cells) for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
    const i = c.i + di, j = c.j + dj;
    if (inBounds(i, j) && grid.materials[cellIndex(i, j)] === lagoon) n++;
  }
  return n;
}

// ---------- the turtles ----------

/** Is a hatching on? Booked at a spring settlement (always a dawn on this clock) for the night that follows: the next cycle. */
export function hatching(state: SimState): boolean {
  return (state.biomeState.hatching ?? -1) === state.tide.cycle;
}

/** A lantern within HATCHING_LANTERN_RADIUS of a beach cell goes dark while the hatchlings cross. */
export function lanternDimmed(state: SimState, grid: Grid, b: Building): boolean {
  if (!hatching(state)) return false;
  for (const c of b.cells) for (let di = -HATCHING_LANTERN_RADIUS; di <= HATCHING_LANTERN_RADIUS; di++) for (let dj = -HATCHING_LANTERN_RADIUS; dj <= HATCHING_LANTERN_RADIUS; dj++) {
    const i = c.i + di, j = c.j + dj;
    if (inBounds(i, j) && grid.beach[cellIndex(i, j)]) return true;
  }
  return false;
}

/** The lasting tourism multiplier the hatchings have earned. */
export function turtleBonus(state: SimState): number {
  return 1 + Math.min(HATCHING_BONUS_MAX, (state.biomeState.turtleBonus ?? 0));
}

export const ATOLL: Biome = registerBiome({
  id: "atoll",
  label: "Atoll",
  bands: ["tropical"],
  tide: 0.6,
  foods: ["fish", "coconut"],
  luxury: "pearls",
  industrials: [],
  minor: ["sponges"],
  cannotMake: ["timber", "planks", "shellfish", "smoked", "rice", "iron"],
  favourite: "smoked",
  unique: ["divePlatform", "pearlHouse", "coconutGrove", "reefNursery"],
  excluded: ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse", "tallHouse"],
  storm: { swell: 2, loss: 1.5, name: "cyclone" },
  shape: seed => ({ height: atollHeight(seed), material: atollMaterial(seed), trees: palmSites }),
  thresholds: { flats: 300, region: 120, piers: 3, harbors: 1, treed: 30 },
  validate: s => {
    const out: string[] = [];
    const lagoon = s.materials[materialCode("lagoon")] ?? 0;
    if (lagoon < 200) out.push(`lagoon ${lagoon} cells < 200`);
    if (s.deepCells < 40) out.push(`no pass: ${s.deepCells} deep-enough cells < 40`);
    return out;
  },
  seasonLabel: state => hatching(state) ? "Turtle hatching: the beach lanterns are dark" : (state.biomeState.bleached ?? 0) > 0 ? "The reef is bleaching" : null,
  tourism: state => turtleBonus(state),
  lanternDimmed,
  settle: (state, grid) => {
    settleBleaching(state, grid);
    const cycle = state.tide.cycle;
    const bs = state.biomeState;
    // A spring settlement books the hatching for the night that follows (the spring peak is always a dawn: a day is
    // two cycles and springs come every fourth); the town's lanterns near the beach go dark on their own through
    // that cycle and the hatchlings make it: a lasting draw for the tourists.
    if (isSpringCycle(cycle) && buildingList(state).some(b => BUILDINGS[b.kind].residents > 0 && b.residents > 0)) {
      bs.hatching = cycle + 1;
      bs.turtleBonus = Math.min(HATCHING_BONUS_MAX, (bs.turtleBonus ?? 0) + HATCHING_BONUS);
      bs.hatchings = (bs.hatchings ?? 0) + 1;
      notify(state, "The turtles hatch tonight: the lanterns by the beach will go dark for them");
    }
  },
});

