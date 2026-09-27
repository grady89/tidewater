// Seeded islands: the heightfield for a seed, checked for a playable start and rerolled while it fails, plus the
// tree sites on it. Seed 0 is the original island, untouched. Pure geometry; nothing here reads the state.
import { SIZE } from "../config";
import { BUILDINGS, ISLAND_MAX_REROLLS, ISLAND_MIN_FLATS, ISLAND_MIN_HARBOR_SITES, ISLAND_MIN_PIER_SITES, ISLAND_MIN_REGION, ISLAND_MIN_TREED } from "./balance";
import { cellClass, HeightFn, islandHeight } from "./heightfield";
import { isleCell } from "./isle";
import type { TreeSite } from "./trees";

/** What the validation counted, on the main island (the isle is left out of every count). */
export interface IslandStats {
  /** Flat cells. */
  flats: number;
  /** Cells in the largest 4-connected region of flats. */
  region: number;
  /** Deep cells that take a pier. */
  piers: number;
  /** Anchors of a 3×3 block deep enough for the harbor. */
  harbors: number;
  /** Tree sites standing on high cells. */
  treed: number;
}

export interface Island {
  /** The seed the player asked for. */
  seed: number;
  /** The noise seed that passed: the seed itself, or a reroll of it. */
  noiseSeed: number;
  /** How many candidates failed validation before this one. */
  rerolls: number;
  height: HeightFn;
  trees: readonly TreeSite[];
  stats: IslandStats;
}

const HALF = SIZE / 2;
const DEEP = 0, FLAT = 1, HIGH = 2;
const TREE_SEED = 7;
const TREE_COUNT = 70;

/** The island's tree sites: on high ground that is not too steep, in a fixed order from a fixed seed. */
function makeSites(height: HeightFn): TreeSite[] {
  let seed = TREE_SEED;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sites: TreeSite[] = [];
  for (let tries = 0; tries < 3000 && sites.length < TREE_COUNT; tries++) {
    const x = (rnd() - 0.5) * 56, z = (rnd() - 0.5) * 56;
    const h = height(x, z);
    if (h < 1.3 || h > 5.2) continue;
    const slope = Math.abs(height(x + 0.6, z) - height(x - 0.6, z)) + Math.abs(height(x, z + 0.6) - height(x, z - 0.6));
    if (slope > 1.1) continue;
    const s = 0.8 + rnd() * 0.7;
    rnd(); // the cone's yaw in the study; keep the stream aligned for the view
    sites.push({ x, z, s, cell: { i: Math.floor(x), j: Math.floor(z) } });
  }
  return sites;
}

/** Cell classes and heights of a candidate, indexed like the grid; isle cells are flagged so counts skip them. */
function classify(height: HeightFn): { cls: Uint8Array; h: Float32Array; isle: Uint8Array } {
  const cls = new Uint8Array(SIZE * SIZE), h = new Float32Array(SIZE * SIZE), isle = new Uint8Array(SIZE * SIZE);
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = (i + HALF) * SIZE + (j + HALF);
    h[k] = height(i + 0.5, j + 0.5);
    const c = cellClass(h[k]);
    cls[k] = c === "deep" ? DEEP : c === "flat" ? FLAT : HIGH;
    isle[k] = isleCell({ i, j }) ? 1 : 0;
  }
  return { cls, h, isle };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const inBounds = (i: number, j: number) => i >= -HALF && i < HALF && j >= -HALF && j < HALF;
const at = (i: number, j: number) => (i + HALF) * SIZE + (j + HALF);

