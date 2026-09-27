// Fjord (BIOMES.md §3.3): a long island split by a deep channel between two ridges, flats only at the head of
// the fjord and on a few ledges, dense pines on the slopes and snow above 4.0. Tide ×1.6. Fish and stockfish,
// whale oil in season, iron from the ridge, timber. Sea ice every ICE_EVERY-th cycle; an avalanche after a storm
// takes what stands on the slope under the trees; the aurora lifts every home on a clear night.
import { SIZE } from "../../config";
import {
  AVALANCHE_CHANCE, AVALANCHE_MIN_HEIGHT, AVALANCHE_RADIUS, AVALANCHE_RISE, BUILDINGS, HAPPY_AURORA, ICE_EVERY, ICE_FIRST, WHALE_SEASON_EVERY,
  WHALE_SEASON_FIRST, WHALE_SEASON_LENGTH,
} from "../balance";
import { HeightFn, noiseFor } from "../heightfield";
import { isleHeight, isleWeight } from "../isle";
import { rand } from "../rng";
import { buildingList, notify, SimState } from "../state";
import type { TreeSite } from "../trees";
import { Biome, registerBiome } from "./registry";
import type { Grid } from "../grid";

/** Where the channel runs (along z, the mouth at +z), where its head is, and how the ridges stand either side. */
const HEAD_Z = -12;
const CHANNEL_HALF = 3.2, BANK_TOP = 6.5, CREST_X = 12.5, OUTER_SHORE = 19.5;
const CHANNEL_DEPTH = -3.6, CREST_HEIGHT = 5.8;
const TREE_COUNT = 150;

