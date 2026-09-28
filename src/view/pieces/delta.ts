// The Delta's pieces (BIOMES.md §3.4): reed-thatched stilt houses with wide eaves, flooded rice paddies behind
// their bunds, crab pots on the channel edges, white salt pans, indigo vats with cloth drying, a warden tower,
// croc nets. Boxes, cylinders and cones from the shared kit, one merged mesh each.
import { Mesh, MeshBuilder } from "@babylonjs/core";
import type { BuildingKind } from "../../sim/balance";
import { cellCenter } from "../../sim/grid";
import { mergeFlat, tint } from "../../world/flatMesh";
import { KIT, PALETTE } from "../buildings";
import { ground } from "../ground";
import type { HomeFactory, PieceFactory } from "./index";

const MUD = "#9e8c66", RICE = "#79ad5e", RICE_YOUNG = "#a8c97a", SALT = "#f2ece0";
/** Indigo: the one new hex the Delta needed (dyed cloth and the vats' liquor); nothing in the palette is this blue. */
const INDIGO = "#2e3f7f";

/** A reed stilt house: tall posts, pale reed walls, a thatched hip roof with deep eaves; a gallery at level 3. */
const reedHome: HomeFactory = (scene, b, bodyW, baseH) => {
  const { box, cyl, deck, door, window_, hip, railing, bracketLantern, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const wall = PALETTE.walls[b.id % PALETTE.walls.length];
  const bodyH = baseH * 0.9 + 0.12 * (b.level - 1);
  const bodyD = bodyW * 0.9;
  const bx = cx - 0.04, bz = cz + 0.04;
  parts.push(box(scene, bodyW, bodyH, bodyD, bx, F + bodyH / 2, bz, wall));
  // Reed bundles: vertical bands up the wall.
  for (let k = -2; k <= 2; k++) parts.push(box(scene, 0.02, bodyH, bodyD + 0.01, bx + k * bodyW * 0.2, F + bodyH / 2, bz, "#d9c9a5"));
  door(scene, parts, bx - bodyW * 0.18, F, bz - bodyD / 2 - 0.005, false, 0.17, Math.min(0.3, bodyH * 0.55));
  window_(scene, parts, bx + bodyW / 2 + 0.005, F + bodyH * 0.6, bz, true, 0.14, 0.12, false);
  const roof = PALETTE.roofs[b.id % PALETTE.roofs.length];
  // The wide eaves: a low hip that overhangs far, with a ridge of darker thatch.
  hip(scene, parts, bx, bz, bodyW, bodyD, F + bodyH, bodyW * 0.5, roof, 0.3);
  parts.push(box(scene, bodyW * 0.5, 0.06, 0.08, bx, F + bodyH + bodyW * 0.5 + 0.02, bz, "#8a6f52"));
  if (b.level >= 2) {
    // A side platform under its own lean-to, for the drying mats.
    parts.push(box(scene, 0.3, 0.04, bodyD, bx + bodyW / 2 + 0.16, F + 0.02, bz, PALETTE.planks));
    parts.push(box(scene, 0.36, 0.03, bodyD + 0.1, bx + bodyW / 2 + 0.18, F + bodyH * 0.8, bz, roof));
  }
  if (b.level >= 3) {
    parts.push(box(scene, bodyW + 0.2, 0.04, 0.22, bx, F + bodyH * 0.55, bz - bodyD / 2 - 0.1, PALETTE.planks));
    railing(scene, parts, bx - bodyW / 2 - 0.1, bz - bodyD / 2 - 0.2, bx + bodyW / 2 + 0.1, bz - bodyD / 2 - 0.2, F + bodyH * 0.55, 0.16);
  }
  // A ladder down from the door: the stilts are tall here.
  for (let k = 1; k <= 4; k++) parts.push(box(scene, 0.22, 0.03, 0.04, bx - bodyW * 0.18, F - k * 0.16, bz - bodyD / 2 - 0.12, "#5a4636"));
  parts.push(cyl(scene, 0.05, 0.14, bx, F + bodyH + bodyW * 0.5 + 0.08, bz, "#5a4636", 4));
  const lantern = bracketLantern(scene, parts, bx + bodyW / 2, F + bodyH * 0.7, bz - bodyD / 2 + 0.06, 0, -1);
  return { root: mergeFlat(b.kind, parts, scene), lantern };
};

/** A rice paddy: a field at the water's level behind low mud bunds, rows of rice, a field hut on stilts in a corner. */
const ricePaddy: PieceFactory = (scene, b) => {
  const { box, cyl, pyramid, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const parts: Mesh[] = [];
  const g = (x: number, z: number) => ground(x, z);
  // Bunds round the edge and one across the middle.
  for (const sz of [-1, 1]) parts.push(box(scene, w - 0.04, 0.16, 0.14, cx, g(cx, cz + sz * (d / 2 - 0.07)) + 0.06, cz + sz * (d / 2 - 0.07), MUD));
  for (const sx of [-1, 1]) parts.push(box(scene, 0.14, 0.16, d - 0.04, cx + sx * (w / 2 - 0.07), g(cx + sx * (w / 2 - 0.07), cz) + 0.06, cz, MUD));
  parts.push(box(scene, w - 0.2, 0.12, 0.1, cx, g(cx, cz) + 0.05, cz, MUD));
  // Rows of rice: small green tufts, a lighter green on alternate rows.
  for (let r = 0; r < 6; r++) for (let k = 0; k < 7; k++) {
    const x = cx - w / 2 + 0.25 + k * (w - 0.5) / 6, z = cz - d / 2 + 0.25 + r * (d - 0.5) / 5;
    if (Math.abs(z - cz) < 0.1) continue;
    parts.push(cyl(scene, 0.09, 0.2, x, g(x, z) + 0.1, z, r % 2 ? RICE : RICE_YOUNG, 4, 0.02));
  }
  // The field hut: four poles, a thatch cone, in the far corner.
  const hx = cx + w / 2 - 0.3, hz = cz + d / 2 - 0.3, top = g(hx, hz) + 0.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.04, top - g(hx, hz), 0.04, hx + sx * 0.14, (top + g(hx, hz)) / 2, hz + sz * 0.14, "#5a4636"));
  parts.push(box(scene, 0.36, 0.04, 0.36, hx, top, hz, PALETTE.planks));
  parts.push(pyramid(scene, 0.62, 0.34, hx, top + 0.19, hz, PALETTE.roofs[0]));
  return { root: mergeFlat("ricePaddy", parts, scene) };
};

