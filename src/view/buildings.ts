// Mesh factories for every building kind. Each building merges to one mesh; homes add a lantern that is lit while
// the home is reached. View only: nothing here changes a number in the sim.
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { STILT_SINK } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellCenter } from "../sim/grid";
import { terrainHeight } from "../sim/heightfield";
import { Building, Cell } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";

export const PALETTE = {
  walls: ["#f2ece0", "#f4d9c6", "#d5e6ea", "#ece3c3", "#f7e7d3"],
  roofs: ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"],
  wood: "#5a4636",
  planks: "#8a6f52",
  lantern: "#ffb859",
  lanternDark: "#3a2a1a",
  sail: "#f7f3e8",
  hulls: ["#f2ece0", "#4c5a66", "#c9674f", "#2f6f8f"],
};

export interface BuildingMeshes {
  root: Mesh;
  lantern?: Mesh;
}

const lanternMats = new WeakMap<Scene, { lit: StandardMaterial; dark: StandardMaterial }>();
export function lanternMaterials(scene: Scene): { lit: StandardMaterial; dark: StandardMaterial } {
  let m = lanternMats.get(scene);
  if (!m) {
    const lit = new StandardMaterial("lanternLit", scene);
    lit.diffuseColor = Color3.FromHexString(PALETTE.lantern);
    lit.emissiveColor = Color3.FromHexString(PALETTE.lantern).scale(0.9);
    lit.specularColor = Color3.Black();
    const dark = new StandardMaterial("lanternDark", scene);
    dark.diffuseColor = Color3.FromHexString(PALETTE.lanternDark);
    dark.specularColor = new Color3(0.03, 0.03, 0.03);
    m = { lit, dark };
    lanternMats.set(scene, m);
  }
  return m;
}

function stilt(scene: Scene, x: number, z: number, topY: number, diameter: number, tessellation: number): Mesh {
  const gh = terrainHeight(x, z) - STILT_SINK;
  const h = topY - gh;
  const m = MeshBuilder.CreateCylinder("stilt", { diameter, height: h, tessellation }, scene);
  m.position.set(x, gh + h / 2, z);
  return tint(m, PALETTE.wood);
}

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number, hex: string): Mesh {
  const m = MeshBuilder.CreateBox("box", { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  return tint(m, hex);
}

function pyramid(scene: Scene, diameter: number, height: number, x: number, y: number, z: number, hex: string): Mesh {
  const m = MeshBuilder.CreateCylinder("roof", { diameterTop: 0, diameterBottom: diameter, height, tessellation: 4 }, scene);
  m.rotation.y = Math.PI / 4;
  m.position.set(x, y, z);
  return tint(m, hex);
}

/** Centre and extents of a footprint. */
function bounds(cells: Cell[]): { cx: number; cz: number; w: number; d: number } {
  const is = cells.map(c => c.i), js = cells.map(c => c.j);
  const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
  return { cx: (minI + maxI + 1) / 2, cz: (minJ + maxJ + 1) / 2, w: maxI - minI + 1, d: maxJ - minJ + 1 };
}

/** Deck with a stilt near each corner; the base of every building. */
function deck(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, d: number, F: number, inset = 0.12): void {
  parts.push(box(scene, w - 0.02, 0.08, d - 0.02, cx, F - 0.04, cz, PALETTE.planks));
  const hx = w / 2 - inset, hz = d / 2 - inset;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, cx + sx * hx, cz + sz * hz, F - 0.08, 0.12, 6));
  if (w >= 2) for (const sz of [-1, 1]) parts.push(stilt(scene, cx, cz + sz * hz, F - 0.08, 0.12, 6));
  if (d >= 2) for (const sx of [-1, 1]) parts.push(stilt(scene, cx + sx * hx, cz, F - 0.08, 0.12, 6));
}

function lantern(scene: Scene, x: number, z: number, F: number): Mesh {
  const m = MeshBuilder.CreateSphere("lantern", { diameter: 0.14, segments: 5 }, scene);
  m.position.set(x, F + 0.76, z);
  m.material = lanternMaterials(scene).dark;
  m.isPickable = false;
  return m;
}

