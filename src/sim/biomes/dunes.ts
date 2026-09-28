// Dunes (BIOMES.md §3.6): a desert coast — a sandy mainland at the back with one rocky headland, a shallow lagoon,
// and parallel sandbars on the seaward side whose crests are dunes (sand, no trees); two or three oases on the
// mainland are the only fresh water, date palms only there. Tide ×0.8. Dates and fish, coffee at the oases, salt,
// sponges. The Great Cistern is the water building (wells here reach 3); the dredger clears the harbor's silt. The
// sandstorm is the storm (no rain, fire risk up, the harbours silt); a drought every 10th cycle dries the wells;
// on a clear night with a tavern and a market square, the night market doubles the tourists' spending.
import {
  BUILDINGS, COFFEE_PER_CYCLE, DATES_PER_CYCLE, DROUGHT_CISTERN, DROUGHT_EVERY, DROUGHT_FIRST, DROUGHT_HAPPY, NIGHT_MARKET_TOURISM, OASIS_RADIUS,
  SALT_PER_CYCLE, SILT_CYCLES, SILT_FACTOR, SPONGES_PER_SHIFT, WELL_RADIUS_DUNES,
} from "../balance";
import { SIZE, TIDE_PERIOD } from "../../config";
import { cellIndex, HALF } from "../cells";
import { isSunUp } from "../daylight";
import { addCapped } from "../economy";
import { startStorm } from "../events";
import { HeightFn, noiseFor } from "../heightfield";
import { isleHeight, isleWeight } from "../isle";
import { Material, materialCode } from "../materials";
import { buildingList, notify, SimState } from "../state";
import { advanceCycles } from "../tick";
import type { TreeSite } from "../trees";
import type { Grid } from "../grid";
import { Biome, registerBiome } from "./registry";

const MAIN_BACK = -27, LAGOON_FROM = 1, LAGOON_TO = 8, BARS = [11, 16, 20.5], BAR_HALF = 1.9, SEA_EDGE = 24;
const HEADLAND = { x: 19, z: -9, r: 7.5, h: 3.4 };

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** The oasis cells of an island (its fresh water). */
function oasisCells(grid: Grid): { i: number; j: number }[] {
  const out: { i: number; j: number }[] = [];
  const code = materialCode("oasis");
  for (let k = 0; k < grid.materials.length; k++) if (grid.materials[k] === code) out.push({ i: Math.floor(k / SIZE) - HALF, j: (k % SIZE) - HALF });
  return out;
}
const hash = (seed: number, k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;

/** The oases: two or three sites on the mainland plain, clear of the headland. */
export function oasisSites(seed: number): { x: number; z: number }[] {
  const n = 2 + (hash(seed, 9) < 0.5 ? 1 : 0);
  const out: { x: number; z: number }[] = [];
  for (let k = 0; out.length < n && k < 40; k++) {
    const x = -20 + hash(seed, 10 + k) * 30, z = -20 + hash(seed, 50 + k) * 16;
    if (Math.hypot(x - HEADLAND.x, z - HEADLAND.z) < HEADLAND.r + 4) continue;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < 11)) continue;
    out.push({ x: Math.round(x) + 0.5, z: Math.round(z) + 0.5 });
  }
  return out;
}

