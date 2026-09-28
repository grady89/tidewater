// Cinder (BIOMES.md §3.5): a volcanic cone rising from black sand — radial ridges, a crater, a narrow apron of
// black flats that widens on one side into the town's bay, deep water close in; a lava field down one flank that
// nothing is built on, a fertile band on the mid-slope for the terraces, steam vents and a hot spring. Fish and
// taro, cocoa, glass and sulfur; basalt makes the sea walls cheap in timber. The eruption: two cycles of tremors,
// then ash and a lava flow down the lava flank into the sea that damages what it crosses and makes new land,
// cooling three cycles before anything may stand on it — and a wave for every neighbouring sea.
import {
  ASH_HAPPY, ASH_TERRACE_FACTOR, COCOA_PER_CYCLE, ERUPTION_CHANCE, ERUPTION_COOLDOWN, ERUPTION_FIRST, GLASS_PER_CYCLE,
  GLASS_SULFUR, GLASS_TIMBER, HOT_SPRING_TOURISM, LAVA_COOL_CYCLES, SULFUR_PER_CYCLE, TARO_PER_CYCLE, TREMOR_CYCLES, TIMBERLESS_HARBOR,
} from "../balance";
import { cellIndex, DIRS, HALF, inBounds } from "../cells";
import { addCapped } from "../economy";
import { HeightFn, noiseFor } from "../heightfield";
import { isleHeight, isleWeight } from "../isle";
import { Material, materialCode } from "../materials";
import { rand } from "../rng";
import { buildingList, notify, SimState } from "../state";
import { advanceCycles } from "../tick";
import type { TreeSite } from "../trees";
import type { Grid } from "../grid";
import { Biome, registerBiome } from "./registry";

