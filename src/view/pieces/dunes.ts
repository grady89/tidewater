// The Dunes' pieces (BIOMES.md §3.6): whitewashed cube houses with small domes, the date grove's palms, the coffee
// terrace's bushes behind a mud wall, the sponge divers' hut over the lagoon, the great cistern's dome, the dredger.
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import type { BuildingKind } from "../../sim/balance";
import { cellCenter } from "../../sim/grid";
import { mergeFlat, tint } from "../../world/flatMesh";
import { KIT, PALETTE } from "../buildings";
import { ground } from "../ground";
import type { HomeFactory, PieceFactory } from "./index";

const DOME = "#d9c9a5", DOOR = "#2f6f8f", DUNE = "#e2cf9a", PALM = "#6d9c55", LEAF = "#4a8a55", WHITE = "#f6f1e6";

function dome(scene: Scene, parts: Mesh[], x: number, y: number, z: number, dia: number, hex = DOME): void {
  const m = MeshBuilder.CreateSphere("dome", { diameter: dia, segments: 5, slice: 0.5 }, scene);
  m.position.set(x, y, z);
  parts.push(tint(m, hex));
}

/** A date palm: a leaning ringed trunk, a crown of drooping fronds, a hanging bunch of dates. */
function palm(scene: Scene, parts: Mesh[], x: number, y: number, z: number, h: number, seed: number): void {
  const { box, cyl } = KIT;
  const lean = 0.08 * Math.sin(seed * 2.3);
  for (let k = 0; k < 4; k++) parts.push(cyl(scene, 0.13 - k * 0.012, h / 4 + 0.02, x + lean * k, y + h / 8 + k * h / 4, z, PALETTE.planks, 5));
  const tx = x + lean * 4, ty = y + h;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + seed;
    const f = box(scene, 0.62, 0.02, 0.12, tx + Math.cos(a) * 0.28, ty - 0.08, z + Math.sin(a) * 0.28, k % 2 ? PALM : LEAF);
    f.rotation.set(0, -a, -0.45);
    parts.push(f);
  }
  parts.push(box(scene, 0.12, 0.16, 0.12, tx + 0.08, ty - 0.2, z + 0.05, "#c9674f"));
}