/** The Dunes' heightfield for one noise seed: mainland, lagoon and bars along z; the whole an island in deep water. */
export function dunesHeight(seed: number): HeightFn {
  const { fbm } = noiseFor(seed);
  const oases = oasisSites(seed);
  return (x: number, z: number): number => {
    const n = fbm(x + 40, z - 20, 4, 1 / 8) - 0.5;
    const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.1;
    // The mainland plain: dry sand rolling into dune crests, falling to a band of tidal flats along the lagoon.
    let h = 0.9 + 0.5 * n + 0.45 * Math.max(0, Math.sin(x * 0.45 + z * 0.2 + seed)) * smooth(-4, -14, z);
    const shore = smooth(LAGOON_FROM - 6, LAGOON_FROM - 3, z);
    h = h * (1 - shore) + (0.1 + n * 0.3) * shore;
    // The lagoon: shallow and still, behind the bars.
    const lagoon = smooth(LAGOON_FROM, LAGOON_FROM + 2, z) * (1 - smooth(LAGOON_TO, LAGOON_TO + 2, z));
    h = h * (1 - lagoon) + (-0.75 + n * 0.25) * lagoon;
    // The sandbars: long crests parallel to the shore, dunes on top, flats down their flanks and in the troughs.
    let bar = 0;
    for (const b of BARS) bar = Math.max(bar, 1 - smooth(BAR_HALF * 0.35, BAR_HALF, Math.abs(z - b - 0.8 * Math.sin(x * 0.15 + seed * 0.4))));
    const barH = -0.12 + 1.45 * bar + n * 0.5 * bar;
    if (z > LAGOON_TO - 1) h = Math.max(h, barH * smooth(LAGOON_TO - 1, LAGOON_TO + 1, z));
    // The headland: the only high rock.
    const hd = Math.hypot(x - HEADLAND.x, z - HEADLAND.z) / HEADLAND.r;
    if (hd < 1) h = Math.max(h, (HEADLAND.h + n) * (1 - smooth(0.2, 1, hd)));
    // The oases: shallow hollows with water at the bottom.
    for (const o of oases) { const d = Math.max(Math.abs(x - o.x), Math.abs(z - o.z)); if (d < 3.4) h = h + (0.72 - h) * (1 - smooth(1.8, 3.4, d)); }
    // The island's outline: sea past the bars and round the ends.
    const edge = Math.max(smooth(SEA_EDGE, SEA_EDGE + 4, z), smooth(MAIN_BACK + 4, MAIN_BACK, z), smooth(24, 28.5, Math.abs(x)));
    h = h * (1 - edge) - 4 * edge;
    h += detail;
    const w = isleWeight(x, z);
    if (w > 0) h = h * (1 - w) + (isleHeight(x, z) * 0.8 + detail * 0.5) * w;
    return h;
  };
}

/** Dune sand on the dry high cells, the lagoon's water, the oases' hollows. */
export function dunesMaterial(seed: number): (i: number, j: number, h: number) => Material {
  const oases = oasisSites(seed);
  return (i, j, h) => {
    const x = i + 0.5, z = j + 0.5;
    if (isleWeight(x, z) > 0) return "plain";
    for (const o of oases) if (Math.max(Math.abs(x - o.x), Math.abs(z - o.z)) < 1.6) return "oasis";
    if (z > LAGOON_FROM - 2 && z < LAGOON_TO + 1 && h < -0.23) return "lagoon";
    if (Math.hypot(x - HEADLAND.x, z - HEADLAND.z) < HEADLAND.r * 0.8) return "plain";
    if (h > 0.95 && h < 1.9) return "dune";
    return "plain";
  };
}

/** Date palms round the oases, and nowhere else. */
function datePalms(seed: number): (height: HeightFn) => TreeSite[] {
  const oases = oasisSites(seed);
  return () => {
    const sites: TreeSite[] = [];
    oases.forEach((o, k) => {
      for (let a = 0; a < 6; a++) {
        const t = a * 1.047 + k;
        const x = o.x + Math.cos(t) * 2.4, z = o.z + Math.sin(t) * 2.4;
        sites.push({ x, z, s: 0.85 + 0.1 * (a % 3), cell: { i: Math.floor(x), j: Math.floor(z) } });
      }
    });
    return sites;
  };
}

/** Drought: every DROUGHT_EVERY cycles from DROUGHT_FIRST. */
export function drought(cycle: number): boolean {
  return cycle >= DROUGHT_FIRST && (cycle - DROUGHT_FIRST) % DROUGHT_EVERY === 0;
}
/** The harbours' channel is silted (a sandstorm, until dredged or the tide scours it). */
export function silted(state: SimState): boolean {
  return (state.biomeState.silt ?? 0) > 0;
}