/** Crab pots: a small staging on piles at the channel edge, a stack of round pots, a line of floats. */
const crabPots: PieceFactory = (scene, b) => {
  const { box, cyl, stilt } = KIT;
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, 0.7, 0.07, 0.7, x, F - 0.035, z, PALETTE.planks)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, x + sx * 0.28, z + sz * 0.28, F - 0.06, 0.07, 5));
  // Pots: slatted drums, stacked two high.
  for (const [dx, dz, dy] of [[-0.15, -0.12, 0], [0.15, -0.12, 0], [0, 0.15, 0], [0, -0.12, 0.22]]) {
    parts.push(cyl(scene, 0.24, 0.2, x + dx, F + dy + 0.1, z + dz, "#8a6f52", 8));
    parts.push(cyl(scene, 0.25, 0.03, x + dx, F + dy + 0.1, z + dz, "#5a4636", 8));
  }
  parts.push(box(scene, 0.015, 0.5, 0.015, x + 0.32, F - 0.2, z + 0.32, "#b9a377"));
  for (let k = 0; k < 3; k++) parts.push(cyl(scene, 0.08, 0.06, x + 0.32 + k * 0.12, 0.6, z + 0.45, k % 2 ? PALETTE.roofs[0] : SALT, 6));
  return { root: mergeFlat("crabPots", parts, scene) };
};

/** Salt pans: shallow beds of brine in plank frames, heaps of white salt, a rake and a small store. */
const saltPan: PieceFactory = (scene, b) => {
  const { box, cyl, rock, gable, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1]] as [number, number][]) {
    const x = cx + sx * w / 4, z = cz + sz * d / 4;
    parts.push(box(scene, w / 2 - 0.1, 0.06, d / 2 - 0.1, x, F - 0.02, z, "#b9a377"));
    parts.push(box(scene, w / 2 - 0.2, 0.02, d / 2 - 0.2, x, F + 0.02, z, sx === 1 ? SALT : "#d5e6ea"));
  }
  // The store in the fourth quarter, and the heaps.
  const sx = cx + w / 4, sz = cz + d / 4;
  parts.push(box(scene, 0.62, 0.45, 0.52, sx, F + 0.225, sz, PALETTE.walls[1 % PALETTE.walls.length]));
  gable(scene, parts, sx, sz, 0.62, 0.52, F + 0.45, 0.26, PALETTE.roofs[1 % PALETTE.roofs.length], true);
  for (const [dx, dz, s] of [[-0.3, 0.2, 0.34], [0.05, 0.3, 0.26]] as [number, number, number][]) parts.push(cyl(scene, s, s * 0.7, cx + dx, F + s * 0.35, cz + dz, SALT, 7, 0));
  const rake = box(scene, 0.03, 0.7, 0.03, cx - 0.15, F + 0.3, cz - 0.1, PALETTE.wood); rake.rotation.z = 0.5; parts.push(rake);
  parts.push(rock(scene, cx + 0.2, F + 0.05, cz - 0.4, 0.2, "#d9c9a5", 2));
  return { root: mergeFlat("saltPan", parts, scene) };
};

