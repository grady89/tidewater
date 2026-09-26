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

/** Deck with a stilt near each corner; the base of every building. Buildings on the ground get no stilts. */
function deck(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, d: number, F: number, inset = 0.12): void {
  parts.push(box(scene, w - 0.02, 0.08, d - 0.02, cx, F - 0.04, cz, PALETTE.planks));
  const hx = w / 2 - inset, hz = d / 2 - inset;
  if (F - terrainHeight(cx, cz) < 0.2) return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, cx + sx * hx, cz + sz * hz, F - 0.08, 0.12, 6));
  if (w >= 2) for (const sz of [-1, 1]) parts.push(stilt(scene, cx, cz + sz * hz, F - 0.08, 0.12, 6));
  if (d >= 2) for (const sx of [-1, 1]) parts.push(stilt(scene, cx + sx * hx, cz, F - 0.08, 0.12, 6));
}

/** A closed shed with a pyramid roof, the workhorse of the production buildings. */
function shed(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, h: number, d: number, F: number, wall: string, roof: string): void {
  parts.push(box(scene, w, h, d, cx, F + h / 2, cz, wall));
  parts.push(pyramid(scene, Math.max(w, d) * 1.55, h * 0.45, cx, F + h + h * 0.225, cz, roof));
}

function logPile(scene: Scene, parts: Mesh[], x: number, y: number, z: number, alongX: boolean): void {
  for (const [dx, dy] of [[-0.14, 0], [0.14, 0], [0, 0.13]]) {
    const log = MeshBuilder.CreateCylinder("log", { diameter: 0.16, height: 0.7, tessellation: 5 }, scene);
    if (alongX) log.rotation.z = Math.PI / 2; else log.rotation.x = Math.PI / 2;
    log.position.set(x + (alongX ? 0 : dx), y + dy + 0.08, z + (alongX ? dx : 0));
    parts.push(tint(log, PALETTE.wood));
  }
}

function lantern(scene: Scene, x: number, z: number, F: number): Mesh {
  const m = MeshBuilder.CreateSphere("lantern", { diameter: 0.14, segments: 5 }, scene);
  m.position.set(x, F + 0.76, z);
  m.material = lanternMaterials(scene).dark;
  m.isPickable = false;
  return m;
}

/** Roof colour by level: any of the palette at level 1, slate at 2, the deep blue-grey at 3. */
function roofFor(b: Building): string {
  if (b.level >= 3) return PALETTE.roofs[3];
  if (b.level === 2) return PALETTE.roofs[1];
  return PALETTE.roofs[b.id % PALETTE.roofs.length];
}

function home(scene: Scene, b: Building, bodyW: number, baseH: number): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const bodyH = baseH + 0.18 * (b.level - 1);
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, bodyW, bodyH, bodyW, cx, F + bodyH / 2, cz, PALETTE.walls[b.id % PALETTE.walls.length]));
  if (b.level >= 2) parts.push(box(scene, bodyW * 0.35, 0.22, 0.06, cx, F + bodyH * 0.6, cz - bodyW / 2 - 0.02, PALETTE.wood)); // a window box
  if (b.level >= 3) parts.push(box(scene, 0.14, 0.4, 0.14, cx + bodyW * 0.3, F + bodyH + bodyH * 0.3, cz + bodyW * 0.2, "#8d8a83")); // a chimney
  parts.push(pyramid(scene, bodyW * 1.62, bodyH * 0.6, cx, F + bodyH + bodyH * 0.3, cz, roofFor(b)));
  const post = MeshBuilder.CreateCylinder("post", { diameter: 0.05, height: 0.7, tessellation: 5 }, scene);
  post.position.set(cx + w / 2 - 0.08, F + 0.35, cz - d / 2 + 0.08);
  parts.push(tint(post, PALETTE.wood));
  return { root: mergeFlat(b.kind, parts, scene), lantern: lantern(scene, cx + w / 2 - 0.08, cz - d / 2 + 0.08, F) };
}

