// Mesh factories for the placeable pieces. Each piece merges to one mesh; houses add a lantern that is lit while
// the house is reached. View only: nothing here changes a number in the sim.
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { HOUSE_FLOOR, PIER_FLOOR, STILT_SINK, WALKWAY_FLOOR } from "../config";
import { cellCenter } from "../sim/grid";
import { terrainHeight } from "../sim/heightfield";
import { Cell } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";

export const PALETTE = {
  walls: ["#f2ece0", "#f4d9c6", "#d5e6ea", "#ece3c3", "#f7e7d3"],
  roofs: ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"],
  wood: "#5a4636",
  planks: "#8a6f52",
  lantern: "#ffb859",
  lanternDark: "#3a2a1a",
};

export interface PieceMeshes {
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

export function createHouse(scene: Scene, cell: Cell, variant: number): PieceMeshes {
  const { x, z } = cellCenter(cell);
  const F = HOUSE_FLOOR;
  const parts: Mesh[] = [];
  parts.push(box(scene, 0.8, 0.9, 0.8, x, F + 0.45, z, PALETTE.walls[variant % PALETTE.walls.length]));
  const roof = MeshBuilder.CreateCylinder("roof", { diameterTop: 0, diameterBottom: 1.3, height: 0.55, tessellation: 4 }, scene);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(x, F + 0.9 + 0.275, z);
  parts.push(tint(roof, PALETTE.roofs[variant % PALETTE.roofs.length]));
  parts.push(box(scene, 0.98, 0.08, 0.98, x, F - 0.04, z, PALETTE.planks));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, x + sx * 0.38, z + sz * 0.38, F - 0.08, 0.12, 6));
  const post = MeshBuilder.CreateCylinder("post", { diameter: 0.05, height: 0.7, tessellation: 5 }, scene);
  post.position.set(x + 0.42, F + 0.35, z - 0.42);
  parts.push(tint(post, PALETTE.wood));
  const root = mergeFlat("house", parts, scene);

  const lantern = MeshBuilder.CreateSphere("lantern", { diameter: 0.14, segments: 5 }, scene);
  lantern.position.set(x + 0.42, F + 0.76, z - 0.42);
  lantern.material = lanternMaterials(scene).dark;
  lantern.isPickable = false;
  return { root, lantern };
}

export function createWalkway(scene: Scene, cell: Cell): PieceMeshes {
  const { x, z } = cellCenter(cell);
  const F = WALKWAY_FLOOR;
  const parts: Mesh[] = [box(scene, 0.96, 0.07, 0.96, x, F - 0.035, z, PALETTE.planks)];
  parts.push(stilt(scene, x - 0.3, z - 0.3, F - 0.07, 0.09, 5));
  parts.push(stilt(scene, x + 0.3, z + 0.3, F - 0.07, 0.09, 5));
  return { root: mergeFlat("walkway", parts, scene) };
}

export function createPier(scene: Scene, cells: Cell[]): PieceMeshes {
  const a = cellCenter(cells[0]), b = cellCenter(cells[1]);
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const alongX = a.z === b.z;
  const F = PIER_FLOOR;
  const at = (along: number, across: number) => alongX ? { x: cx + along, z: cz + across } : { x: cx + across, z: cz + along };
  const parts: Mesh[] = [box(scene, alongX ? 1.98 : 0.86, 0.1, alongX ? 0.86 : 1.98, cx, F - 0.05, cz, PALETTE.planks)];
  for (const along of [-0.75, 0, 0.75]) for (const across of [-0.3, 0.3]) {
    const p = at(along, across);
    parts.push(stilt(scene, p.x, p.z, F - 0.1, 0.16, 6));
  }
  // Bollards at the seaward end.
  const seaward = Math.sign((alongX ? b.x - a.x : b.z - a.z)) * 0.8;
  for (const across of [-0.28, 0.28]) {
    const p = at(seaward, across);
    const bollard = MeshBuilder.CreateCylinder("bollard", { diameter: 0.12, height: 0.3, tessellation: 5 }, scene);
    bollard.position.set(p.x, F + 0.15, p.z);
    parts.push(tint(bollard, PALETTE.wood));
  }
  return { root: mergeFlat("pier", parts, scene) };
}
