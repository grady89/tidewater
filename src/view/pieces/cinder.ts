// The Cinder's pieces (BIOMES.md §3.5): flat-roofed basalt houses, terraces of taro and cocoa stepped into the
// fertile band, the glassworks' furnace, sulfur works over a vent, the hot-spring bathhouse's steaming pools.
import { Mesh, MeshBuilder } from "@babylonjs/core";
import type { BuildingKind } from "../../sim/balance";
import { cellCenter } from "../../sim/grid";
import { mergeFlat, tint } from "../../world/flatMesh";
import { KIT, PALETTE } from "../buildings";
import { ground } from "../ground";
import type { HomeFactory, PieceFactory } from "./index";

const BASALT = "#3d3a3a", ROCK = "#4a4644", LEAF = "#3f8a4a", LEAF_LIGHT = "#79ad5e", TEAL = "#6fbfb8";
/** Sulfur: the one new hex the Cinder needed (the yellow crust at the vents); nothing in the palette is that yellow. */
const SULFUR = "#d9c24a";

/** A basalt house: a squat dark cube, a flat roof with a parapet, deep small windows; an awning at 2, a second cube at 3. */
const basaltHome: HomeFactory = (scene, b, bodyW, baseH) => {
  const { box, cyl, deck, door, window_, bracketLantern, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const wall = PALETTE.walls[b.id % PALETTE.walls.length];
  const bodyH = baseH * 0.85;
  const bodyD = bodyW * 0.9;
  const bx = cx - 0.04, bz = cz + 0.04;
  parts.push(box(scene, bodyW, bodyH, bodyD, bx, F + bodyH / 2, bz, wall));
  // Courses of dressed stone: two dark bands.
  for (const k of [0.3, 0.62]) parts.push(box(scene, bodyW + 0.01, 0.02, bodyD + 0.01, bx, F + bodyH * k, bz, BASALT));
  door(scene, parts, bx - bodyW * 0.15, F, bz - bodyD / 2 - 0.005, false, 0.17, Math.min(0.3, bodyH * 0.6));
  window_(scene, parts, bx + bodyW / 2 + 0.005, F + bodyH * 0.62, bz, true, 0.11, 0.11, false);
  window_(scene, parts, bx + bodyW * 0.2, F + bodyH * 0.62, bz - bodyD / 2 - 0.005, false, 0.11, 0.11, false);
  // The flat roof and its parapet.
  const top = F + bodyH;
  parts.push(box(scene, bodyW + 0.08, 0.06, bodyD + 0.08, bx, top + 0.03, bz, BASALT));
  for (const sz of [-1, 1]) parts.push(box(scene, bodyW + 0.08, 0.08, 0.05, bx, top + 0.1, bz + sz * (bodyD / 2 + 0.02), BASALT));
  for (const sx of [-1, 1]) parts.push(box(scene, 0.05, 0.08, bodyD + 0.08, bx + sx * (bodyW / 2 + 0.02), top + 0.1, bz, BASALT));
  const roof = PALETTE.roofs[b.id % PALETTE.roofs.length];
  if (b.level >= 2) {
    // A roof terrace: an awning on four poles.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.03, 0.34, 0.03, bx + sx * bodyW * 0.3, top + 0.2, bz + sz * bodyD * 0.3, PALETTE.wood));
    parts.push(box(scene, bodyW * 0.7, 0.025, bodyD * 0.7, bx, top + 0.38, bz, roof));
  }
  if (b.level >= 3) {
    parts.push(box(scene, bodyW * 0.5, bodyH * 0.55, bodyD * 0.5, bx - bodyW * 0.2, top + bodyH * 0.28, bz + bodyD * 0.2, wall));
    parts.push(box(scene, bodyW * 0.56, 0.05, bodyD * 0.56, bx - bodyW * 0.2, top + bodyH * 0.55 + 0.03, bz + bodyD * 0.2, BASALT));
  }
  parts.push(cyl(scene, 0.1, 0.16, bx + bodyW * 0.3, top + 0.14, bz - bodyD * 0.25, roof, 6)); // a water jar on the roof
  const lantern = bracketLantern(scene, parts, bx + bodyW / 2, F + bodyH * 0.72, bz - bodyD / 2 + 0.06, 0, -1);
  return { root: mergeFlat(b.kind, parts, scene), lantern };
};

/** Two stone-walled steps cut into the slope, planted; the crop decides the plants. */
function terrace(scene: import("@babylonjs/core").Scene, b: import("../../sim/state").Building, crop: "taro" | "cocoa"): Mesh {
  const { box, cyl, rock, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const parts: Mesh[] = [];
  const g = (x: number, z: number) => ground(x, z);
  const base = Math.min(g(cx - w / 4, cz - d / 4), g(cx + w / 4, cz - d / 4), g(cx - w / 4, cz + d / 4), g(cx + w / 4, cz + d / 4));
  for (const [k, sz] of [[0, -1], [1, 1]] as [number, number][]) {
    const z = cz + sz * d / 4;
    const top = Math.max(base + 0.12 + k * 0.28, g(cx, z) + 0.05);
    parts.push(box(scene, w - 0.08, Math.max(0.1, top - base + 0.1), d / 2 - 0.05, cx, (top + base - 0.1) / 2, z, "#5a4636"));
    parts.push(box(scene, w - 0.04, 0.08, 0.08, cx, top - 0.02, z - d / 4 + 0.04, ROCK)); // the stone lip
    for (let i = 0; i < 4; i++) {
      const x = cx - w / 2 + 0.3 + i * (w - 0.6) / 3;
      if (crop === "taro") {
        parts.push(cyl(scene, 0.34, 0.08, x, top + 0.14, z, LEAF, 5, 0.1));
        parts.push(box(scene, 0.03, 0.14, 0.03, x, top + 0.07, z, LEAF_LIGHT));
      } else {
        parts.push(cyl(scene, 0.06, 0.3, x, top + 0.15, z, PALETTE.wood, 5));
        const crown = MeshBuilder.CreateSphere("cc", { diameter: 0.34, segments: 4 }, scene);
        crown.scaling.set(1, 0.7, 1); crown.position.set(x, top + 0.4, z);
        parts.push(tint(crown, i % 2 ? LEAF : LEAF_LIGHT));
        parts.push(rock(scene, x + 0.08, top + 0.26, z + 0.05, 0.08, "#c9674f", i));
      }
    }
  }
  if (crop === "cocoa") parts.push(box(scene, 0.5, 0.04, 0.3, cx + w / 2 - 0.35, base + 0.2, cz - d / 2 + 0.2, "#5a4636")); // the bean drying mat
  return mergeFlat(b.kind, parts, scene);
}
const taroTerrace: PieceFactory = (scene, b) => ({ root: terrace(scene, b, "taro") });
const cocoaTerrace: PieceFactory = (scene, b) => ({ root: terrace(scene, b, "cocoa") });

/** Glassworks: a domed furnace with its mouth aglow and a tall stack, a black-sand heap, shelves of green glass. */
const glassworks: PieceFactory = (scene, b) => {
  const { box, cyl, deck, rock, gable, bounds, accents } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const dome = MeshBuilder.CreateSphere("furnace", { diameter: 1.0, segments: 6, slice: 0.5 }, scene);
  dome.position.set(cx - 0.35, F, cz + 0.2);
  parts.push(tint(dome, accents().stone));
  parts.push(box(scene, 0.26, 0.2, 0.06, cx - 0.35, F + 0.12, cz - 0.3, "#ffb859")); // the mouth, aglow
  parts.push(cyl(scene, 0.22, 1.5, cx - 0.35, F + 0.95, cz + 0.45, BASALT, 6, 0.18));
  parts.push(box(scene, 0.8, 0.6, 0.6, cx + 0.45, F + 0.3, cz + 0.35, PALETTE.walls[0]));
  gable(scene, parts, cx + 0.45, cz + 0.35, 0.8, 0.6, F + 0.6, 0.3, PALETTE.roofs[0], true);
  for (let k = 0; k < 2; k++) {
    parts.push(box(scene, 0.7, 0.03, 0.18, cx + 0.45, F + 0.18 + k * 0.22, cz - 0.4, PALETTE.planks));
    for (let i = 0; i < 5; i++) parts.push(cyl(scene, 0.07, 0.14, cx + 0.2 + i * 0.12, F + 0.26 + k * 0.22, cz - 0.4, i % 2 ? TEAL : "#79ad5e", 6));
  }
  parts.push(rock(scene, cx - 0.75, F + 0.1, cz - 0.55, 0.45, "#2e2a2a", 2)); // black sand
  return { root: mergeFlat("glassworks", parts, scene) };
};

/** Sulfur works: a timber hood over the vent, a chute, yellow crust heaps, baskets. */
const sulfurWorks: PieceFactory = (scene, b) => {
  const { box, cyl, rock } = KIT;
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.05, 0.7, 0.05, x + sx * 0.3, F + 0.35, z + sz * 0.3, PALETTE.wood));
  parts.push(cyl(scene, 0.8, 0.3, x, F + 0.8, z, PALETTE.planks, 4, 0.2));
  parts.push(cyl(scene, 0.14, 0.5, x, F + 1.15, z, BASALT, 5));
  for (const [dx, dz, s] of [[-0.25, 0.25, 0.3], [0.2, -0.25, 0.26], [0.3, 0.25, 0.2]] as [number, number, number][]) parts.push(rock(scene, x + dx, F + 0.05, z + dz, s, SULFUR, dx * 10));
  parts.push(cyl(scene, 0.2, 0.16, x - 0.3, F + 0.08, z - 0.3, "#b9a377", 6, 0.17));
  return { root: mergeFlat("sulfurWorks", parts, scene) };
};