export function islandStats(height: HeightFn, trees: readonly TreeSite[]): IslandStats {
  const { cls, h, isle } = classify(height);
  const main = (k: number) => isle[k] === 0;
  let flats = 0;
  for (let k = 0; k < cls.length; k++) if (cls[k] === FLAT && main(k)) flats++;

  // The largest connected region of flats, 4-connected.
  let region = 0;
  const seen = new Uint8Array(SIZE * SIZE);
  const stack: number[] = [];
  for (let k0 = 0; k0 < cls.length; k0++) {
    if (seen[k0] || cls[k0] !== FLAT || !main(k0)) continue;
    let n = 0;
    seen[k0] = 1; stack.push(k0);
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      const i = Math.floor(k / SIZE) - HALF, j = (k % SIZE) - HALF;
      for (const [di, dj] of DIRS) {
        if (!inBounds(i + di, j + dj)) continue;
        const q = at(i + di, j + dj);
        if (seen[q] || cls[q] !== FLAT || !main(q)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    region = Math.max(region, n);
  }

  // Pier sites: the grid's edge rule — a deep anchor with a flat cell beside it and `d` deep cells seaward.
  const pier = BUILDINGS.pier;
  let piers = 0;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const k = at(i, j);
    if (cls[k] !== DEEP || !main(k)) continue;
    let ok = false;
    for (const [di, dj] of DIRS) {
      if (ok) break;
      if (!inBounds(i + di, j + dj) || cls[at(i + di, j + dj)] !== FLAT) continue;
      ok = true;
      for (let s = 0; s < pier.d && ok; s++) {
        const ci = i - di * s, cj = j - dj * s;
        if (!inBounds(ci, cj) || cls[at(ci, cj)] !== DEEP || !main(at(ci, cj))) ok = false;
      }
    }
    if (ok) piers++;
  }

  // Harbor sites: a w×d block of deep cells all below the harbor's depth.
  const harbor = BUILDINGS.harbor;
  const deepEnough = harbor.terrain?.max ?? -1.5;
  let harbors = 0;
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    let ok = true;
    for (let di = 0; di < harbor.w && ok; di++) for (let dj = 0; dj < harbor.d && ok; dj++) {
      const ci = i + di, cj = j + dj;
      if (!inBounds(ci, cj)) { ok = false; break; }
      const k = at(ci, cj);
      if (cls[k] !== DEEP || h[k] > deepEnough || !main(k)) ok = false;
    }
    if (ok) harbors++;
  }

  // Trees on high cells (sites, not distinct cells: the original island's 70 sites share 45 cells).
  let treed = 0;
  for (const t of trees) if (inBounds(t.cell.i, t.cell.j) && cls[at(t.cell.i, t.cell.j)] === HIGH) treed++;
  return { flats, region, piers, harbors, treed };
}

/** Why a candidate fails, one reason per rule, or [] when it is playable. */
export function islandFailures(s: IslandStats): string[] {
  const out: string[] = [];
  if (s.flats < ISLAND_MIN_FLATS) out.push(`flats ${s.flats} < ${ISLAND_MIN_FLATS}`);
  if (s.region < ISLAND_MIN_REGION) out.push(`largest flats region ${s.region} < ${ISLAND_MIN_REGION}`);
  if (s.piers < ISLAND_MIN_PIER_SITES) out.push(`pier sites ${s.piers} < ${ISLAND_MIN_PIER_SITES}`);
  if (s.harbors < ISLAND_MIN_HARBOR_SITES) out.push(`harbor sites ${s.harbors} < ${ISLAND_MIN_HARBOR_SITES}`);
  if (s.treed < ISLAND_MIN_TREED) out.push(`treed high cells ${s.treed} < ${ISLAND_MIN_TREED}`);
  return out;
}

/** The k-th candidate noise seed for a requested seed: the seed itself first, then a hash of (seed, k). */
export function candidateSeed(seed: number, k: number): number {
  if (k === 0) return seed | 0;
  let n = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k, 0x85ebca77);
  n = Math.imul(n ^ (n >>> 15), 0xc2b2ae35);
  return (n ^ (n >>> 13)) | 0;
}

/** The k-th candidate for a seed, generated and measured but not judged. */
export function candidate(seed: number, k: number): { noiseSeed: number; height: HeightFn; trees: TreeSite[]; stats: IslandStats } {
  const noiseSeed = candidateSeed(seed, k);
  const height = islandHeight(noiseSeed);
  const trees = makeSites(height);
  return { noiseSeed, height, trees, stats: islandStats(height, trees) };
}

const cache = new Map<number, Island>();

/**
 * The island for a seed: the first candidate that passes validation, rerolling through `candidateSeed` until
 * one does. Seed 0 is the original island and stands whatever the rules say. If ISLAND_MAX_REROLLS candidates
 * all fail, the original island stands in (recorded as one reroll past the cap) rather than a town with nowhere
 * to build.
 */
export function island(seed: number): Island {
  seed = seed | 0;
  const hit = cache.get(seed);
  if (hit) return hit;
  let made: Island | null = null;
  for (let k = 0; k <= ISLAND_MAX_REROLLS && !made; k++) {
    const c = candidate(seed, k);
    if (islandFailures(c.stats).length === 0 || seed === 0) made = { seed, rerolls: k, ...c };
  }
  if (!made) {
    const base = island(0);
    made = { ...base, seed, rerolls: ISLAND_MAX_REROLLS + 1 };
  }
  cache.set(seed, made);
  return made;
}

/** How often seeds in [from, to) needed a reroll, and how many rerolls they took in all. */
export function rerollRate(from: number, to: number): { islands: number; rerolled: number; rerolls: number; fallbacks: number } {
  let rerolled = 0, rerolls = 0, fallbacks = 0;
  for (let s = from; s < to; s++) {
    const r = island(s).rerolls;
    if (r > 0) rerolled++;
    if (r > ISLAND_MAX_REROLLS) fallbacks++;
    rerolls += Math.min(r, ISLAND_MAX_REROLLS);
  }
  return { islands: to - from, rerolled, rerolls, fallbacks };
}