/** Indigo vats: three round vats of dark liquor under a thatch, frames of dyed cloth drying beside them. */
const indigoVats: PieceFactory = (scene, b) => {
  const { box, cyl, deck, hip, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  for (const dx of [-0.65, -0.25]) {
    parts.push(cyl(scene, 0.34, 0.3, cx + dx, F + 0.15, cz - 0.15, "#8a6f52", 8));
    parts.push(cyl(scene, 0.28, 0.02, cx + dx, F + 0.3, cz - 0.15, INDIGO, 8));
  }
  parts.push(cyl(scene, 0.34, 0.3, cx - 0.45, F + 0.15, cz + 0.22, "#8a6f52", 8));
  parts.push(cyl(scene, 0.28, 0.02, cx - 0.45, F + 0.3, cz + 0.22, INDIGO, 8));
  for (const sx of [-0.85, -0.05]) for (const sz of [-0.4, 0.4]) parts.push(box(scene, 0.05, 0.8, 0.05, cx + sx, F + 0.4, cz + sz, PALETTE.wood));
  hip(scene, parts, cx - 0.45, cz, 0.85, 0.85, F + 0.8, 0.28, PALETTE.roofs[0], 0.12);
  // The drying frame: two poles, a bar, cloth in two blues.
  for (const sz of [-0.35, 0.35]) parts.push(box(scene, 0.04, 0.8, 0.04, cx + 0.55, F + 0.4, cz + sz, PALETTE.wood));
  parts.push(box(scene, 0.04, 0.04, 0.8, cx + 0.55, F + 0.8, cz, PALETTE.wood));
  for (const [dz, hex] of [[-0.2, INDIGO], [0.05, "#4c5a66"], [0.25, INDIGO]] as [number, string][]) parts.push(box(scene, 0.02, 0.5, 0.18, cx + 0.55, F + 0.54, cz + dz, hex));
  return { root: mergeFlat("indigoVats", parts, scene) };
};

/** Warden tower: a tall bamboo tower with a thatched lookout, a horn on the rail, a ladder. */
const wardenTower: PieceFactory = (scene, b) => {
  const { box, cyl, railing, hip } = KIT;
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  const H = 1.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.06, H, 0.06, x + sx * 0.25, F + H / 2, z + sz * 0.25, "#b9a377"));
  for (const sz of [-1, 1]) { const br = box(scene, 0.55, 0.035, 0.035, x, F + 0.6, z + sz * 0.25, "#b9a377"); br.rotation.z = 0.45; parts.push(br); }
  parts.push(box(scene, 0.7, 0.05, 0.7, x, F + H, z, PALETTE.planks));
  railing(scene, parts, x - 0.35, z - 0.35, x + 0.35, z - 0.35, F + H, 0.2);
  railing(scene, parts, x - 0.35, z + 0.35, x + 0.35, z + 0.35, F + H, 0.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.04, 0.5, 0.04, x + sx * 0.3, F + H + 0.25, z + sz * 0.3, "#b9a377"));
  hip(scene, parts, x, z, 0.7, 0.7, F + H + 0.5, 0.32, PALETTE.roofs[0], 0.18);
  const horn = MeshBuilder.CreateCylinder("horn", { diameterTop: 0.14, diameterBottom: 0.03, height: 0.3, tessellation: 6 }, scene);
  horn.rotation.z = Math.PI / 2; horn.position.set(x + 0.42, F + H + 0.22, z - 0.3);
  parts.push(tint(horn, "#e6dccb"));
  for (let k = 0; k < 7; k++) parts.push(box(scene, 0.2, 0.03, 0.035, x - 0.33, F + 0.15 + k * 0.18, z - 0.38, "#5a4636"));
  parts.push(cyl(scene, 0.03, 0.4, x + 0.3, F + H + 0.95, z + 0.3, PALETTE.wood, 4));
  return { root: mergeFlat("wardenTower", parts, scene) };
};

/** A croc net: the shark net's panel on its stakes (the floats ride the water in the effects layer). */
const crocNet: PieceFactory = (scene, b) => {
  const m = KIT.sharkNet(scene, b);
  m.root.name = "crocNet";
  return m;
};

export const DELTA_PIECES: Partial<Record<BuildingKind, PieceFactory>> = { ricePaddy, crabPots, saltPan, indigoVats, wardenTower, crocNet };
export const DELTA_HOMES = { reed: reedHome } as const;