export const DUNES: Biome = registerBiome({
  id: "dunes",
  label: "Dunes",
  bands: ["temperate"],
  tide: 0.8,
  foods: ["dates", "fish"],
  luxury: "coffee",
  industrials: ["salt"],
  minor: ["sponges"],
  cannotMake: ["timber", "planks", "shellfish", "smoked", "rice", "iron"],
  favourite: "whaleOil",
  unique: ["dateGrove", "coffeeTerrace", "spongeDivers", "greatCistern", "dredger", "saltPan"],
  excluded: ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse", "tallHouse"],
  storm: { swell: 1.3, loss: 0.8, name: "sandstorm", rain: false, fire: 2, fog: 0.75 },
  serviceRadius: { well: WELL_RADIUS_DUNES },
  serviceStrength: (state, b, s) => {
    if (!drought(state.tide.cycle)) return s;
    if (b.kind === "well") return 0;
    if (b.kind === "greatCistern") return s * DROUGHT_CISTERN;
    return s;
  },
  homeHappiness: (state, _grid, home) => drought(state.tide.cycle) && state.fields.coverage.water[cellIndex(home.cells[0].i, home.cells[0].j)] === 0 ? -DROUGHT_HAPPY : 0,
  harbourFactor: state => (silted(state) ? SILT_FACTOR : 1),
  coverage: (_state, grid) => [{ kind: "water", cells: oasisCells(grid), radius: OASIS_RADIUS, value: 1 }],
  tourism: state => ((state.biomeState.nightMarket ?? -9) === state.tide.cycle - 1 ? NIGHT_MARKET_TOURISM : 1),
  startNear: { i: 0, j: -3 },
  shape: seed => ({ height: dunesHeight(seed), material: dunesMaterial(seed), trees: datePalms(seed) }),
  thresholds: { flats: 260, region: 90, piers: 4, harbors: 1, treed: 0 },
  validate: s => {
    const out: string[] = [];
    const m = (k: Material) => s.materials[materialCode(k)] ?? 0;
    if (m("oasis") < 18) out.push(`oases ${m("oasis")} cells < 18 (two sites)`);
    if (m("lagoon") < 80) out.push(`lagoon ${m("lagoon")} < 80`);
    if (m("dune") < 100) out.push(`dunes and bars ${m("dune")} < 100`);
    return out;
  },
  seasonLabel: state => drought(state.tide.cycle) ? "Drought: the wells are dry" : silted(state) ? "The harbour is silted: half the boats can work" : null,
  producers: {
    dateGrove: (state, _grid, _b, s) => addCapped(state, "dates", DATES_PER_CYCLE * s),
    saltPan: (state, _grid, _b, s) => addCapped(state, "salt", SALT_PER_CYCLE * s),
    coffeeTerrace: (state, _grid, _b, s) => addCapped(state, "coffee", COFFEE_PER_CYCLE * s),
    dredger: (state, _grid, _b, s) => { if (silted(state) && s > 0) { state.biomeState.silt = 0; notify(state, "The dredger cleared the harbour's silt"); } return 0; },
  },
  shiftEnd: (state, _grid, phase) => {
    if (phase !== "low") return;
    for (const b of buildingList(state)) if (b.kind === "spongeDivers" && b.reached && !b.cut && !b.damaged && b.workers > 0) b.output += addCapped(state, "sponges", SPONGES_PER_SHIFT * Math.min(1, b.workers / BUILDINGS.spongeDivers.workers));
  },
  settle: (state, _grid) => {
    const cycle = state.tide.cycle, bs = state.biomeState;
    // A sandstorm leaves the channel silted; the tide scours it in SILT_CYCLES if no dredger does first.
    if (state.storm.active && state.storm.lastCycle === cycle - 1 && !silted(state)) { bs.silt = SILT_CYCLES; notify(state, "The sandstorm silted the harbour: half the boats can work until it is dredged"); }
    else if (silted(state)) bs.silt = Math.max(0, (bs.silt ?? 0) - 1);
    if (drought(cycle)) { bs.droughts = (bs.droughts ?? 0) + 1; notify(state, "Drought: the wells are dry; only a great cistern still holds water"); }
    // The night market: the cycle ahead is a clear night, and a tavern and a market square are in business.
    const night = !isSunUp(state.time + TIDE_PERIOD / 2);
    const on = (k: string) => buildingList(state).some(b => b.kind === k && b.reached && !b.cut && !b.damaged && (b.kind === "marketSquare" || b.workers > 0));
    if (night && !state.storm.active && on("tavern") && on("marketSquare")) { bs.nightMarket = cycle; bs.nightMarkets = (bs.nightMarkets ?? 0) + 1; notify(state, "The night market: lanterns in the square, the visitors spend twice over"); }
  },
  force: {
    sandstorm: (state, grid) => { startStorm(state, grid); advanceCycles(state, grid, 1); },
    drought: (state, grid) => { for (let k = 0; k < 24 && !drought(state.tide.cycle); k++) advanceCycles(state, grid, 1); },
    nightMarket: (state, grid) => { const n = state.biomeState.nightMarkets ?? 0; for (let k = 0; k < 6 && (state.biomeState.nightMarkets ?? 0) === n; k++) advanceCycles(state, grid, 1); },
  },
});