/** A lantern post in the corner of a walkway cell; the lamp is a separate mesh so it can light at dusk. */
function lanternPost(scene: Scene, parts: Mesh[], x: number, z: number, F: number): Mesh {
  const post = MeshBuilder.CreateCylinder("post", { diameter: 0.06, height: 0.9, tessellation: 5 }, scene);
  post.position.set(x + 0.36, F + 0.45, z + 0.36);
  parts.push(tint(post, PALETTE.wood));
  parts.push(box(scene, 0.16, 0.03, 0.16, x + 0.36, F + 0.9, z + 0.36, PALETTE.wood));
  return lantern(scene, x + 0.36, z + 0.36, F + 0.02);
}

function walkway(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, 0.96, 0.07, 0.96, x, F - 0.035, z, PALETTE.planks)];
  parts.push(stilt(scene, x - 0.3, z - 0.3, F - 0.07, 0.09, 5));
  parts.push(stilt(scene, x + 0.3, z + 0.3, F - 0.07, 0.09, 5));
  const lamp = b.lantern ? lanternPost(scene, parts, x, z, F) : undefined;
  return { root: mergeFlat("walkway", parts, scene), lantern: lamp };
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

function raisedWalkway(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, 0.96, 0.07, 0.96, x, F - 0.035, z, PALETTE.planks)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, x + sx * 0.36, z + sz * 0.36, F - 0.07, 0.1, 5));
  // Cross-brace so the tall stilts read as a trestle.
  parts.push(box(scene, 0.8, 0.05, 0.05, x, F - 0.45, z - 0.36, PALETTE.wood));
  parts.push(box(scene, 0.8, 0.05, 0.05, x, F - 0.45, z + 0.36, PALETTE.wood));
  const lamp = b.lantern ? lanternPost(scene, parts, x, z, F) : undefined;
  return { root: mergeFlat("raisedWalkway", parts, scene), lantern: lamp };
}

function dock(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, w - 0.02, 0.12, d - 0.02, cx, F - 0.06, cz, PALETTE.planks)];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    if (sx === 0 && sz === 0) continue;
    parts.push(stilt(scene, cx + sx * (w / 2 - 0.15), cz + sz * (d / 2 - 0.15), F - 0.12, 0.2, 6));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bollard = MeshBuilder.CreateCylinder("bollard", { diameter: 0.14, height: 0.32, tessellation: 5 }, scene);
    bollard.position.set(cx + sx * (w / 2 - 0.2), F + 0.16, cz + sz * (d / 2 - 0.2));
    parts.push(tint(bollard, PALETTE.wood));
  }
  // A small crane post.
  parts.push(box(scene, 0.12, 1.1, 0.12, cx, F + 0.55, cz, PALETTE.wood));
  parts.push(box(scene, 0.9, 0.08, 0.08, cx + 0.35, F + 1.05, cz, PALETTE.wood));
  return { root: mergeFlat("dock", parts, scene) };
}

function oysterBed(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  // Three low racks on thin posts, the kind that stand in the shallows.
  for (const dz of [-0.3, 0, 0.3]) {
    parts.push(box(scene, 0.86, 0.05, 0.16, x, F - 0.2, z + dz, PALETTE.wood));
    for (const sx of [-1, 1]) parts.push(stilt(scene, x + sx * 0.38, z + dz, F - 0.2, 0.05, 4));
  }
  return { root: mergeFlat("oysterBed", parts, scene) };
}

function clamCamp(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  // A shed on the first cell, baskets on the second.
  parts.push(box(scene, 0.7, 0.6, 0.7, a.x, F + 0.3, a.z, PALETTE.walls[3]));
  parts.push(pyramid(scene, 1.15, 0.4, a.x, F + 0.6 + 0.2, a.z, PALETTE.roofs[2]));
  for (const [dx, dz] of [[-0.25, -0.2], [0.2, 0.15], [-0.1, 0.3]]) {
    const basket = MeshBuilder.CreateCylinder("basket", { diameter: 0.28, height: 0.22, tessellation: 6 }, scene);
    basket.position.set(s.x + dx, F + 0.11, s.z + dz);
    parts.push(tint(basket, PALETTE.planks));
  }
  return { root: mergeFlat("clamCamp", parts, scene) };
}