/** Hot-spring bathhouse: two stone-rimmed pools of warm water under a timber pavilion; the steam is the effects layer's. */
const hotSpring: PieceFactory = (scene, b) => {
  const { box, cyl, deck, hip, bounds } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  for (const [dx, dia] of [[-0.45, 0.85], [0.35, 0.65]] as [number, number][]) {
    parts.push(cyl(scene, dia, 0.16, cx + dx, F + 0.08, cz + 0.05, ROCK, 9));
    parts.push(cyl(scene, dia - 0.14, 0.03, cx + dx, F + 0.16, cz + 0.05, TEAL, 9));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.06, 0.8, 0.06, cx + sx * (w / 2 - 0.12), F + 0.4, cz + sz * (d / 2 - 0.12), PALETTE.wood));
  hip(scene, parts, cx, cz, w - 0.2, d - 0.2, F + 0.8, 0.3, PALETTE.roofs[0], 0.12);
  parts.push(box(scene, 0.5, 0.04, 0.18, cx + w / 2 - 0.35, F + 0.2, cz - d / 2 + 0.15, PALETTE.planks)); // a bench
  return { root: mergeFlat("hotSpring", parts, scene) };
};

export const CINDER_PIECES: Partial<Record<BuildingKind, PieceFactory>> = { taroTerrace, cocoaTerrace, glassworks, sulfurWorks, hotSpring };
export const CINDER_HOMES = { basalt: basaltHome } as const;