/** A cube house: a whitewashed block, a blue door, a small dome; a roof terrace with a second dome at 2; a stair tower at 3. */
const cubeHome: HomeFactory = (scene, b, bodyW, baseH) => {
  const { box, deck, door, window_, bracketLantern, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const wall = PALETTE.walls[b.id % PALETTE.walls.length];
  const bodyH = baseH * 0.9;
  const bodyD = bodyW * 0.92;
  const bx = cx - 0.03, bz = cz + 0.03;
  parts.push(box(scene, bodyW, bodyH, bodyD, bx, F + bodyH / 2, bz, wall));
  door(scene, parts, bx - bodyW * 0.18, F, bz - bodyD / 2 - 0.005, false, 0.16, Math.min(0.3, bodyH * 0.6));
  parts.push(box(scene, 0.17, 0.3, 0.01, bx - bodyW * 0.18, F + 0.15, bz - bodyD / 2 - 0.012, DOOR));
  window_(scene, parts, bx + bodyW * 0.22, F + bodyH * 0.6, bz - bodyD / 2 - 0.005, false, 0.1, 0.12, false);
  window_(scene, parts, bx + bodyW / 2 + 0.005, F + bodyH * 0.6, bz, true, 0.1, 0.12, false);
  const top = F + bodyH;
  parts.push(box(scene, bodyW + 0.05, 0.05, bodyD + 0.05, bx, top + 0.025, bz, wall));
  const roof = PALETTE.roofs[b.id % PALETTE.roofs.length];
  dome(scene, parts, bx + bodyW * 0.12, top + 0.04, bz + bodyD * 0.1, bodyW * 0.62, roof === DOME ? DOME : WHITE);
  if (b.level >= 2) {
    // A roof terrace: a low parapet on one side and a second, smaller dome.
    parts.push(box(scene, bodyW + 0.05, 0.1, 0.04, bx, top + 0.1, bz - bodyD / 2, wall));
    dome(scene, parts, bx - bodyW * 0.28, top + 0.04, bz - bodyD * 0.22, bodyW * 0.3, DOME);
  }
  if (b.level >= 3) {
    parts.push(box(scene, bodyW * 0.38, bodyH * 0.6, bodyD * 0.38, bx + bodyW * 0.3, top + bodyH * 0.3, bz + bodyD * 0.3, wall));
    dome(scene, parts, bx + bodyW * 0.3, top + bodyH * 0.6, bz + bodyD * 0.3, bodyW * 0.36, DOME);
  }
  const lantern = bracketLantern(scene, parts, bx + bodyW / 2, F + bodyH * 0.7, bz - bodyD / 2 + 0.06, 0, -1);
  return { root: mergeFlat(b.kind, parts, scene), lantern };
};

/** Date grove: four palms on the oasis, a basket of dates, a low mud wall on two sides. */
const dateGrove: PieceFactory = (scene, b) => {
  const { box, cyl, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const parts: Mesh[] = [];
  const g = (x: number, z: number) => ground(x, z);
  const spots: [number, number][] = [[-0.45, -0.4], [0.5, -0.3], [-0.35, 0.5], [0.4, 0.45]];
  spots.forEach(([dx, dz], k) => palm(scene, parts, cx + dx, g(cx + dx, cz + dz), cz + dz, 1.5 + 0.2 * (k % 2), k + b.id));
  parts.push(box(scene, w - 0.1, 0.18, 0.08, cx, g(cx, cz - d / 2 + 0.05) + 0.09, cz - d / 2 + 0.05, DUNE));
  parts.push(box(scene, 0.08, 0.18, d - 0.1, cx - w / 2 + 0.05, g(cx - w / 2 + 0.05, cz) + 0.09, cz, DUNE));
  parts.push(cyl(scene, 0.26, 0.16, cx + 0.05, g(cx, cz) + 0.08, cz + 0.02, "#b9a377", 7, 0.3));
  parts.push(cyl(scene, 0.22, 0.06, cx + 0.05, g(cx, cz) + 0.18, cz + 0.02, "#b9543f", 7));
  return { root: mergeFlat("dateGrove", parts, scene) };
};

/** Coffee terrace: two rows of round bushes with red cherries behind a mud wall, a mat of beans drying. */
const coffeeTerrace: PieceFactory = (scene, b) => {
  const { box, bounds, rock } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const parts: Mesh[] = [];
  const g = (x: number, z: number) => ground(x, z);
  const along = w >= d;
  const len = along ? w : d;
  for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++) {
    const u = -len / 2 + 0.3 + k * (len - 0.6) / 3, v = (row - 0.5) * 0.42;
    const x = cx + (along ? u : v), z = cz + (along ? v : u);
    const bush = MeshBuilder.CreateSphere("bush", { diameter: 0.36, segments: 4 }, scene);
    bush.scaling.set(1, 0.85, 1); bush.position.set(x, g(x, z) + 0.17, z);
    parts.push(tint(bush, (k + row) % 2 ? LEAF : PALM));
    parts.push(rock(scene, x + 0.1, g(x, z) + 0.22, z - 0.08, 0.06, "#b9543f", k * 3 + row));
  }
  parts.push(box(scene, along ? w - 0.05 : 0.07, 0.16, along ? 0.07 : d - 0.05, cx + (along ? 0 : -w / 2 + 0.04), g(cx, cz) + 0.08, cz + (along ? -d / 2 + 0.04 : 0), DUNE));
  parts.push(box(scene, 0.4, 0.03, 0.26, cx + (along ? len / 2 - 0.3 : 0), g(cx, cz) + 0.03, cz + (along ? d / 2 - 0.2 : len / 2 - 0.3), "#5a4636"));
  return { root: mergeFlat("coffeeTerrace", parts, scene) };
};

/** Sponge divers' hut: a small white hut on stilts over the lagoon, a ladder to the water, sponges on a line. */
const spongeDivers: PieceFactory = (scene, b) => {
  const { box, deck, door, rock } = KIT;
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  parts.push(box(scene, 0.5, 0.42, 0.46, x - 0.12, F + 0.21, z + 0.12, WHITE));
  parts.push(box(scene, 0.56, 0.04, 0.52, x - 0.12, F + 0.44, z + 0.12, DOME));
  door(scene, parts, x - 0.12, F, z - 0.115, false, 0.14, 0.26);
  for (const sx of [-1, 1]) parts.push(box(scene, 0.03, 1.2, 0.03, x + 0.32 + sx * 0.08, F - 0.5, z - 0.4, PALETTE.wood));
  for (let k = 0; k < 5; k++) parts.push(box(scene, 0.18, 0.02, 0.03, x + 0.32, F - 0.05 - k * 0.22, z - 0.4, PALETTE.wood));
  parts.push(box(scene, 0.02, 0.5, 0.02, x + 0.35, F + 0.25, z + 0.35, PALETTE.wood));
  parts.push(box(scene, 0.02, 0.5, 0.02, x - 0.4, F + 0.25, z + 0.35, PALETTE.wood));
  parts.push(box(scene, 0.76, 0.01, 0.01, x - 0.025, F + 0.48, z + 0.35, "#b9a377"));
  for (let k = 0; k < 4; k++) parts.push(rock(scene, x - 0.3 + k * 0.18, F + 0.4, z + 0.35, 0.09, k % 2 ? "#e2cf9a" : "#b9a377", k));
  return { root: mergeFlat("spongeDivers", parts, scene) };
};

/** Great cistern: a square stone base, a broad white dome with a lantern cupola, steps, air vents. */
const greatCistern: PieceFactory = (scene, b) => {
  const { box, cyl, deck, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, w - 0.3, 0.45, d - 0.3, cx, F + 0.225, cz, DUNE));
  parts.push(box(scene, w - 0.2, 0.06, d - 0.2, cx, F + 0.48, cz, WHITE));
  dome(scene, parts, cx, F + 0.5, cz, Math.min(w, d) - 0.6, WHITE);
  parts.push(cyl(scene, 0.34, 0.26, cx, F + 0.5 + (Math.min(w, d) - 0.6) / 2 + 0.08, cz, WHITE, 6));
  dome(scene, parts, cx, F + 0.5 + (Math.min(w, d) - 0.6) / 2 + 0.2, cz, 0.36, DOME);
  for (let k = 0; k < 3; k++) parts.push(box(scene, 0.7, 0.1, 0.18, cx, F + 0.05 + k * 0.1, cz - d / 2 + 0.2 + k * 0.1, "#d9c9a5"));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) parts.push(cyl(scene, 0.14, 0.3, cx + sx * (w / 2 - 0.45), F + 0.6, cz + sz * (d / 2 - 0.45), WHITE, 6));
  return { root: mergeFlat("greatCistern", parts, scene) };
};