function lumberCamp(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  shed(scene, parts, a.x, a.z, 0.72, 0.55, 0.72, F, PALETTE.walls[3], PALETTE.roofs[3]);
  logPile(scene, parts, s.x, F, s.z, a.z === s.z);
  // A stump-chopping block.
  const block = MeshBuilder.CreateCylinder("block", { diameter: 0.26, height: 0.22, tessellation: 6 }, scene);
  block.position.set(s.x - 0.3 * Math.sign(s.x - a.x || 1), F + 0.11, s.z + 0.3);
  parts.push(tint(block, PALETTE.wood));
  return { root: mergeFlat("lumberCamp", parts, scene) };
}

function sawmill(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx - 0.2, cz, 1.3, 1.0, 1.2, F, PALETTE.walls[2], PALETTE.roofs[1]);
  // The blade, standing on edge at the open side.
  const blade = MeshBuilder.CreateCylinder("blade", { diameter: 0.55, height: 0.04, tessellation: 8 }, scene);
  blade.rotation.x = Math.PI / 2;
  blade.position.set(cx + 0.62, F + 0.4, cz - 0.3);
  parts.push(tint(blade, "#8d8a83"));
  logPile(scene, parts, cx + 0.55, F, cz + 0.45, true);
  return { root: mergeFlat("sawmill", parts, scene) };
}

function smokehouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx, cz, 1.5, 0.8, 0.72, F, PALETTE.roofs[1], PALETTE.roofs[2]);
  parts.push(box(scene, 0.18, 0.5, 0.18, cx + 0.45, F + 0.8 + 0.25, cz, "#8d8a83"));
  return { root: mergeFlat("smokehouse", parts, scene) };
}

function netLoft(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  shed(scene, parts, x - 0.15, z, 0.5, 0.55, 0.6, F, PALETTE.walls[4], PALETTE.roofs[0]);
  // Drying rack with a net slung over it.
  for (const dz of [-0.3, 0.3]) parts.push(box(scene, 0.05, 0.7, 0.05, x + 0.35, F + 0.35, z + dz, PALETTE.wood));
  parts.push(box(scene, 0.03, 0.03, 0.65, x + 0.35, F + 0.68, z, PALETTE.wood));
  parts.push(box(scene, 0.02, 0.4, 0.5, x + 0.36, F + 0.45, z, PALETTE.sail));
  return { root: mergeFlat("netLoft", parts, scene) };
}

function warehouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.8, 1.0, 1.5, cx, F + 0.5, cz, PALETTE.walls[0]));
  parts.push(pyramid(scene, 2.9, 0.6, cx, F + 1.0 + 0.3, cz, PALETTE.roofs[3]));
  parts.push(box(scene, 0.5, 0.6, 0.06, cx, F + 0.3, cz - 0.76, PALETTE.wood));
  return { root: mergeFlat("warehouse", parts, scene) };
}

function shipyard(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, w - 0.02, 0.12, d - 0.02, cx, F - 0.06, cz, PALETTE.planks)];
  for (let sx = -1; sx <= 1; sx++) for (const sz of [-1, 1]) parts.push(stilt(scene, cx + sx * (w / 2 - 0.2), cz + sz * (d / 2 - 0.15), F - 0.12, 0.18, 6));
  // A hull under construction: keel and ribs on blocks.
  const alongX = w >= d;
  const keel = MeshBuilder.CreateBox("keel", { width: alongX ? 1.4 : 0.1, height: 0.1, depth: alongX ? 0.1 : 1.4 }, scene);
  keel.position.set(cx, F + 0.3, cz);
  parts.push(tint(keel, PALETTE.wood));
  for (let k = -2; k <= 2; k++) {
    const rib = MeshBuilder.CreateBox("rib", { width: alongX ? 0.06 : 0.5, height: 0.35, depth: alongX ? 0.5 : 0.06 }, scene);
    rib.position.set(cx + (alongX ? k * 0.3 : 0), F + 0.42, cz + (alongX ? 0 : k * 0.3));
    parts.push(tint(rib, PALETTE.hulls[0]));
  }
  shed(scene, parts, cx + (alongX ? 0 : 0.7), cz + (alongX ? 0.7 : 0), 0.8, 0.7, 0.55, F, PALETTE.walls[1], PALETTE.roofs[1]);
  parts.push(box(scene, 0.1, 1.3, 0.1, cx - (alongX ? 1.0 : 0), F + 0.65, cz - (alongX ? 0 : 1.0), PALETTE.wood));
  parts.push(box(scene, alongX ? 0.9 : 0.08, 0.08, alongX ? 0.08 : 0.9, cx - (alongX ? 0.6 : 0), F + 1.25, cz - (alongX ? 0 : 0.6), PALETTE.wood));
  return { root: mergeFlat("shipyard", parts, scene) };
}