/** The cone's base radius and peak, the crater, the apron and where the sea begins. */
const CONE_R = 17, PEAK = 8.6, CRATER_R = 2.6, CRATER_DEPTH = 1.8;
const APRON = 3.2, BAY_EXTRA = 6.5, SHELF = 3.5, SEA_DEPTH = -4.2;
/** Vents stand this far out (a share of the cone's radius): low enough on the slope for a path to climb to. */
const VENT_R = 0.62;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const angleDist = (a: number, b: number) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
const hash = (seed: number, k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;

/** The directions that shape a Cinder: the lava flank, the bay (always across the mountain from the lava), the vents, the spring. */
export function cinderLayout(seed: number): { lava: number; bay: number; vents: number[]; spring: number } {
  const lava = hash(seed, 1) * Math.PI * 2;
  const bay = lava + Math.PI + (hash(seed, 2) - 0.5) * 0.8;
  const vents = [lava + 1.3 + hash(seed, 3) * 0.6, lava - 1.4 - hash(seed, 4) * 0.6, lava + Math.PI * 0.75 + hash(seed, 5) * 0.4];
  const spring = bay + (hash(seed, 6) < 0.5 ? 0.55 : -0.55);
  return { lava, bay, vents, spring };
}

/** Where the land meets the sea in a direction: the cone's foot plus the apron, wider in the bay. */
function shoreR(theta: number, bay: number): number {
  return CONE_R + APRON + BAY_EXTRA * Math.max(0, 1 - angleDist(theta, bay) / 0.9);
}

/** The Cinder's heightfield for one noise seed. */
export function cinderHeight(seed: number): HeightFn {
  const { fbm } = noiseFor(seed);
  const L = cinderLayout(seed);
  return (x: number, z: number): number => {
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    const n = fbm(x + 40, z - 20, 4, 1 / 9) - 0.5;
    const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.14;
    const shore = shoreR(theta, L.bay);
    let h: number;
    if (r < CONE_R) {
      // The cone: concave slopes, radial ridges between gullies, the crater at the top.
      const u = r / CONE_R;
      h = PEAK * Math.pow(1 - u, 1.35) + 0.6 * u;
      const ridges = Math.pow(Math.max(0, Math.cos(theta * 7 + seed * 0.9 + n * 1.5)), 3) * 1.1 * Math.sin(Math.PI * Math.min(1, u * 1.2));
      h += ridges + n * 1.1 * (0.3 + u);
      h -= CRATER_DEPTH * (1 - smooth(CRATER_R * 0.6, CRATER_R, r));
      // The lava field: a flow levee down the lava flank, a little proud of the slope.
      h += 0.35 * Math.max(0, 1 - angleDist(theta, L.lava) / 0.22) * smooth(CRATER_R, CRATER_R + 3, r);
    } else if (r < shore) {
      // The apron: black flats from the foot to the waterline, barely above the tide, a little higher inland.
      const t = (r - CONE_R) / Math.max(0.5, shore - CONE_R);
      h = 0.62 - 0.72 * smooth(0, 1, t) + n * 0.3;
    } else {
      // The shelf drops away fast: deep water close in.
      h = -0.1 + (SEA_DEPTH + 0.1) * smooth(shore, shore + SHELF, r) + n * 0.25 * (1 - smooth(shore, shore + SHELF, r));
    }
    // The lava field runs on into the sea at the toe as a black tongue.
    const toe = Math.max(0, 1 - angleDist(theta, L.lava) / 0.16) * (1 - smooth(shore, shore + 2.5, r)) * smooth(CONE_R - 1, CONE_R + 1, r);
    h = Math.max(h, h * (1 - toe) + 0.3 * toe);
    h += detail;
    const w = isleWeight(x, z);
    if (w > 0) h = h * (1 - w) + (isleHeight(x, z) + detail * 0.5) * w;
    return h;
  };
}

/** Lava down its flank, the fertile band on the mid-slope, vents (2×2) up the slope, a hot spring (3×3) on the bay shore. */
export function cinderMaterial(seed: number): (i: number, j: number, h: number) => Material {
  const L = cinderLayout(seed);
  return (i, j, h) => {
    const x = i + 0.5, z = j + 0.5;
    if (isleWeight(x, z) > 0) return "plain";
    const r = Math.hypot(x, z), theta = Math.atan2(z, x);
    const shore = shoreR(theta, L.bay);
    if (angleDist(theta, L.lava) < 0.2 && r > CRATER_R && r < shore + 0.5 && h > -0.3) return "lava";
    for (const a of L.vents) {
      const vx = Math.cos(a) * CONE_R * VENT_R, vz = Math.sin(a) * CONE_R * VENT_R;
      if (Math.abs(x - vx) < 1.05 && Math.abs(z - vz) < 1.05) return "vent";
    }
    const sx = Math.cos(L.spring) * (shore - 1.6), sz = Math.sin(L.spring) * (shore - 1.6);
    if (Math.abs(x - sx) < 1.6 && Math.abs(z - sz) < 1.6 && h > -0.3 && h < 0.62) return "spring";
    if (h > 1.7 && h < 4.2 && r < CONE_R) return "fertile";
    return "plain";
  };
}

/** Trees on the lower slopes and the rim of the fertile band (not on it: the terraces go there), not on the lava. */
function cinderTrees(seed: number): (height: HeightFn) => TreeSite[] {
  const mat = cinderMaterial(seed);
  return height => {
    let s = 37;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const sites: TreeSite[] = [];
    for (let tries = 0; tries < 6000 && sites.length < 48; tries++) {
      const x = (rnd() - 0.5) * 56, z = (rnd() - 0.5) * 56;
      const h = height(x, z);
      rnd();
      if (!((h > 0.75 && h < 1.7) || (h > 4.2 && h < 5.4))) continue;
      const i = Math.floor(x), j = Math.floor(z);
      if (mat(i, j, height(i + 0.5, j + 0.5)) !== "plain") continue;
      sites.push({ x, z, s: 0.8 + rnd() * 0.5, cell: { i, j } });
    }
    return sites;
  };
}

// ---------- the mountain ----------

/** Is the town under ash this cycle (the cycle after an eruption)? */
export function ashFalling(state: SimState): boolean {
  return (state.biomeState.ash ?? -1) === state.tide.cycle;
}
/** Is the mountain trembling (an eruption booked)? */
export function trembling(state: SimState): boolean {
  return (state.biomeState.eruptAt ?? -1) > state.tide.cycle;
}

/**
 * The lava flow: from the crater down the lava flank to the sea and a few cells into it, three cells wide,
 * wandering a little. Buildings on its cells are damaged; the water cells at its toe (unbuilt) become new land
 * that cools for LAVA_COOL_CYCLES before anything may stand on it. Returns the cells it crossed and the new land.
 */
function lavaFlow(state: SimState, grid: Grid): { crossed: number; land: number; damaged: number } {
  const L = cinderLayout(grid.island.noiseSeed);
  const crossed = new Set<number>(), land: number[] = [];
  let theta = L.lava, damaged = 0, seaSteps = 0;
  for (let r = CRATER_R; r < 31 && seaSteps < 4; r += 0.5) {
    theta += (rand(state) - 0.5) * 0.05;
    const cx = Math.cos(theta) * r, cz = Math.sin(theta) * r;
    const px = -Math.sin(theta), pz = Math.cos(theta);
    for (const w of [-1.2, 0, 1.2]) {
      const i = Math.floor(cx + px * w), j = Math.floor(cz + pz * w);
      if (inBounds(i, j)) crossed.add(cellIndex(i, j));
    }
    const ci = Math.floor(cx), cj = Math.floor(cz);
    if (inBounds(ci, cj) && grid.heights[cellIndex(ci, cj)] < grid.tides.lo) seaSteps += 0.5;
  }
  for (const k of [...crossed].sort((a, b) => a - b)) {
    const c = { i: Math.floor(k / 64) - HALF, j: (k % 64) - HALF };
    const b = grid.buildingAt(c);
    if (b && !b.damaged) { b.damaged = true; b.fire = 0; damaged++; }
    if (!b && grid.classAt(c) !== "high" && !state.landfill.includes(k)) land.push(k);
  }
  for (const k of land) {
    state.landfill.push(k);
    state.newLand.push({ k, until: state.tide.cycle + LAVA_COOL_CYCLES });
    grid.applyLandfill({ i: Math.floor(k / 64) - HALF, j: (k % 64) - HALF });
  }
  grid.coolNewLand();
  return { crossed: crossed.size, land: land.length, damaged };
}

function erupt(state: SimState, grid: Grid): void {
  const bs = state.biomeState;
  const flow = lavaFlow(state, grid);
  bs.ash = state.tide.cycle + 1;
  bs.eruptions = (bs.eruptions ?? 0) + 1;
  bs.lastEruption = state.tide.cycle;
  bs.newLand = (bs.newLand ?? 0) + flow.land;
  // The wave goes out to every neighbouring sea: the World's event bus delivers it (sim/worldLedger.ts).
  state.outbox.push({ kind: "tsunami", from: "eruption", cycle: state.tide.cycle });
  notify(state, `The mountain erupts: ash on the town, a lava flow down the flank${flow.damaged ? ` took ${flow.damaged} building${flow.damaged > 1 ? "s" : ""}` : ""}${flow.land ? `, ${flow.land} cells of new land cooling` : ""}`);
}

export const CINDER: Biome = registerBiome({
  id: "cinder",
  label: "Cinder",
  bands: ["tropical"],
  tide: 1,
  foods: ["fish", "taro"],
  luxury: "cocoa",
  industrials: ["glass", "sulfur"],
  minor: [],
  cannotMake: ["timber", "planks", "shellfish", "smoked", "rice", "coffee", "iron", "salt"],
  favourite: "indigo",
  unique: ["taroTerrace", "cocoaTerrace", "glassworks", "sulfurWorks", "hotSpring"],
  excluded: ["oysterBed", "clamCamp", "lumberCamp", "sawmill", "smokehouse", "tallHouse"],
  costs: { seaWall: { money: 25, timber: 1.5 }, harbor: TIMBERLESS_HARBOR },
  startNear: { i: 0, j: 0 },
  shape: seed => ({ height: cinderHeight(seed), material: cinderMaterial(seed), trees: cinderTrees(seed) }),
  thresholds: { flats: 180, region: 70, piers: 6, harbors: 1, treed: 12 },
  validate: s => {
    const out: string[] = [];
    const m = (k: Material) => s.materials[materialCode(k)] ?? 0;
    if (s.highCells < 30) out.push(`cone ${s.highCells} cells above 4 < 30`);
    if (m("lava") < 25) out.push(`lava band ${m("lava")} < 25`);
    if (m("fertile") < 40) out.push(`fertile band ${m("fertile")} < 40`);
    if (m("vent") < 8) out.push(`vents ${m("vent")} cells < 8 (two sites)`);
    if (m("spring") < 4) out.push(`spring ${m("spring")} cells < 4`);
    return out;
  },
  happiness: state => ashFalling(state) ? -ASH_HAPPY : 0,
  tourism: state => buildingList(state).some(b => b.kind === "hotSpring" && b.reached && !b.cut && !b.damaged && b.workers > 0) ? HOT_SPRING_TOURISM : 1,
  seasonLabel: state => trembling(state) ? "The mountain trembles: steam at the vents" : ashFalling(state) ? "Ash is falling" : (state.newLand.some(n => n.until > state.tide.cycle) ? "New land cooling on the lava flank" : null),
  producers: {
    taroTerrace: (state, _grid, _b, s) => addCapped(state, "taro", TARO_PER_CYCLE * s * (ashFalling(state) ? ASH_TERRACE_FACTOR : 1)),
    cocoaTerrace: (state, _grid, _b, s) => addCapped(state, "cocoa", COCOA_PER_CYCLE * s * (ashFalling(state) ? ASH_TERRACE_FACTOR : 1)),
    sulfurWorks: (state, _grid, _b, s) => addCapped(state, "sulfur", SULFUR_PER_CYCLE * s),
    glassworks: (state, _grid, _b, s) => {
      // Black sand is free; the furnace burns sulfur, or timber when there is none.
      const r = state.resources;
      const want = GLASS_PER_CYCLE * s;
      const bySulfur = Math.min(want, r.sulfur / GLASS_SULFUR);
      r.sulfur -= bySulfur * GLASS_SULFUR;
      const byTimber = Math.min(want - bySulfur, r.timber / GLASS_TIMBER);
      r.timber -= byTimber * GLASS_TIMBER;
      return addCapped(state, "glass", bySulfur + byTimber);
    },
  },
  settle: (state, grid) => {
    const cycle = state.tide.cycle;
    const bs = state.biomeState;
    // New land that has cooled opens to building.
    const before = state.newLand.length;
    state.newLand = state.newLand.filter(n => n.until > cycle);
    if (state.newLand.length < before) { grid.coolNewLand(); notify(state, "The new land on the lava flank has cooled: it can be built on"); }
    if ((bs.eruptAt ?? -1) === cycle) { bs.tremor = 0; erupt(state, grid); return; }
    if (trembling(state)) return;
    // The mountain's roll: rare, never early, never soon after the last.
    if (cycle < ERUPTION_FIRST || cycle - (bs.lastEruption ?? -99) < ERUPTION_COOLDOWN) return;
    if (rand(state) < ERUPTION_CHANCE) {
      bs.eruptAt = cycle + TREMOR_CYCLES;
      bs.tremor = 1;
      notify(state, "The mountain trembles: steam is rising from the vents");
    }
  },
  force: {
    eruption: (state, grid) => {
      const bs = state.biomeState;
      if (!trembling(state)) { bs.eruptAt = state.tide.cycle + TREMOR_CYCLES; bs.tremor = 1; notify(state, "The mountain trembles: steam is rising from the vents"); }
      for (let k = 0; k < 6 && (bs.eruptAt ?? -1) > state.tide.cycle - 1 && (bs.lastEruption ?? -99) < bs.eruptAt!; k++) advanceCycles(state, grid, 1);
    },
    tremors: state => { const bs = state.biomeState; bs.eruptAt = state.tide.cycle + TREMOR_CYCLES; bs.tremor = 1; notify(state, "The mountain trembles: steam is rising from the vents"); },
  },
});
void DIRS;