/** Dredger: a pontoon on posts, an A-frame, a chain of buckets down into the water, a spoil heap. */
const dredger: PieceFactory = (scene, b) => {
  const { box, cyl, rock } = KIT;
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(scene, 0.08, 2.4, x + sx * 0.35, F - 1.2, z + sz * 0.35, PALETTE.wood, 5));
  parts.push(box(scene, 0.9, 0.14, 0.9, x, F + 0.07, z, PALETTE.planks));
  for (const sx of [-1, 1]) {
    const leg = box(scene, 0.05, 1.1, 0.05, x + sx * 0.25, F + 0.6, z + 0.1, PALETTE.wood);
    leg.rotation.x = -0.35;
    parts.push(leg);
  }
  parts.push(box(scene, 0.6, 0.05, 0.05, x, F + 1.1, z - 0.08, PALETTE.wood));
  const boom = box(scene, 0.06, 0.06, 1.3, x, F + 0.5, z - 0.55, PALETTE.wood);
  boom.rotation.x = -0.75;
  parts.push(boom);
  for (let k = 0; k < 5; k++) parts.push(box(scene, 0.12, 0.08, 0.1, x, F + 0.95 - k * 0.24, z - 0.2 - k * 0.2, "#4c5a66"));
  parts.push(rock(scene, x + 0.22, F + 0.2, z + 0.25, 0.3, DUNE, 3));
  parts.push(box(scene, 0.3, 0.3, 0.3, x - 0.22, F + 0.29, z + 0.25, WHITE));
  return { root: mergeFlat("dredger", parts, scene) };
};

export const DUNES_PIECES: Partial<Record<BuildingKind, PieceFactory>> = { dateGrove, coffeeTerrace, spongeDivers, greatCistern, dredger };
export const DUNES_HOMES = { cube: cubeHome } as const;