function well(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  const ring = MeshBuilder.CreateCylinder("ring", { diameter: 0.5, height: 0.4, tessellation: 8 }, scene);
  ring.position.set(x, F + 0.2, z);
  parts.push(tint(ring, "#8d8a83"));
  for (const sx of [-1, 1]) parts.push(box(scene, 0.05, 0.8, 0.05, x + sx * 0.22, F + 0.4, z, PALETTE.wood));
  parts.push(pyramid(scene, 0.8, 0.3, x, F + 0.8 + 0.15, z, PALETTE.roofs[0]));
  return { root: mergeFlat("well", parts, scene) };
}

function bathhouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx, cz, 1.5, 0.75, 0.72, F, PALETTE.walls[2], PALETTE.roofs[3]);
  // Steam vent and a tub out front.
  parts.push(box(scene, 0.12, 0.3, 0.12, cx - 0.4, F + 0.75 + 0.15, cz, "#8d8a83"));
  const tub = MeshBuilder.CreateCylinder("tub", { diameter: 0.42, height: 0.2, tessellation: 8 }, scene);
  tub.position.set(cx + 0.55, F + 0.1, cz + 0.5);
  parts.push(tint(tub, PALETTE.wood));
  return { root: mergeFlat("bathhouse", parts, scene) };
}

function tavern(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx - 0.2, cz, 1.2, 0.95, 0.75, F, PALETTE.walls[1], PALETTE.roofs[2]);
  // Sign post and a barrel.
  parts.push(box(scene, 0.05, 0.9, 0.05, cx + 0.75, F + 0.45, cz - 0.3, PALETTE.wood));
  parts.push(box(scene, 0.3, 0.2, 0.04, cx + 0.75, F + 0.8, cz - 0.3, PALETTE.roofs[0]));
  const barrel = MeshBuilder.CreateCylinder("barrel", { diameter: 0.26, height: 0.32, tessellation: 7 }, scene);
  barrel.position.set(cx + 0.65, F + 0.16, cz + 0.3);
  parts.push(tint(barrel, PALETTE.wood));
  return { root: mergeFlat("tavern", parts, scene), lantern: lantern(scene, cx + 0.75, cz - 0.3, F + 0.2) };
}

function shrine(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.07, 0.7, 0.07, x + sx * 0.25, F + 0.35, z + sz * 0.25, PALETTE.roofs[0]));
  parts.push(pyramid(scene, 0.95, 0.35, x, F + 0.7 + 0.17, z, PALETTE.roofs[0]));
  parts.push(box(scene, 0.3, 0.3, 0.3, x, F + 0.15, z, "#8d8a83"));
  return { root: mergeFlat("shrine", parts, scene), lantern: lantern(scene, x + 0.38, z - 0.38, F) };
}