function home(scene: Scene, b: Building, bodyW: number, bodyH: number): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, bodyW, bodyH, bodyW, cx, F + bodyH / 2, cz, PALETTE.walls[b.id % PALETTE.walls.length]));
  parts.push(pyramid(scene, bodyW * 1.62, bodyH * 0.6, cx, F + bodyH + bodyH * 0.3, cz, PALETTE.roofs[b.id % PALETTE.roofs.length]));
  const post = MeshBuilder.CreateCylinder("post", { diameter: 0.05, height: 0.7, tessellation: 5 }, scene);
  post.position.set(cx + w / 2 - 0.08, F + 0.35, cz - d / 2 + 0.08);
  parts.push(tint(post, PALETTE.wood));
  return { root: mergeFlat(b.kind, parts, scene), lantern: lantern(scene, cx + w / 2 - 0.08, cz - d / 2 + 0.08, F) };
}

function walkway(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, 0.96, 0.07, 0.96, x, F - 0.035, z, PALETTE.planks)];
  parts.push(stilt(scene, x - 0.3, z - 0.3, F - 0.07, 0.09, 5));
  parts.push(stilt(scene, x + 0.3, z + 0.3, F - 0.07, 0.09, 5));
  return { root: mergeFlat("walkway", parts, scene) };
}

function pier(scene: Scene, b: Building): BuildingMeshes {
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  const cx = (a.x + s.x) / 2, cz = (a.z + s.z) / 2;
  const alongX = a.z === s.z;
  const len = b.cells.length;
  const F = b.floorY;
  const at = (along: number, across: number) => alongX ? { x: cx + along, z: cz + across } : { x: cx + across, z: cz + along };
  const parts: Mesh[] = [box(scene, alongX ? len - 0.02 : 0.86, 0.1, alongX ? 0.86 : len - 0.02, cx, F - 0.05, cz, PALETTE.planks)];
  for (let k = 0; k < len; k++) for (const across of [-0.3, 0.3]) {
    const p = at(-len / 2 + 0.5 + k, across);
    parts.push(stilt(scene, p.x, p.z, F - 0.1, 0.16, 6));
  }
  const seaward = Math.sign((alongX ? s.x - a.x : s.z - a.z)) * (len / 2 - 0.2);
  for (const across of [-0.28, 0.28]) {
    const p = at(seaward, across);
    const bollard = MeshBuilder.CreateCylinder("bollard", { diameter: 0.12, height: 0.3, tessellation: 5 }, scene);
    bollard.position.set(p.x, F + 0.15, p.z);
    parts.push(tint(bollard, PALETTE.wood));
  }
  return { root: mergeFlat("pier", parts, scene) };
}

function market(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  // Open hall: four posts, a wide low roof, a counter along the front.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = MeshBuilder.CreateCylinder("post", { diameter: 0.1, height: 0.9, tessellation: 5 }, scene);
    p.position.set(cx + sx * 0.7, F + 0.45, cz + sz * 0.7);
    parts.push(tint(p, PALETTE.wood));
  }
  parts.push(box(scene, 1.1, 0.5, 0.5, cx, F + 0.25, cz - 0.55, PALETTE.walls[1]));
  parts.push(box(scene, 0.5, 0.5, 1.0, cx + 0.6, F + 0.25, cz + 0.2, PALETTE.walls[3]));
  parts.push(pyramid(scene, 2.9, 0.7, cx, F + 0.9 + 0.35, cz, PALETTE.roofs[1]));
  return { root: mergeFlat("market", parts, scene) };
}

export function createBuildingMeshes(scene: Scene, b: Building): BuildingMeshes {
  switch (b.kind) {
    case "hut": return home(scene, b, 0.66, 0.62);
    case "house": return home(scene, b, 0.8, 0.9);
    case "walkway": return walkway(scene, b);
    case "pier": return pier(scene, b);
    case "market": return market(scene, b);
  }
}

export function footprintOf(kind: Building["kind"]): { w: number; d: number } {
  return { w: BUILDINGS[kind].w, d: BUILDINGS[kind].d };
}