/** The Fjord's heightfield for one noise seed: a cross-section in |x| swept along z, the channel filling at the head. */
export function fjordHeight(seed: number): HeightFn {
  const { fbm } = noiseFor(seed);
  return (x: number, z: number): number => {
    // The crests wander and the channel breathes along the fjord, differently on each bank.
    const side = x < 0 ? 1 : 2;
    const crestX = CREST_X + 1.6 * Math.sin(z * 0.19 + seed * 0.7 + side * 2.1);
    const chHalf = CHANNEL_HALF + 0.7 * Math.sin(z * 0.31 + seed * 0.4);
    const xr = Math.abs(x);
    const n = (fbm(x + 40, z - 20, 5, 1 / 14) - 0.5) * 2.6;
    const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.3;
    // The channel's floor rises to flats at the head; past the head the valley floor is land.
    const headT = smooth(HEAD_Z + 6, HEAD_Z - 4, z); // 0 in the fjord, 1 past the head
    const floor = CHANNEL_DEPTH + (0.25 - CHANNEL_DEPTH) * headT;
    // Cross-section: the floor, a steep bank up to a low shelf, the ridge to its crest, the outer slope to the sea.
    let h: number;
    if (xr < chHalf) h = floor;
    else if (xr < BANK_TOP) h = floor + (0.6 - floor) * smooth(chHalf, BANK_TOP, xr);
    else if (xr < crestX) h = 0.6 + (CREST_HEIGHT - 0.6) * smooth(BANK_TOP, crestX, xr);
    else h = CREST_HEIGHT - (CREST_HEIGHT + 3.5) * smooth(crestX, OUTER_SHORE + 1.5, xr);
    // Ledges: the shelf at the bank's top comes and goes along the fjord, so flats and deep-dock sites alternate.
    const ledge = 0.45 * Math.exp(-((xr - BANK_TOP) ** 2) / 2.2) * (0.5 + 0.5 * Math.sin(z * 0.42 + seed * 0.37)) * (1 - headT);
    // Noise on the ridges and the head, not in the channel.
    const land = smooth(chHalf + 0.5, BANK_TOP + 1, xr) * (1 - headT) + headT;
    h += ledge + n * land * (0.35 + 0.65 * smooth(BANK_TOP, crestX, xr)) + detail;
    // The head's back wall: the valley climbs to a col at the top edge; the mouth opens to the sea; the flanks fall away.
    h += 5.5 * smooth(HEAD_Z - 9, -31, z) * headT;
    const mouth = smooth(23, 30, z) * (xr > chHalf ? 1 : 0);
    h = h * (1 - mouth) - 4 * mouth;
    const flank = smooth(OUTER_SHORE, OUTER_SHORE + 4, xr);
    h = h * (1 - flank) - 4 * flank;
    const w = isleWeight(x, z);
    if (w > 0) h = h * (1 - w) + (isleHeight(x, z) * 1.6 + detail * 0.5) * w;
    return h;
  };
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Dense pines on the slopes between the shore and the snow line, steeper ground allowed than the base placer. */
function fjordTrees(height: HeightFn): TreeSite[] {
  let seed = 19;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sites: TreeSite[] = [];
  for (let tries = 0; tries < 6000 && sites.length < TREE_COUNT; tries++) {
    const x = (rnd() - 0.5) * 60, z = (rnd() - 0.5) * 60;
    const h = height(x, z);
    if (h < 1.6 || h > 3.9) continue;
    const slope = Math.abs(height(x + 0.6, z) - height(x - 0.6, z)) + Math.abs(height(x, z + 0.6) - height(x, z - 0.6));
    if (slope > 2.2) continue;
    const s = 0.9 + rnd() * 0.6;
    rnd();
    sites.push({ x, z, s, cell: { i: Math.floor(x), j: Math.floor(z) } });
  }
  return sites;
}

/** Whale season: cycles [start, start + length) every WHALE_SEASON_EVERY from WHALE_SEASON_FIRST. */
export function whaleSeason(cycle: number): boolean {
  if (cycle < WHALE_SEASON_FIRST) return false;
  return (cycle - WHALE_SEASON_FIRST) % WHALE_SEASON_EVERY < WHALE_SEASON_LENGTH;
}
export function seaIce(cycle: number): boolean {
  return cycle >= ICE_FIRST && (cycle - ICE_FIRST) % ICE_EVERY === 0;
}

/** After a storm: every building on the slope with trees standing above it may be buried. */
function avalanche(state: SimState, grid: Grid): number {
  const sites: readonly TreeSite[] = state.extraTrees.length ? [...grid.island.trees, ...state.extraTrees] : grid.island.trees; // trees.ts would close an import cycle
  let buried = 0;
  for (const b of buildingList(state).sort((x, y) => x.id - y.id)) {
    if (b.damaged) continue;
    const h = grid.groundUnder(b.cells);
    if (h < AVALANCHE_MIN_HEIGHT || BUILDINGS[b.kind].cls === "deep" || BUILDINGS[b.kind].cls === "edge") continue;
    const above = sites.some((s, k) => state.trees[k] >= 1 && b.cells.some(c => Math.abs(s.cell.i - c.i) <= AVALANCHE_RADIUS && Math.abs(s.cell.j - c.j) <= AVALANCHE_RADIUS) && grid.heightAt(s.cell) > h + AVALANCHE_RISE);
    if (!above || rand(state) >= AVALANCHE_CHANCE) continue;
    b.damaged = true; b.fire = 0;
    buried++;
  }
  if (buried > 0) notify(state, `An avalanche came down the slope: ${buried} building${buried > 1 ? "s" : ""} buried`);
  return buried;
}

export const FJORD: Biome = registerBiome({
  id: "fjord",
  label: "Fjord",
  bands: ["polar"],
  tide: 1.6,
  foods: ["fish", "stockfish"],
  luxury: "whaleOil",
  industrials: ["iron", "timber", "planks"],
  minor: [],
  cannotMake: ["shellfish", "salt", "rice", "coconut", "coffee"],
  favourite: "cocoa",
  unique: ["stockfishRacks", "whalingStation", "ironMine", "iceHouse", "iceBreakerPier"],
  excluded: ["oysterBed", "clamCamp", "sharkNet", "lifeguard"],
  sharks: false,
  shape: seed => ({ height: fjordHeight(seed), trees: fjordTrees }),
  thresholds: { flats: 260, region: 150, piers: 6, treed: 40 },
  validate: s => {
    const out: string[] = [];
    if (s.deepCells < 120) out.push(`channel ${s.deepCells} deep cells < 120`);
    if (s.highCells < 40) out.push(`ridges ${s.highCells} cells above the snow line < 40`);
    return out;
  },
  frozen: state => seaIce(state.tide.cycle),
  happiness: state => (state.storm.active ? 0 : HAPPY_AURORA),
  seasonLabel: state => seaIce(state.tide.cycle) ? "Sea ice: the harbor is frozen" : whaleSeason(state.tide.cycle) ? "Whale season" : null,
  settle: (state, grid) => {
    const cycle = state.tide.cycle;
    const bs = state.biomeState;
    const inSeason = whaleSeason(cycle);
    if (inSeason && !bs.whaleSeason) notify(state, "The whales are passing: whale season");
    bs.whaleSeason = inSeason ? 1 : 0;
    const ice = seaIce(cycle);
    if (ice && !bs.seaIce) notify(state, "The fjord has frozen: the boats stay in and the ship cannot come");
    bs.seaIce = ice ? 1 : 0;
    // The storm that has just ended shakes the snow loose.
    if (state.storm.lastCycle === cycle - 1 && cycle > 0) bs.avalanches = (bs.avalanches ?? 0) + avalanche(state, grid);
  },
});

export { SIZE as FJORD_SIZE };