function marketSquare(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  // Stalls with awnings around a little basin.
  for (const [dx, dz, c] of [[-0.6, -0.6, 0], [0.6, -0.6, 2], [-0.6, 0.6, 3]] as [number, number, number][]) {
    parts.push(box(scene, 0.5, 0.35, 0.4, cx + dx, F + 0.18, cz + dz, PALETTE.walls[c]));
    parts.push(box(scene, 0.62, 0.04, 0.52, cx + dx, F + 0.5, cz + dz, PALETTE.roofs[c]));
    for (const sx of [-1, 1]) parts.push(box(scene, 0.04, 0.5, 0.04, cx + dx + sx * 0.28, F + 0.25, cz + dz + 0.24, PALETTE.wood));
  }
  const basin = MeshBuilder.CreateCylinder("basin", { diameter: 0.5, height: 0.14, tessellation: 8 }, scene);
  basin.position.set(cx + 0.5, F + 0.07, cz + 0.5);
  parts.push(tint(basin, "#8d8a83"));
  return { root: mergeFlat("marketSquare", parts, scene) };
}

function outfall(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  // A pipe on two piles, open end to the sea, with a small valve house on the platform.
  parts.push(box(scene, 0.8, 0.08, 0.5, x, F - 0.04, z, PALETTE.planks));
  for (const sz of [-1, 1]) parts.push(stilt(scene, x, z + sz * 0.18, F - 0.08, 0.14, 6));
  const pipe = MeshBuilder.CreateCylinder("pipe", { diameter: 0.26, height: 1.4, tessellation: 8 }, scene);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(x, F - 0.35, z);
  parts.push(tint(pipe, "#8d8a83"));
  parts.push(box(scene, 0.3, 0.3, 0.3, x, F + 0.15, z, PALETTE.walls[2]));
  return { root: mergeFlat("outfall", parts, scene) };
}

function treatmentPlant(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx - 0.5, cz - 0.45, 0.8, 0.7, 0.8, F, PALETTE.walls[2], PALETTE.roofs[3]);
  for (const [dx, dz] of [[0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]) {
    const tank = MeshBuilder.CreateCylinder("tank", { diameter: 0.7, height: 0.5, tessellation: 8 }, scene);
    tank.position.set(cx + dx, F + 0.25, cz + dz);
    parts.push(tint(tank, "#8d8a83"));
    const water = MeshBuilder.CreateCylinder("tankWater", { diameter: 0.6, height: 0.04, tessellation: 8 }, scene);
    water.position.set(cx + dx, F + 0.49, cz + dz);
    parts.push(tint(water, "#2f6f8f"));
  }
  return { root: mergeFlat("treatmentPlant", parts, scene) };
}

export function createBuildingMeshes(scene: Scene, b: Building): BuildingMeshes {
  switch (b.kind) {
    case "outfall": return outfall(scene, b);
    case "treatmentPlant": return treatmentPlant(scene, b);
    case "well": return well(scene, b);
    case "bathhouse": return bathhouse(scene, b);
    case "tavern": return tavern(scene, b);
    case "shrine": return shrine(scene, b);
    case "marketSquare": return marketSquare(scene, b);
    case "hut": return home(scene, b, 0.66, 0.62);
    case "house": return home(scene, b, 0.8, 0.9);
    case "tallHouse": return home(scene, b, 0.8, 1.5);
    case "walkway": return walkway(scene, b);
    case "raisedWalkway": return raisedWalkway(scene, b);
    case "pier": return pier(scene, b);
    case "dock": return dock(scene, b);
    case "shipyard": return shipyard(scene, b);
    case "market": return market(scene, b);
    case "oysterBed": return oysterBed(scene, b);
    case "clamCamp": return clamCamp(scene, b);
    case "lumberCamp": return lumberCamp(scene, b);
    case "sawmill": return sawmill(scene, b);
    case "smokehouse": return smokehouse(scene, b);
    case "netLoft": return netLoft(scene, b);
    case "warehouse": return warehouse(scene, b);
  }
}

export function footprintOf(kind: Building["kind"]): { w: number; d: number } {
  return { w: BUILDINGS[kind].w, d: BUILDINGS[kind].d };
}

/** Everything about a building that changes its mesh; the view rebuilds when this changes. */
export function meshSignature(b: Building): string {
  return `${b.kind}:${b.level}:${b.lantern ? 1 : 0}`;
}

/** Whether the building's lantern should glow: homes need residents, everything else just a connection. */
export function lanternOn(b: Building): boolean {
  return b.reached && !b.cut && (BUILDINGS[b.kind].residents === 0 || b.residents > 0);
}
