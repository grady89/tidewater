// Mesh factories for every building kind, built after the sheets in reference/ (Grady's Midjourney refs): pale
// plank walls, red-tile or slate roofs with an overhang and a ridge cap, blue doors and shutters, many thin
// stilts with rails, hanging lanterns on bracket arms, crates and barrels on the decks. Everything is boxes,
// cylinders, cones and polyhedra, tinted per vertex and merged to one mesh per building; homes add a lantern
// sphere that is lit while the home is reached. View only: nothing here changes a number in the sim.
import { Axis, Color3, Matrix, Mesh, MeshBuilder, Scene, Space, StandardMaterial, Vector3, VertexBuffer } from "@babylonjs/core";
import { STILT_SINK } from "../config";
import { BUILDINGS, mayTurn, STREET_STEP_MAX } from "../sim/balance";
import { cellCenter, DIRS, Grid } from "../sim/grid";
import { ground } from "./ground";
import { roofFor, roofShape, setRoofPalette } from "./roofs";
import { BiomeLook, HouseKit } from "./biomes";
import { COAST_HOMES, COAST_PIECES } from "./pieces";
import { Building, Cell } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";

// The palette is mutable in two fields: applyPalette swaps the walls and roofs (and the accents below) for the
// island's biome look; every factory reads it at build time, and the chunks are rebuilt when the island changes.
export const PALETTE = {
  walls: ["#f2ece0", "#f4d9c6", "#d5e6ea", "#ece3c3", "#f7e7d3"] as readonly string[],
  roofs: ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"] as readonly string[],
  wood: "#5a4636",
  planks: "#8a6f52",
  lantern: "#ffb859",
  lanternDark: "#3a2a1a",
  sail: "#f7f3e8",
  hulls: ["#f2ece0", "#4c5a66", "#c9674f", "#2f6f8f"],
};
/** Accents the reference sheets lean on: the blue of doors and shutters, pale stone, dark window glass. */
let BLUE = "#2f6f8f";
let TRIM = "#e6dccb";
let HOUSE_KIT: HouseKit = "cottage";
/** The biome look's walls, roofs and accents become the palette every factory builds from. */
export function applyPalette(look: BiomeLook): void {
  PALETTE.walls = look.walls;
  PALETTE.roofs = look.roofs;
  BLUE = look.accents.door;
  TRIM = look.accents.trim;
  HOUSE_KIT = look.house;
  setRoofPalette(look.roofs, look.roofShapeFor);
}
const STONE = "#8d8a83";
const STONE_LIGHT = "#b9b6ae"; // new hex: dry quay stone (noted in NOTES)
const GLASS = "#2b3a45";      // new hex: window glass
const ROPE = "#b9a377";

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

// ---------- primitives ----------

function stilt(scene: Scene, x: number, z: number, topY: number, diameter: number, tessellation: number, hex = PALETTE.wood): Mesh {
  const gh = ground(x, z) - STILT_SINK;
  const h = Math.max(0.05, topY - gh);
  const m = MeshBuilder.CreateCylinder("stilt", { diameter, height: h, tessellation }, scene);
  m.position.set(x, gh + h / 2, z);
  return tint(m, hex);
}

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number, hex: string): Mesh {
  const m = MeshBuilder.CreateBox("box", { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  return tint(m, hex);
}

function cyl(scene: Scene, diameter: number, height: number, x: number, y: number, z: number, hex: string, tessellation = 6, diameterTop = diameter): Mesh {
  const m = MeshBuilder.CreateCylinder("cyl", { diameterTop, diameterBottom: diameter, height, tessellation }, scene);
  m.position.set(x, y, z);
  return tint(m, hex);
}

function pyramid(scene: Scene, diameter: number, height: number, x: number, y: number, z: number, hex: string): Mesh {
  const m = MeshBuilder.CreateCylinder("roof", { diameterTop: 0, diameterBottom: diameter, height, tessellation: 4 }, scene);
  m.rotation.y = Math.PI / 4;
  m.position.set(x, y, z);
  return tint(m, hex);
}

/** A rock: a squashed icosahedron, turned so no two look alike. */
function rock(scene: Scene, x: number, y: number, z: number, s: number, hex: string, seed = 0): Mesh {
  const m = MeshBuilder.CreatePolyhedron("rock", { type: 1, size: s * 0.5 }, scene);
  m.scaling.set(1.2, 0.7, 1);
  m.rotation.set(seed * 0.7, seed * 1.3, seed * 0.4);
  m.position.set(x, y, z);
  return tint(m, hex);
}

/** Centre and extents of a footprint. */
/**
 * Centre and extent of a footprint. With the building's quarter turns, the extent is the *unturned* one: the
 * factory builds the piece as designed and `turn` swings it onto the cells.
 */
function bounds(cells: Cell[], rot = 0): { cx: number; cz: number; w: number; d: number } {
  const is = cells.map(c => c.i), js = cells.map(c => c.j);
  const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
  const w = maxI - minI + 1, d = maxJ - minJ + 1;
  return { cx: (minI + maxI + 1) / 2, cz: (minJ + maxJ + 1) / 2, w: rot % 2 ? d : w, d: rot % 2 ? w : d };
}

/** A gable roof: a 3-sided prism laid on its side, apex up, with a ridge beam. `along` is the ridge axis. */
function gable(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, d: number, baseY: number, rise: number, hex: string, alongX: boolean, overhang = 0.14): void {
  const len = (alongX ? w : d) + overhang * 2;
  const span = (alongX ? d : w) + overhang * 2;
  // A 3-sided cylinder of circumradius r has a flat base of width r√3 and an apex r·1.5 above the base. Its
  // first vertex sits on local +x, which the Z rotation turns upward; local x is therefore the rise and is
  // scaled to the height asked for (scaling is local, whatever order it is set in), local y is the length.
  const r = span / Math.sqrt(3);
  const k = rise / (r * 1.5);
  const m = MeshBuilder.CreateCylinder("gable", { diameter: r * 2, height: len, tessellation: 3 }, scene);
  m.scaling.set(k, 1, 1);
  m.rotate(Axis.Z, Math.PI / 2, Space.WORLD);
  if (!alongX) m.rotate(Axis.Y, Math.PI / 2, Space.WORLD);
  m.position.set(cx, baseY + (r / 2) * k, cz);
  parts.push(tint(m, hex));
  parts.push(box(scene, alongX ? len + 0.02 : 0.07, 0.05, alongX ? 0.07 : len + 0.02, cx, baseY + rise + 0.01, cz, PALETTE.wood));
}

/** A hipped roof: a four-sided frustum with a ridge cap, overhanging the walls. */
function hip(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, d: number, baseY: number, rise: number, hex: string, overhang = 0.14): void {
  const m = MeshBuilder.CreateCylinder("hip", { diameterTop: Math.min(w, d) * 0.45, diameterBottom: (Math.max(w, d) + overhang * 2) * 1.42, height: rise, tessellation: 4 }, scene);
  m.scaling.set(w >= d ? 1 : d / w, 1, w >= d ? d / w : 1);
  m.rotation.y = Math.PI / 4;
  m.position.set(cx, baseY + rise / 2, cz);
  parts.push(tint(m, hex));
  parts.push(box(scene, w >= d ? Math.min(w, d) * 0.5 : 0.07, 0.05, w >= d ? 0.07 : Math.min(w, d) * 0.5, cx, baseY + rise + 0.02, cz, PALETTE.wood));
}

/** A window: dark glass set into the wall, a sill, and (with `shutters`) a blue shutter either side. */
function window_(scene: Scene, parts: Mesh[], x: number, y: number, z: number, facingX: boolean, w = 0.16, h = 0.18, shutters = true): void {
  parts.push(box(scene, facingX ? 0.03 : w, h, facingX ? w : 0.03, x, y, z, GLASS));
  parts.push(box(scene, facingX ? 0.05 : w + 0.06, 0.03, facingX ? w + 0.06 : 0.05, x, y - h / 2 - 0.01, z, PALETTE.wood));
  if (shutters) for (const s of [-1, 1]) parts.push(box(scene, facingX ? 0.025 : 0.07, h, facingX ? 0.07 : 0.025, x + (facingX ? 0 : s * (w / 2 + 0.05)), y, z + (facingX ? s * (w / 2 + 0.05) : 0), BLUE));
}

/** A door: a blue panel proud of the wall with a lintel above. */
function door(scene: Scene, parts: Mesh[], x: number, y: number, z: number, facingX: boolean, w = 0.2, h = 0.34): void {
  parts.push(box(scene, facingX ? 0.03 : w, h, facingX ? w : 0.03, x, y + h / 2, z, BLUE));
  parts.push(box(scene, facingX ? 0.06 : w + 0.08, 0.04, facingX ? w + 0.08 : 0.06, x, y + h + 0.02, z, PALETTE.wood));
}

/** A railing along one edge: end posts, a couple in between, one top rail. */
function railing(scene: Scene, parts: Mesh[], x1: number, z1: number, x2: number, z2: number, y: number, h = 0.28): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(2, Math.round(len / 0.45) + 1);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    parts.push(box(scene, 0.04, h, 0.04, x1 + (x2 - x1) * t, y + h / 2, z1 + (z2 - z1) * t, PALETTE.wood));
  }
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  parts.push(box(scene, alongX ? len : 0.035, 0.035, alongX ? 0.035 : len, (x1 + x2) / 2, y + h, (z1 + z2) / 2, PALETTE.wood));
}

function chimney(scene: Scene, parts: Mesh[], x: number, y: number, z: number, h = 0.35, hex = STONE): void {
  parts.push(box(scene, 0.13, h, 0.13, x, y + h / 2, z, hex));
  parts.push(box(scene, 0.17, 0.04, 0.17, x, y + h + 0.02, z, PALETTE.wood));
}

function crate(scene: Scene, parts: Mesh[], x: number, y: number, z: number, s = 0.22): void {
  parts.push(box(scene, s, s, s, x, y + s / 2, z, ROPE));
  parts.push(box(scene, s + 0.02, 0.03, 0.03, x, y + s / 2, z, PALETTE.wood));
}

function barrel(scene: Scene, parts: Mesh[], x: number, y: number, z: number, s = 0.24): void {
  parts.push(cyl(scene, s, s * 1.3, x, y + s * 0.65, z, PALETTE.planks, 7));
  parts.push(cyl(scene, s * 1.04, 0.03, x, y + s * 0.3, z, PALETTE.wood, 7));
  parts.push(cyl(scene, s * 1.04, 0.03, x, y + s * 1.0, z, PALETTE.wood, 7));
}

function bollard(scene: Scene, parts: Mesh[], x: number, y: number, z: number, capHex: string | null = null): void {
  parts.push(cyl(scene, 0.13, 0.3, x, y + 0.15, z, capHex ? BLUE : PALETTE.wood, 6));
  if (capHex) parts.push(cyl(scene, 0.15, 0.08, x, y + 0.34, z, capHex, 6));
}

function lamp(scene: Scene, x: number, z: number, y: number): Mesh {
  const m = MeshBuilder.CreateSphere("lantern", { diameter: 0.13, segments: 5 }, scene);
  m.position.set(x, y, z);
  m.material = lanternMaterials(scene).dark;
  m.isPickable = false;
  return m;
}

/** A lantern hanging from a bracket arm off a wall or post: the frame is merged, the glow is the returned mesh. */
function bracketLantern(scene: Scene, parts: Mesh[], x: number, y: number, z: number, dirX: number, dirZ: number): Mesh {
  parts.push(box(scene, dirX ? 0.26 : 0.035, 0.035, dirZ ? 0.26 : 0.035, x + dirX * 0.13, y, z + dirZ * 0.13, PALETTE.wood));
  const lx = x + dirX * 0.26, lz = z + dirZ * 0.26;
  parts.push(box(scene, 0.03, 0.06, 0.03, lx, y - 0.04, lz, PALETTE.wood));
  parts.push(box(scene, 0.15, 0.03, 0.15, lx, y - 0.08, lz, PALETTE.wood));
  parts.push(box(scene, 0.15, 0.03, 0.15, lx, y - 0.25, lz, PALETTE.wood));
  return lamp(scene, lx, lz, y - 0.165);
}

/** A lantern on a tall post in a corner of a street cell. */
function postLantern(scene: Scene, parts: Mesh[], x: number, z: number, F: number): Mesh {
  parts.push(cyl(scene, 0.06, 0.95, x, F + 0.475, z, PALETTE.wood, 5));
  parts.push(box(scene, 0.17, 0.03, 0.17, x, F + 0.97, z, PALETTE.wood));
  parts.push(pyramid(scene, 0.24, 0.1, x, F + 1.02, z, PALETTE.roofs[0]));
  parts.push(box(scene, 0.17, 0.03, 0.17, x, F + 0.8, z, PALETTE.wood));
  return lamp(scene, x, z, F + 0.885);
}

/**
 * The deck every stilt building stands on: a plank slab with posts round the edge (paired at the corners, more
 * along long sides) and a rail tying the posts below the deck. Buildings on the ground get no posts.
 */
function deck(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, d: number, F: number, inset = 0.1): void {
  parts.push(box(scene, w - 0.02, 0.08, d - 0.02, cx, F - 0.04, cz, PALETTE.planks));
  parts.push(box(scene, w - 0.02, 0.05, 0.05, cx, F - 0.1, cz - d / 2 + 0.05, PALETTE.wood));
  parts.push(box(scene, w - 0.02, 0.05, 0.05, cx, F - 0.1, cz + d / 2 - 0.05, PALETTE.wood));
  if (F - ground(cx, cz) < 0.2) return;
  const hx = w / 2 - inset, hz = d / 2 - inset;
  const nx = Math.max(2, Math.round(w / 0.5) + 1), nz = Math.max(2, Math.round(d / 0.5) + 1);
  for (let a = 0; a < nx; a++) for (const sz of [-1, 1]) parts.push(stilt(scene, cx - hx + (2 * hx * a) / (nx - 1), cz + sz * hz, F - 0.08, 0.09, 5));
  for (let b = 1; b < nz - 1; b++) for (const sx of [-1, 1]) parts.push(stilt(scene, cx + sx * hx, cz - hz + (2 * hz * b) / (nz - 1), F - 0.08, 0.09, 5));
  // Cross rail under the deck on the long sides.
  const railY = F - 0.45;
  if (railY > ground(cx, cz) + 0.1) for (const sz of [-1, 1]) parts.push(box(scene, w - 0.2, 0.04, 0.04, cx, railY, cz + sz * hz, PALETTE.wood));
}

/** A closed shed with a gable roof: walls, a door and a window on the long side, chimney optional. */
function shed(scene: Scene, parts: Mesh[], cx: number, cz: number, w: number, h: number, d: number, F: number, wall: string, roof: string, alongX = w >= d): void {
  parts.push(box(scene, w, h, d, cx, F + h / 2, cz, wall));
  gable(scene, parts, cx, cz, w, d, F + h, h * 0.55, roof, alongX);
  door(scene, parts, cx - w * 0.2, F, cz - d / 2 - 0.01, false, 0.2, Math.min(0.34, h * 0.55));
  window_(scene, parts, cx + w * 0.25, F + h * 0.6, cz - d / 2 - 0.01, false, 0.14, 0.14);
}

function logPile(scene: Scene, parts: Mesh[], x: number, y: number, z: number, alongX: boolean, n = 3): void {
  const rows = [[-0.15, 0], [0.15, 0], [0, 0.13], [-0.3, 0], [0.3, 0], [-0.15, 0.13], [0.15, 0.13], [0, 0.26]];
  for (const [dx, dy] of rows.slice(0, Math.min(rows.length, n))) {
    const log = MeshBuilder.CreateCylinder("log", { diameter: 0.15, height: 0.7, tessellation: 6 }, scene);
    if (alongX) log.rotation.z = Math.PI / 2; else log.rotation.x = Math.PI / 2;
    log.position.set(x + (alongX ? 0 : dx), y + dy + 0.075, z + (alongX ? dx : 0));
    parts.push(tint(log, "#b9543f"));
    const bark = MeshBuilder.CreateCylinder("bark", { diameter: 0.152, height: 0.6, tessellation: 6 }, scene);
    if (alongX) bark.rotation.z = Math.PI / 2; else bark.rotation.x = Math.PI / 2;
    bark.position.set(x + (alongX ? 0 : dx), y + dy + 0.075, z + (alongX ? dx : 0));
    parts.push(tint(bark, PALETTE.wood));
  }
}

/** A hanging net: a pale panel with a rope along its top. */
function net(scene: Scene, parts: Mesh[], x: number, y: number, z: number, w: number, h: number, facingX: boolean): void {
  parts.push(box(scene, facingX ? 0.02 : w, h, facingX ? w : 0.02, x, y - h / 2, z, PALETTE.sail));
  parts.push(box(scene, facingX ? 0.03 : w + 0.05, 0.03, facingX ? w + 0.05 : 0.03, x, y, z, ROPE));
}

// ---------- homes ----------

// Roof colour and shape live in view/roofs.ts (Babylon-free) so the World's miniatures can share them.
export { roofShape } from "./roofs";
export type { RoofShape } from "./roofs";

function homeRoof(scene: Scene, parts: Mesh[], b: Building, cx: number, cz: number, bodyW: number, bodyD: number, top: number, rise: number): void {
  const hex = roofFor(b);
  switch (roofShape(b)) {
    case "pyramid":
      parts.push(pyramid(scene, Math.max(bodyW, bodyD) * 1.7, rise, cx, top + rise / 2, cz, hex));
      parts.push(cyl(scene, 0.05, 0.12, cx, top + rise + 0.05, cz, PALETTE.wood, 4));
      return;
    case "gable":
      gable(scene, parts, cx, cz, bodyW, bodyD, top, rise, hex, b.id % 2 === 1);
      return;
    case "hipped":
      hip(scene, parts, cx, cz, bodyW, bodyD, top, rise * 0.8, hex);
      return;
  }
}

/**
 * A round thatched hut (the Atoll): a cylinder of pale wall under a cone of thatch; level 2 adds a verandah on
 * posts round the front, level 3 a second storey with its own smaller cone.
 */
function roundHome(scene: Scene, b: Building, bodyW: number, baseH: number): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const dia = bodyW * 1.05;
  const bodyH = baseH * 0.85;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const wall = PALETTE.walls[b.id % PALETTE.walls.length];
  const bx = cx, bz = cz + 0.04;
  parts.push(cyl(scene, dia, bodyH, bx, F + bodyH / 2, bz, wall, 8));
  for (const k of [0.4, 0.75]) parts.push(cyl(scene, dia + 0.02, 0.015, bx, F + bodyH * k, bz, TRIM, 8));
  door(scene, parts, bx, F, bz - dia / 2 + 0.02, false, 0.18, Math.min(0.32, bodyH * 0.6));
  const roofHex = roofFor(b);
  const rise = dia * 0.62;
  let top = F + bodyH;
  if (b.level >= 3) {
    // The second storey: a narrower drum with a window, its cone above.
    parts.push(cyl(scene, dia * 0.72, bodyH * 0.6, bx, top + bodyH * 0.3, bz, wall, 8));
    window_(scene, parts, bx, top + bodyH * 0.3, bz - dia * 0.36 - 0.005, false, 0.12, 0.12, false);
    parts.push(cyl(scene, dia + 0.3, 0.05, bx, top + 0.02, bz, roofHex, 8)); // the lower thatch brim
    top += bodyH * 0.6;
    parts.push(cyl(scene, dia * 0.72 + 0.3, rise * 0.8, bx, top + rise * 0.4, bz, roofHex, 8, 0));
  } else {
    parts.push(cyl(scene, dia + 0.3, rise, bx, top + rise / 2, bz, roofHex, 8, 0));
  }
  parts.push(cyl(scene, 0.06, 0.12, bx, top + (b.level >= 3 ? rise * 0.8 : rise) + 0.05, bz, PALETTE.wood, 4));
  if (b.level >= 2) {
    // The verandah: a half-ring of deck on short posts round the door side, under a thatch skirt.
    parts.push(box(scene, dia + 0.2, 0.04, 0.26, bx, F + 0.02, bz - dia / 2 - 0.12, PALETTE.planks));
    for (const sx of [-1, 1]) parts.push(box(scene, 0.05, 0.55, 0.05, bx + sx * (dia / 2 + 0.05), F + 0.28, bz - dia / 2 - 0.2, PALETTE.wood));
    parts.push(box(scene, dia + 0.3, 0.03, 0.34, bx, F + 0.56, bz - dia / 2 - 0.14, roofHex));
  }
  railing(scene, parts, cx + w / 2 - 0.08, cz - d / 2 + 0.08, cx + w / 2 - 0.08, cz + d / 2 - 0.08, F, 0.26);
  const lantern = bracketLantern(scene, parts, bx + dia / 2 - 0.02, F + bodyH * 0.7, bz - dia * 0.3, 1, 0);
  return { root: mergeFlat(b.kind, parts, scene), lantern };
}

/**
 * A home. Huts are one small room; houses a wider cottage with shutters; tall houses a narrow tower with a
 * balcony (reference/house). Levels add a window box, then a chimney and a lit porch.
 */
function home(scene: Scene, b: Building, bodyW: number, baseH: number): BuildingMeshes {
  if (HOUSE_KIT === "round") return roundHome(scene, b, bodyW, baseH);
  const coast = COAST_HOMES[HOUSE_KIT];
  if (coast) return coast(scene, b, bodyW, baseH);
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const bodyH = baseH + 0.14 * (b.level - 1);
  const bodyD = bodyW * 0.92;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const wall = PALETTE.walls[b.id % PALETTE.walls.length];
  const bx = cx - 0.06, bz = cz + 0.05;
  parts.push(box(scene, bodyW, bodyH, bodyD, bx, F + bodyH / 2, bz, wall));
  // Plank lines: two thin bands so the wall reads as boards.
  for (const k of [0.33, 0.66]) parts.push(box(scene, bodyW + 0.01, 0.015, bodyD + 0.01, bx, F + bodyH * k, bz, TRIM));
  door(scene, parts, bx - bodyW * 0.15, F, bz - bodyD / 2 - 0.005, false, 0.18, Math.min(0.32, bodyH * 0.55));
  window_(scene, parts, bx + bodyW / 2 + 0.005, F + bodyH * 0.6, bz, true, 0.14, 0.14, b.kind !== "hut");
  if (bodyH > 1.1) {
    // Tall house: second-storey windows and a balcony on the front.
    window_(scene, parts, bx + bodyW * 0.2, F + bodyH * 0.72, bz - bodyD / 2 - 0.005, false, 0.13, 0.14);
    window_(scene, parts, bx - bodyW / 2 - 0.005, F + bodyH * 0.72, bz, true, 0.13, 0.14);
    const by = F + bodyH * 0.5;
    parts.push(box(scene, bodyW * 0.7, 0.05, 0.2, bx, by, bz - bodyD / 2 - 0.1, PALETTE.planks));
    railing(scene, parts, bx - bodyW * 0.35, bz - bodyD / 2 - 0.2, bx + bodyW * 0.35, bz - bodyD / 2 - 0.2, by, 0.2);
  } else if (b.level >= 2) {
    parts.push(box(scene, bodyW * 0.4, 0.06, 0.1, bx + bodyW * 0.2, F + bodyH * 0.5, bz - bodyD / 2 - 0.05, PALETTE.wood)); // window box
    window_(scene, parts, bx + bodyW * 0.2, F + bodyH * 0.62, bz - bodyD / 2 - 0.005, false, 0.13, 0.13);
  }
  const stave = HOUSE_KIT === "stave";
  const rise = (bodyH > 1.1 ? 0.42 : bodyW * 0.55) * (stave ? 1.7 : 1);
  homeRoof(scene, parts, b, bx, bz, bodyW, bodyD, F + bodyH, rise);
  if (stave) {
    // Stave church language: a second, smaller gable riding the ridge, shingle bands, and a carved crest post.
    gable(scene, parts, bx, bz, bodyW * 0.55, bodyD * 0.55, F + bodyH + rise * 0.55, rise * 0.5, PALETTE.roofs[b.id % PALETTE.roofs.length], b.id % 2 === 1, 0.08);
    parts.push(box(scene, 0.05, 0.22, 0.05, bx, F + bodyH + rise * 1.05 + 0.1, bz, PALETTE.wood));
    parts.push(box(scene, 0.09, 0.05, 0.05, bx, F + bodyH + rise * 1.05 + 0.22, bz, "#8a3f33"));
  }
  if (b.level >= 3) chimney(scene, parts, bx + bodyW * 0.3, F + bodyH + rise * 0.5, bz + bodyD * 0.2, 0.3);
  // Porch railing on the open front edge, and the lantern on its bracket by the door.
  railing(scene, parts, cx + w / 2 - 0.08, cz - d / 2 + 0.08, cx + w / 2 - 0.08, cz + d / 2 - 0.08, F, 0.26);
  const lantern = bracketLantern(scene, parts, bx + bodyW / 2, F + bodyH * 0.7, bz - bodyD / 2 + 0.06, 0, -1);
  return { root: mergeFlat(b.kind, parts, scene), lantern };
}

// ---------- streets ----------

/**
 * What a walkway meets on each side: nothing, a deck at its own height, a deck `dh` higher (a step up), or a
 * pier, dock or harbor `-dh` lower ("down": those draw nothing toward the street, so the street steps down onto
 * them). `root`: the neighbour is a pier, dock or harbor, whose deck stops a little short of its cell's edge.
 */
export type Join = { side: Cell; kind: "open" | "flush" | "step" | "down"; dh: number; root?: boolean };
/** How far a path's surface sits above the ground it drapes over (the same lift as its strips). */
const PATH_LIFT = 0.05;
export function deckJoins(b: Building, grid: Grid): Join[] {
  const c = b.cells[0];
  return DIRS.map(d => {
    const n = grid.buildingAt({ i: c.i + d.i, j: c.j + d.j });
    if (!n) return { side: d, kind: "open" as const, dh: 0 };
    // Paths drape over the ground, so two paths always meet flush whatever their nominal floors.
    if (b.kind === "path" && n.kind === "path") return { side: d, kind: "flush" as const, dh: 0 };
    // A path's surface at the shared edge is the ground there, not its cell's nominal floor: a deck that meets
    // a path on a bank climbs to where the path actually is.
    const { x, z } = cellCenter(c);
    const nh = n.kind === "path" ? ground(x + d.i * 0.5, z + d.j * 0.5) + PATH_LIFT : n.floorY;
    const dh = nh - b.floorY;
    const root = BUILDINGS[n.kind].network === "root";
    if (dh > 0.1 && dh <= STREET_STEP_MAX + 1e-6) return { side: d, kind: "step" as const, dh, root };
    if (root && dh < -0.1 && -dh <= STREET_STEP_MAX + 1e-6) return { side: d, kind: "down" as const, dh, root };
    return { side: d, kind: "flush" as const, dh: 0, root };
  });
}
function joinKey(b: Building, grid: Grid): string {
  return deckJoins(b, grid).map(j => (j.kind === "open" ? "-" : j.kind === "flush" ? "=" : j.kind === "step" ? `s${Math.round(j.dh * 10)}` : `d${Math.round(-j.dh * 10)}`) + (j.root ? "r" : "")).join("");
}

/**
 * The deck of a one-cell street piece: the slab runs to the cell edge wherever a neighbour deck meets it (so a
 * street reads as one surface), short posts and a rail close the open sides, and a solid stair climbs to a
 * higher neighbour.
 */
function streetDeck(scene: Scene, parts: Mesh[], b: Building, grid: Grid, x: number, z: number, F: number, surface = PALETTE.planks, kerb: string | null = PALETTE.wood): void {
  parts.push(box(scene, 0.9, 0.07, 0.9, x, F - 0.035, z, surface));
  for (const j of deckJoins(b, grid)) {
    const ax = j.side.i, az = j.side.j; // unit vector toward the side
    if (j.kind === "open") {
      if (kerb) {
        // Two stub posts and a low rail along the open edge, as on the reference walkway.
        for (const t of [-0.36, 0.36]) parts.push(box(scene, 0.045, 0.16, 0.045, x + ax * 0.44 + (ax ? 0 : t), F + 0.08, z + az * 0.44 + (az ? 0 : t), kerb));
        parts.push(box(scene, ax ? 0.035 : 0.8, 0.03, az ? 0.035 : 0.8, x + ax * 0.44, F + 0.15, z + az * 0.44, kerb));
      } else parts.push(box(scene, ax ? 0.1 : 0.9, 0.07, az ? 0.1 : 0.9, x + ax * 0.45, F - 0.035, z + az * 0.45, surface));
      continue;
    }
    // Fill out to the edge (0.45 → 0.5); the neighbour fills its own half, so the seam vanishes. A pier, dock or
    // harbor at the same height stops short of the edge: the fill runs on over the gap to meet it.
    if (j.root && j.kind === "flush") parts.push(box(scene, ax ? 0.2 : 0.9, 0.07, az ? 0.2 : 0.9, x + ax * 0.49, F - 0.036, z + az * 0.49, surface));
    else parts.push(box(scene, ax ? 0.12 : 0.9, 0.07, az ? 0.12 : 0.9, x + ax * 0.45, F - 0.035, z + az * 0.45, surface));
    if (j.kind === "down") {
      // A stair down onto the lower pier, dock or harbor, standing on its deck: the top tread level with this deck
      // at the shared edge, each lower tread reaching further out, so the flight reads as one wedge.
      const drop = -j.dh;
      const n = Math.max(2, Math.ceil(drop / 0.13));
      const depth = Math.min(0.45, 0.15 * n);
      const base = F - drop;
      for (let k = 1; k <= n; k++) {
        const len = 0.02 + depth * (n - k + 1) / n, mid = 0.5 + len / 2 - 0.02;
        const h = (drop * k) / n;
        parts.push(box(scene, ax ? len : 0.7, h, az ? len : 0.7, x + ax * mid, base + h / 2, z + az * mid, k % 2 ? PALETTE.planks : PALETTE.wood));
      }
    }
    if (j.kind === "step") {
      // A solid stair against the higher deck: each tread is a block from this deck up to its own height and
      // out to the shared edge, so the flight reads as one wedge whose top tread meets the neighbour's floor.
      const n = Math.max(2, Math.ceil(j.dh / 0.13));
      const depth = Math.min(0.9, 0.15 * n); // a tall flight runs most of the way across the cell
      for (let k = 1; k <= n; k++) {
        const front = 0.5 - depth * (n - k + 1) / n;
        const len = 0.5 - front, mid = (front + 0.5) / 2;
        const h = (j.dh * k) / n;
        parts.push(box(scene, ax ? len : 0.7, h, az ? len : 0.7, x + ax * mid, F + h / 2, z + az * mid, k % 2 ? PALETTE.planks : PALETTE.wood));
      }
    }
  }
}

function walkway(scene: Scene, b: Building, grid: Grid): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  streetDeck(scene, parts, b, grid, x, z, F);
  // Plank lines across the deck.
  for (const t of [-0.3, -0.1, 0.1, 0.3]) parts.push(box(scene, 0.86, 0.012, 0.02, x, F + 0.004, z + t, "#7a6248"));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, x + sx * 0.32, z + sz * 0.32, F - 0.07, 0.07, 5));
  const lamp = b.lantern ? postLantern(scene, parts, x + 0.36, z + 0.36, F) : undefined;
  return { root: mergeFlat("walkway", parts, scene), lantern: lamp };
}

function raisedWalkway(scene: Scene, b: Building, grid: Grid): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  streetDeck(scene, parts, b, grid, x, z, F);
  for (const t of [-0.3, -0.1, 0.1, 0.3]) parts.push(box(scene, 0.86, 0.012, 0.02, x, F + 0.004, z + t, "#7a6248"));
  // A trestle: four splayed legs and two diagonal braces, after the reference sheet.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = stilt(scene, x + sx * 0.3, z + sz * 0.3, F - 0.07, 0.07, 5);
    leg.rotation.x = -sz * 0.06; leg.rotation.z = sx * 0.06;
    parts.push(leg);
  }
  const bed = ground(x, z);
  const h = Math.max(0.2, F - bed - 0.15);
  for (const sx of [-1, 1]) {
    const brace = box(scene, 0.04, Math.hypot(0.6, h), 0.04, x + sx * 0.3, bed + h / 2 + 0.05, z, PALETTE.wood);
    brace.rotation.x = Math.atan2(0.6, h);
    parts.push(brace);
  }
  const lamp = b.lantern ? postLantern(scene, parts, x + 0.36, z + 0.36, F) : undefined;
  return { root: mergeFlat("raisedWalkway", parts, scene), lantern: lamp };
}

/**
 * A dirt track: a narrow strip (half a cell wide) that follows the terrain the way roads drape over hills in a
 * city builder. It runs from the cell centre to every edge that meets another piece and stops short where it
 * is open, so a trail bends and branches with the cells it is laid on; paths join paths flush, and a stair
 * climbs from the ground to a higher deck. Vertices sit just above the rendered ground, so nothing clips.
 */
function path(scene: Scene, b: Building, grid: Grid): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const parts: Mesh[] = [];
  const joins = deckJoins(b, grid);
  const W = 0.5, LIFT = 0.05, N = 4;
  const strip = (x0: number, x1: number, z0: number, z1: number) => {
    const m = MeshBuilder.CreateGround("path", { width: x1 - x0, height: z1 - z0, subdivisions: N }, scene);
    m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    for (let k = 0; k < pos.length; k += 3) pos[k + 1] = ground(pos[k] + m.position.x, pos[k + 2] + m.position.z) + LIFT;
    m.updateVerticesData(VertexBuffer.PositionKind, pos);
    parts.push(tint(m, ROPE));
  };
  const met = joins.filter(j => j.kind !== "open");
  if (met.length === 0) strip(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
  else {
    strip(x - W / 2, x + W / 2, z - W / 2, z + W / 2);
    for (const j of met) {
      const ax = j.side.i, az = j.side.j;
      if (ax) strip(Math.min(x + ax * W / 2, x + ax * 0.5), Math.max(x + ax * W / 2, x + ax * 0.5), z - W / 2, z + W / 2);
      else strip(x - W / 2, x + W / 2, Math.min(z + az * W / 2, z + az * 0.5), Math.max(z + az * W / 2, z + az * 0.5));
    }
  }
  for (const j of joins) {
    if (j.kind !== "step") continue;
    // The stair up to a deck: treads from the ground at the edge up to the neighbour's floor.
    const ax = j.side.i, az = j.side.j;
    const base = ground(x + ax * 0.5, z + az * 0.5) + LIFT;
    const top = b.floorY + j.dh;
    const n = Math.max(2, Math.ceil((top - base) / 0.13));
    const depth = Math.min(0.9, 0.15 * n); // a tall flight runs most of the way across the cell
    for (let k = 1; k <= n; k++) {
      const front = 0.5 - depth * (n - k + 1) / n;
      const len = 0.5 - front, mid = (front + 0.5) / 2;
      const h = base + ((top - base) * k) / n;
      const foot = ground(x + ax * mid, z + az * mid);
      parts.push(box(scene, ax ? len : W + 0.1, h - foot, az ? len : W + 0.1, x + ax * mid, (h + foot) / 2, z + az * mid, k % 2 ? PALETTE.planks : PALETTE.wood));
    }
  }
  // A pebble or two along the verge.
  for (const [dx, dz, s] of [[-0.38, 0.3, 0.05], [0.4, -0.34, 0.04]] as [number, number, number][]) parts.push(rock(scene, x + dx, ground(x + dx, z + dz) + 0.02, z + dz, s, STONE, dx * 10));
  return { root: mergeFlat("path", parts, scene) };
}

// ---------- the sea's edge ----------

function pier(scene: Scene, b: Building): BuildingMeshes {
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  const cx = (a.x + s.x) / 2, cz = (a.z + s.z) / 2;
  const alongX = a.z === s.z;
  const len = b.cells.length;
  const F = b.floorY;
  const at = (along: number, across: number) => alongX ? { x: cx + along, z: cz + across } : { x: cx + across, z: cz + along };
  const parts: Mesh[] = [box(scene, alongX ? len - 0.02 : 0.86, 0.1, alongX ? 0.86 : len - 0.02, cx, F - 0.05, cz, PALETTE.planks)];
  for (let k = 0; k < 2 * len + 1; k++) { const p = at(-len / 2 + 0.5 * k, 0); parts.push(box(scene, alongX ? 0.02 : 0.8, 0.012, alongX ? 0.8 : 0.02, p.x, F + 0.006, p.z, "#7a6248")); }
  // Paired piles with a cross rail, a mooring ladder and bollards at the seaward end, a lamp at the root.
  for (let k = 0; k < len; k++) for (const across of [-0.3, 0.3]) {
    const p = at(-len / 2 + 0.5 + k, across);
    parts.push(stilt(scene, p.x, p.z, F - 0.1, 0.13, 6));
  }
  for (let k = 0; k < len; k++) { const p = at(-len / 2 + 0.5 + k, 0); parts.push(box(scene, alongX ? 0.05 : 0.7, 0.05, alongX ? 0.7 : 0.05, p.x, F - 0.4, p.z, PALETTE.wood)); }
  const dir = Math.sign(alongX ? s.x - a.x : s.z - a.z) || 1;
  for (const across of [-0.3, 0.3]) { const p = at(dir * (len / 2 - 0.15), across); bollard(scene, parts, p.x, F, p.z); }
  const lad = at(-dir * (len / 2 - 0.6), 0.47);
  for (let k = 0; k < 4; k++) parts.push(box(scene, alongX ? 0.2 : 0.04, 0.03, alongX ? 0.04 : 0.2, lad.x, F - 0.1 - k * 0.15, lad.z, PALETTE.wood));
  return { root: mergeFlat("pier", parts, scene) };
}

/** After reference/dock: tall piles with blue-painted feet, red-capped bollards, a hut, a crane and a ladder. */
function dock(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, w - 0.02, 0.12, d - 0.02, cx, F - 0.06, cz, PALETTE.planks)];
  for (const t of [-0.6, -0.2, 0.2, 0.6]) parts.push(box(scene, w - 0.1, 0.012, 0.02, cx, F + 0.006, cz + t, "#7a6248"));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    if (sx === 0 && sz === 0) continue;
    const x = cx + sx * (w / 2 - 0.15), z = cz + sz * (d / 2 - 0.15);
    parts.push(stilt(scene, x, z, F - 0.12, 0.16, 6));
    const bed = ground(x, z) - STILT_SINK;
    const bandH = Math.min(0.8, Math.max(0.2, (F - bed) * 0.45));
    parts.push(cyl(scene, 0.165, bandH, x, bed + bandH / 2, z, BLUE, 6));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bollard(scene, parts, cx + sx * (w / 2 - 0.18), F, cz + sz * (d / 2 - 0.18), PALETTE.roofs[0]);
  // The dockmaster's hut, a crane and a ladder over the edge.
  parts.push(box(scene, 0.62, 0.5, 0.5, cx - 0.35, F + 0.25, cz - 0.3, PALETTE.walls[0]));
  gable(scene, parts, cx - 0.35, cz - 0.3, 0.62, 0.5, F + 0.5, 0.28, PALETTE.roofs[0], true);
  door(scene, parts, cx - 0.35, F, cz - 0.05, false, 0.16, 0.3);
  window_(scene, parts, cx - 0.35 + 0.31, F + 0.3, cz - 0.3, true, 0.12, 0.12, false);
  parts.push(cyl(scene, 0.09, 1.3, cx + 0.55, F + 0.65, cz + 0.45, PALETTE.wood, 5));
  const arm = box(scene, 0.8, 0.07, 0.07, cx + 0.55 + 0.32, F + 1.25, cz + 0.45, PALETTE.wood);
  arm.rotation.z = -0.25;
  parts.push(arm);
  parts.push(box(scene, 0.015, 0.7, 0.015, cx + 0.55 + 0.7, F + 0.85, cz + 0.45, ROPE));
  for (let k = 0; k < 5; k++) parts.push(box(scene, 0.04, 0.03, 0.22, cx + w / 2 + 0.03, F - 0.1 - k * 0.16, cz + 0.2, PALETTE.wood));
  for (const sz of [0.09, 0.31]) parts.push(box(scene, 0.03, 0.85, 0.03, cx + w / 2 + 0.03, F - 0.4, cz + sz, PALETTE.wood));
  const lantern = bracketLantern(scene, parts, cx + w / 2 - 0.02, F + 0.5, cz - d / 2 + 0.15, 1, 0);
  return { root: mergeFlat("dock", parts, scene), lantern };
}

/** After reference/harbor: a stone quay with a white two-storey harbour house, red roofs, a crane and bollards. */
function harbor(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  const bed = Math.min(...b.cells.map(c => { const { x, z } = cellCenter(c); return ground(x, z); })) - 0.2;
  parts.push(box(scene, w - 0.04, F - bed, d - 0.04, cx, (F + bed) / 2, cz, STONE));
  parts.push(box(scene, w, 0.1, d, cx, F - 0.05, cz, STONE_LIGHT));
  for (const k of [0.25, 0.5, 0.75]) parts.push(box(scene, w - 0.02, 0.02, d - 0.02, cx, bed + (F - bed) * k, cz, "#7f7c75")); // courses
  // The harbour house: a tall block with a red gable roof, a lower wing with a lean-to, blue doors.
  const hx = cx - 0.55, hz = cz - 0.5;
  parts.push(box(scene, 1.2, 1.5, 1.1, hx, F + 0.75, hz, PALETTE.walls[0]));
  gable(scene, parts, hx, hz, 1.2, 1.1, F + 1.5, 0.55, PALETTE.roofs[0], true);
  chimney(scene, parts, hx + 0.4, F + 1.5 + 0.3, hz - 0.2, 0.35);
  parts.push(box(scene, 0.8, 0.8, 0.9, hx + 1.0, F + 0.4, hz + 0.1, PALETTE.walls[0]));
  gable(scene, parts, hx + 1.0, hz + 0.1, 0.8, 0.9, F + 0.8, 0.35, PALETTE.roofs[0], false);
  door(scene, parts, hx + 1.0, F, hz + 0.56, false, 0.32, 0.5);
  window_(scene, parts, hx - 0.3, F + 1.05, hz + 0.56, false, 0.15, 0.18);
  window_(scene, parts, hx + 0.3, F + 1.05, hz + 0.56, false, 0.15, 0.18);
  window_(scene, parts, hx - 0.61, F + 0.5, hz, true, 0.15, 0.18);
  // Crane, bollards, barrels, a lamp post.
  parts.push(cyl(scene, 0.1, 1.5, cx + 0.9, F + 0.75, cz + 0.9, PALETTE.wood, 5));
  const arm = box(scene, 1.1, 0.08, 0.08, cx + 0.9 + 0.4, F + 1.45, cz + 0.9, PALETTE.wood); arm.rotation.z = -0.3; parts.push(arm);
  parts.push(box(scene, 0.015, 0.8, 0.015, cx + 0.9 + 0.95, F + 1.0, cz + 0.9, ROPE));
  for (const t of [-1, 0, 1]) bollard(scene, parts, cx + t * 1.0, F, cz + d / 2 - 0.15);
  for (const t of [-1, 1]) bollard(scene, parts, cx + w / 2 - 0.15, F, cz + t * 0.8);
  barrel(scene, parts, cx + 0.2, F, cz + 0.55); barrel(scene, parts, cx + 0.45, F, cz + 0.6, 0.2);
  crate(scene, parts, cx - 1.1, F, cz + 0.9); crate(scene, parts, cx - 0.85, F, cz + 0.95, 0.18);
  const lantern = postLantern(scene, parts, cx + 1.25, cz - 1.25, F);
  return { root: mergeFlat("harbor", parts, scene), lantern };
}

/** After reference/shipyard: a plank slipway to the water, a blue hull on its cradle, a crane and a workshop. */
function shipyard(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const alongX = w >= d;
  const parts: Mesh[] = [box(scene, w - 0.02, 0.12, d - 0.02, cx, F - 0.06, cz, PALETTE.planks)];
  for (let sx = -1; sx <= 1; sx++) for (const sz of [-1, 1]) parts.push(stilt(scene, cx + (alongX ? sx * (w / 2 - 0.2) : sz * (w / 2 - 0.15)), cz + (alongX ? sz * (d / 2 - 0.15) : sx * (d / 2 - 0.2)), F - 0.12, 0.14, 6));
  // The slipway: a ramp of planks off the seaward long side.
  const ramp = box(scene, alongX ? 1.2 : 0.8, 0.06, alongX ? 0.8 : 1.2, cx + (alongX ? 0.3 : d / 2 + 0.3), F - 0.25, cz + (alongX ? d / 2 + 0.3 : 0.3), PALETTE.planks);
  if (alongX) ramp.rotation.x = 0.5; else ramp.rotation.z = -0.5;
  parts.push(ramp);
  // The hull under way: a blue double-ended hull on two cradle blocks.
  const hull = MeshBuilder.CreateCylinder("yardHull", { diameter: 0.5, height: 0.3, tessellation: 6 }, scene);
  hull.scaling.set(alongX ? 2.2 : 1, 1, alongX ? 1 : 2.2);
  hull.position.set(cx + (alongX ? 0.2 : 0), F + 0.35, cz + (alongX ? 0 : 0.2));
  parts.push(tint(hull, BLUE));
  parts.push(cyl(scene, 0.4, 0.04, cx + (alongX ? 0.2 : 0), F + 0.51, cz + (alongX ? 0 : 0.2), PALETTE.planks, 6));
  for (const t of [-0.4, 0.4]) parts.push(box(scene, alongX ? 0.12 : 0.6, 0.2, alongX ? 0.6 : 0.12, cx + (alongX ? 0.2 + t : 0), F + 0.1, cz + (alongX ? 0 : 0.2 + t), PALETTE.wood));
  // Workshop with red roof and blue doors, crane, timber stacks.
  const sx = cx - (alongX ? 0.95 : 0), sz = cz - (alongX ? 0 : 0.95);
  parts.push(box(scene, alongX ? 0.9 : 0.75, 0.75, alongX ? 0.75 : 0.9, sx, F + 0.375, sz, PALETTE.walls[0]));
  gable(scene, parts, sx, sz, alongX ? 0.9 : 0.75, alongX ? 0.75 : 0.9, F + 0.75, 0.38, PALETTE.roofs[0], alongX);
  door(scene, parts, sx + (alongX ? 0.46 : 0), F, sz + (alongX ? 0 : 0.46), alongX, 0.26, 0.42);
  parts.push(cyl(scene, 0.09, 1.3, cx + (alongX ? 1.2 : 0.3), F + 0.65, cz + (alongX ? -0.6 : 1.2), PALETTE.wood, 5));
  const arm = box(scene, alongX ? 0.9 : 0.07, 0.07, alongX ? 0.07 : 0.9, cx + (alongX ? 0.85 : 0.3), F + 1.25, cz + (alongX ? -0.6 : 0.85), PALETTE.wood);
  if (alongX) arm.rotation.z = 0.3; else arm.rotation.x = -0.3;
  parts.push(arm);
  logPile(scene, parts, cx + (alongX ? 1.15 : -0.5), F, cz + (alongX ? 0.55 : 1.15), !alongX, 5);
  return { root: mergeFlat("shipyard", parts, scene) };
}

/** After reference/lighthouse: a tapered white tower with a red band, a glazed lamp room, a keeper's hut, a rock. */
function lighthouse(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  parts.push(rock(scene, x, F - 0.05, z, 1.1, STONE, 3));
  parts.push(rock(scene, x + 0.35, F - 0.1, z - 0.3, 0.6, STONE, 5));
  parts.push(cyl(scene, 0.62, 2.4, x, F + 1.2, z, PALETTE.walls[0], 8, 0.42));
  parts.push(cyl(scene, 0.46, 0.35, x, F + 2.1, z, PALETTE.roofs[0], 8, 0.43));
  parts.push(cyl(scene, 0.56, 0.06, x, F + 2.43, z, BLUE, 8));
  railing(scene, parts, x - 0.28, z - 0.28, x + 0.28, z - 0.28, F + 2.46, 0.16);
  railing(scene, parts, x - 0.28, z + 0.28, x + 0.28, z + 0.28, F + 2.46, 0.16);
  parts.push(cyl(scene, 0.34, 0.34, x, F + 2.63, z, GLASS, 8));
  for (let k = 0; k < 4; k++) { const m = box(scene, 0.03, 0.34, 0.03, x + 0.17 * Math.cos(k * Math.PI / 2 + 0.4), F + 2.63, z + 0.17 * Math.sin(k * Math.PI / 2 + 0.4), BLUE); parts.push(m); }
  parts.push(cyl(scene, 0.44, 0.22, x, F + 2.9, z, BLUE, 8, 0.05));
  window_(scene, parts, x, F + 1.0, z - 0.29, false, 0.1, 0.16, false);
  window_(scene, parts, x, F + 1.6, z - 0.26, false, 0.1, 0.16, false);
  // Keeper's hut at the base.
  parts.push(box(scene, 0.5, 0.42, 0.4, x + 0.35, F + 0.21, z + 0.15, PALETTE.walls[0]));
  gable(scene, parts, x + 0.35, z + 0.15, 0.5, 0.4, F + 0.42, 0.22, PALETTE.roofs[1], true);
  door(scene, parts, x + 0.35, F, z + 0.36, false, 0.14, 0.26);
  const lamp_ = lamp(scene, x, z, F + 2.63);
  lamp_.scaling.setAll(1.9);
  return { root: mergeFlat("lighthouse", parts, scene), lantern: lamp_ };
}

function breakwater(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const parts: Mesh[] = [];
  const bed = ground(x, z);
  const top = 0.9;
  parts.push(box(scene, 0.9, top - bed - 0.2, 0.9, x, (top - 0.2 + bed) / 2, z, "#5d6d7a"));
  // A heap of blue-grey rocks, biggest at the centre.
  const rocks: [number, number, number][] = [[0, 0.75, 0.55], [-0.3, 0.6, 0.42], [0.3, 0.62, 0.4], [0.05, 0.55, 0.36], [-0.25, 0.5, 0.3], [0.28, 0.5, 0.3]];
  rocks.forEach(([dx, y, s], k) => parts.push(rock(scene, x + dx, y, z + ((k % 2) - 0.5) * 0.35, s, k % 3 === 0 ? "#5d6d7a" : "#4c5a66", k)));
  return { root: mergeFlat("breakwater", parts, scene) };
}

function seaWall(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const parts: Mesh[] = [];
  const bed = ground(x, z);
  // Stone footing, blue plank face, a plank cap and a pole lamp.
  parts.push(box(scene, 0.98, Math.max(0.2, 1.0 - bed), 0.98, x, (1.0 + bed) / 2, z, STONE_LIGHT));
  parts.push(box(scene, 0.96, 0.5, 0.96, x, 1.25, z, BLUE));
  for (const t of [-0.3, -0.1, 0.1, 0.3]) parts.push(box(scene, 0.02, 0.48, 0.98, x + t, 1.25, z, "#2a5f7a"));
  parts.push(box(scene, 1.0, 0.1, 1.0, x, 1.55, z, PALETTE.planks));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.09, 1.7 - bed, 0.09, x + sx * 0.45, (1.7 + bed) / 2, z + sz * 0.45, PALETTE.wood));
  return { root: mergeFlat("seaWall", parts, scene) };
}

/** After reference/seaworks: the net itself, hung from the seabed's stakes to just above the ordinary high tide.
 *  The floats and the marker buoy ride the water and are drawn by the effects layer every frame. */
function sharkNet(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const parts: Mesh[] = [];
  const bed = ground(x, z);
  const top = 0.7;
  parts.push(box(scene, 0.96, top - bed, 0.02, x, (top + bed) / 2, z, PALETTE.sail));
  for (const sx of [-0.46, 0.46]) parts.push(cyl(scene, 0.04, top - bed + 0.1, x + sx, (top + bed) / 2, z, PALETTE.wood, 4));
  return { root: mergeFlat("sharkNet", parts, scene) };
}

function outfall(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  parts.push(box(scene, 0.8, 0.08, 0.5, x, F - 0.04, z, PALETTE.planks));
  for (const sz of [-1, 1]) parts.push(stilt(scene, x, z + sz * 0.18, F - 0.08, 0.12, 6));
  const pipe = MeshBuilder.CreateCylinder("pipe", { diameter: 0.24, height: 1.4, tessellation: 8 }, scene);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(x, F - 0.35, z);
  parts.push(tint(pipe, STONE));
  parts.push(cyl(scene, 0.3, 0.06, x, F - 0.35, z + 0.68, STONE_LIGHT, 8));
  parts.push(box(scene, 0.3, 0.3, 0.3, x, F + 0.15, z, PALETTE.walls[2]));
  parts.push(pyramid(scene, 0.5, 0.15, x, F + 0.37, z, PALETTE.roofs[3]));
  parts.push(cyl(scene, 0.12, 0.05, x, F + 0.33, z + 0.17, PALETTE.roofs[0], 6)); // the valve wheel
  return { root: mergeFlat("outfall", parts, scene) };
}

// ---------- production ----------

function market(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  // Six posts under a wide blue gable roof with a red trim; a blue plank back wall; the fish counter in front.
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) parts.push(cyl(scene, 0.08, 0.95, cx + sx * 0.72, F + 0.475, cz + sz * 0.62, PALETTE.wood, 5));
  parts.push(box(scene, 1.7, 0.85, 0.08, cx, F + 0.425, cz + 0.62, BLUE));
  for (const t of [-0.6, -0.2, 0.2, 0.6]) parts.push(box(scene, 0.02, 0.83, 0.09, cx + t, F + 0.425, cz + 0.62, "#2a5f7a"));
  gable(scene, parts, cx, cz, 1.6, 1.4, F + 0.95, 0.42, "#3d6f8f", true, 0.2);
  for (const sz of [-1, 1]) parts.push(box(scene, 2.02, 0.05, 0.06, cx, F + 0.96, cz + sz * 0.9, PALETTE.roofs[0]));
  parts.push(box(scene, 1.3, 0.42, 0.45, cx, F + 0.21, cz - 0.3, PALETTE.walls[0]));
  parts.push(box(scene, 1.36, 0.05, 0.5, cx, F + 0.45, cz - 0.3, PALETTE.roofs[0]));
  for (let k = 0; k < 6; k++) { const fish = MeshBuilder.CreateSphere("fish", { diameter: 0.12, segments: 3 }, scene); fish.scaling.set(1.8, 0.5, 0.8); fish.position.set(cx - 0.5 + k * 0.2, F + 0.5, cz - 0.3); parts.push(tint(fish, "#5d6d7a")); }
  net(scene, parts, cx - 0.72, F + 0.9, cz + 0.2, 0.5, 0.45, true);
  net(scene, parts, cx + 0.72, F + 0.9, cz - 0.1, 0.5, 0.5, true);
  crate(scene, parts, cx - 0.72, F, cz - 0.7, 0.2); crate(scene, parts, cx - 0.5, F, cz - 0.75, 0.16);
  barrel(scene, parts, cx + 0.75, F, cz - 0.6, 0.2);
  parts.push(box(scene, 0.34, 0.2, 0.03, cx + 0.5, F + 0.7, cz + 0.57, PALETTE.sail)); // the signboard
  return { root: mergeFlat("market", parts, scene) };
}

function oysterBed(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const parts: Mesh[] = [];
  // Three racks on thin poles standing in the shallows — covered at high water, exposed at low, whatever the
  // ledger's deck height says — each heaped with mesh bags, white and orange lumps, as in the reference.
  const R = ground(x, z) + 0.28;
  for (const dz of [-0.3, 0, 0.3]) {
    parts.push(box(scene, 0.86, 0.04, 0.16, x, R, z + dz, PALETTE.wood));
    for (const sx of [-1, 0, 1]) parts.push(stilt(scene, x + sx * 0.38, z + dz, R, 0.04, 4));
    for (let k = 0; k < 4; k++) {
      const bag = MeshBuilder.CreateSphere("bag", { diameter: 0.17, segments: 3 }, scene);
      bag.scaling.set(1.1, 0.6, 1);
      bag.position.set(x - 0.3 + k * 0.2, R + 0.07, z + dz);
      parts.push(tint(bag, (k + dz * 10) % 3 === 0 ? PALETTE.roofs[0] : PALETTE.sail));
    }
  }
  return { root: mergeFlat("oysterBed", parts, scene) };
}

function clamCamp(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells); // cell-oriented: the shelter follows the footprint's own axis
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  const alongX = a.z === s.z;
  // An open-fronted shelter with a blue roof; baskets, buckets and a rake beside it.
  parts.push(box(scene, 0.72, 0.6, 0.3, a.x, F + 0.3, a.z + 0.22, PALETTE.walls[0]));
  for (const sx of [-1, 1]) parts.push(box(scene, 0.06, 0.6, 0.6, a.x + sx * 0.33, F + 0.3, a.z + 0.07, PALETTE.walls[0]));
  gable(scene, parts, a.x, a.z + 0.05, 0.72, 0.64, F + 0.6, 0.3, BLUE, true);
  for (const [dx, dz, s2] of [[-0.25, -0.2, 0.22], [0.15, 0.15, 0.2], [-0.05, 0.3, 0.18]] as [number, number, number][]) {
    parts.push(cyl(scene, s2, 0.16, s.x + dx, F + 0.08, s.z + dz, s2 > 0.2 ? PALETTE.roofs[0] : BLUE, 6, s2 * 0.85));
  }
  const rake = box(scene, 0.03, 0.7, 0.03, s.x + 0.3, F + 0.33, s.z - 0.25, PALETTE.wood);
  rake.rotation.z = alongX ? 0.35 : 0; rake.rotation.x = alongX ? 0 : 0.35;
  parts.push(rake);
  return { root: mergeFlat("clamCamp", parts, scene) };
}

/** After reference/production: a small shed, the log pile with red-cut ends, a chopping block and a stump. */
function lumberCamp(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells); // cell-oriented: shed and log pile follow the footprint's own axis
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  shed(scene, parts, a.x, a.z, 0.7, 0.6, 0.66, F, PALETTE.walls[0], PALETTE.roofs[0], true);
  logPile(scene, parts, s.x, F, s.z, a.z === s.z, 6);
  parts.push(cyl(scene, 0.26, 0.22, s.x - 0.3 * Math.sign(s.x - a.x || 1), F + 0.11, s.z + 0.32, PALETTE.wood, 6));
  const axe = box(scene, 0.03, 0.3, 0.03, s.x - 0.3 * Math.sign(s.x - a.x || 1), F + 0.35, s.z + 0.32, PALETTE.wood); axe.rotation.x = 0.5; parts.push(axe);
  return { root: mergeFlat("lumberCamp", parts, scene) };
}

/** An open shed on posts under a blue gable roof, the big blade standing at the open side, logs beside. */
function sawmill(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const sx = cx - 0.25, sz = cz + 0.1;
  parts.push(box(scene, 1.1, 0.9, 0.9, sx, F + 0.45, sz, PALETTE.walls[0]));
  parts.push(box(scene, 0.5, 0.9, 0.9, sx - 0.55, F + 0.45, sz, PALETTE.walls[0]));
  for (const p of [[sx - 0.85, sz - 0.42], [sx - 0.85, sz + 0.42]]) parts.push(cyl(scene, 0.08, 0.9, p[0], F + 0.45, p[1], PALETTE.wood, 5));
  gable(scene, parts, sx - 0.2, sz, 1.6, 0.95, F + 0.9, 0.5, BLUE, true, 0.16);
  const blade = MeshBuilder.CreateCylinder("blade", { diameter: 0.7, height: 0.04, tessellation: 12 }, scene);
  blade.rotation.z = Math.PI / 2;
  blade.position.set(sx + 0.57, F + 0.42, sz);
  parts.push(tint(blade, STONE_LIGHT));
  parts.push(cyl(scene, 0.12, 0.06, sx + 0.57, F + 0.42, sz, PALETTE.wood, 6).rotate(Axis.Z, Math.PI / 2, Space.WORLD) as Mesh);
  logPile(scene, parts, cx + 0.55, F, cz - 0.55, true, 6);
  parts.push(rock(scene, cx + 0.7, F + 0.1, cz + 0.55, 0.4, STONE_LIGHT, 2));
  return { root: mergeFlat("sawmill", parts, scene) };
}

/** A white shed with a red gable roof and a tall brick chimney with a cap. */
function smokehouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  shed(scene, parts, cx - 0.2, cz, 1.2, 0.72, 0.7, F, PALETTE.walls[0], PALETTE.roofs[0], true);
  parts.push(box(scene, 0.2, 1.5, 0.2, cx + 0.6, F + 0.75, cz + 0.1, PALETTE.roofs[2]));
  for (const k of [0.3, 0.6, 0.9, 1.2]) parts.push(box(scene, 0.21, 0.02, 0.21, cx + 0.6, F + k, cz + 0.1, "#9a4535"));
  parts.push(box(scene, 0.26, 0.06, 0.26, cx + 0.6, F + 1.53, cz + 0.1, STONE));
  logPile(scene, parts, cx - 0.75, F, cz - 0.5, false, 3);
  return { root: mergeFlat("smokehouse", parts, scene) };
}

/** A long low shed with a blue roof and nets hung along the wall, a red rope coil by the door. */
function netLoft(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  parts.push(box(scene, 0.86, 0.5, 0.5, x, F + 0.25, z + 0.15, PALETTE.walls[0]));
  gable(scene, parts, x, z + 0.15, 0.86, 0.5, F + 0.5, 0.26, BLUE, true, 0.1);
  door(scene, parts, x + 0.28, F, z - 0.105, false, 0.15, 0.3);
  net(scene, parts, x - 0.15, F + 0.42, z - 0.12, 0.28, 0.32, false);
  net(scene, parts, x - 0.35, F + 0.4, z + 0.35, 0.2, 0.28, true);
  const coil = MeshBuilder.CreateTorus("coil", { diameter: 0.18, thickness: 0.05, tessellation: 8 }, scene);
  coil.rotation.x = Math.PI / 2; coil.position.set(x + 0.3, F + 0.03, z - 0.35);
  parts.push(tint(coil, PALETTE.roofs[0]));
  return { root: mergeFlat("netLoft", parts, scene) };
}

/** A plank barn with a red gable roof, big double doors and crates stacked at the side. */
/** Toolworks: a stone-footed workshop with a tall chimney, an anvil block by the door and a crate of iron. */
function toolworks(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.5, 0.35, 1.3, cx - 0.1, F + 0.175, cz, STONE));
  parts.push(box(scene, 1.5, 0.7, 1.3, cx - 0.1, F + 0.7, cz, PALETTE.walls[2]));
  gable(scene, parts, cx - 0.1, cz, 1.5, 1.3, F + 1.05, 0.55, PALETTE.roofs[1], true, 0.16);
  chimney(scene, parts, cx + 0.35, F + 1.2, cz + 0.3, 0.6, STONE);
  door(scene, parts, cx - 0.1, F, cz - 0.655, false, 0.36, 0.6);
  window_(scene, parts, cx - 0.55, F + 0.75, cz - 0.655, false, 0.2, 0.16, false);
  window_(scene, parts, cx + 0.35, F + 0.75, cz - 0.655, false, 0.2, 0.16, false);
  // Anvil on a stump, a crate of iron and a barrel by the door.
  parts.push(cyl(scene, 0.22, 0.22, cx + 0.78, F + 0.11, cz - 0.45, PALETTE.wood, 6));
  parts.push(box(scene, 0.26, 0.1, 0.12, cx + 0.78, F + 0.27, cz - 0.45, "#4c5a66"));
  crate(scene, parts, cx + 0.78, F, cz + 0.15, 0.24);
  parts.push(box(scene, 0.2, 0.05, 0.14, cx + 0.78, F + 0.265, cz + 0.15, "#4c5a66"));
  barrel(scene, parts, cx + 0.78, F, cz + 0.5, 0.22);
  return { root: mergeFlat("toolworks", parts, scene) };
}
function warehouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.5, 1.05, 1.4, cx - 0.15, F + 0.525, cz, PALETTE.walls[0]));
  for (const k of [0.25, 0.5, 0.75]) parts.push(box(scene, 1.51, 0.015, 1.41, cx - 0.15, F + 1.05 * k, cz, TRIM));
  gable(scene, parts, cx - 0.15, cz, 1.5, 1.4, F + 1.05, 0.6, PALETTE.roofs[0], false, 0.16);
  door(scene, parts, cx - 0.15, F, cz - 0.705, false, 0.5, 0.62);
  parts.push(box(scene, 0.03, 0.6, 0.02, cx - 0.15, F + 0.31, cz - 0.72, PALETTE.wood));
  window_(scene, parts, cx - 0.15, F + 0.85, cz - 0.705, false, 0.18, 0.14, false);
  crate(scene, parts, cx + 0.75, F, cz - 0.3, 0.24); crate(scene, parts, cx + 0.75, F + 0.24, cz - 0.3, 0.2); crate(scene, parts, cx + 0.78, F, cz + 0.05, 0.2);
  crate(scene, parts, cx + 0.5, F, cz + 0.5, 0.22);
  return { root: mergeFlat("warehouse", parts, scene) };
}

// ---------- services ----------

/** A stone well with a timber A-frame roof, a bucket on its windlass and a lantern. */
function well(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  parts.push(cyl(scene, 0.5, 0.36, x, F + 0.18, z, STONE_LIGHT, 8));
  parts.push(cyl(scene, 0.52, 0.05, x, F + 0.38, z, STONE, 8));
  parts.push(cyl(scene, 0.36, 0.02, x, F + 0.37, z, "#2a5f7a", 8)); // water
  for (const sx of [-1, 1]) parts.push(box(scene, 0.06, 0.8, 0.06, x + sx * 0.24, F + 0.4, z, PALETTE.wood));
  parts.push(cyl(scene, 0.08, 0.5, x, F + 0.72, z, PALETTE.wood, 6).rotate(Axis.Z, Math.PI / 2, Space.WORLD) as Mesh);
  gable(scene, parts, x, z, 0.4, 0.5, F + 0.8, 0.22, PALETTE.wood, true, 0.12);
  parts.push(cyl(scene, 0.12, 0.12, x, F + 0.55, z, PALETTE.planks, 6));
  parts.push(rock(scene, x + 0.35, F + 0.05, z + 0.3, 0.25, STONE, 1));
  const lantern = bracketLantern(scene, parts, x + 0.27, F + 0.68, z, 1, 0);
  return { root: mergeFlat("well", parts, scene), lantern };
}

/** A two-storey white house with a red roof, blue shutters and a red cross over the door. */
function clinic(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.0, 1.25, 0.75, cx - 0.35, F + 0.625, cz, PALETTE.walls[0]));
  gable(scene, parts, cx - 0.35, cz, 1.0, 0.75, F + 1.25, 0.42, PALETTE.roofs[0], true);
  parts.push(box(scene, 0.6, 0.6, 0.65, cx + 0.45, F + 0.3, cz + 0.05, PALETTE.walls[0]));
  gable(scene, parts, cx + 0.45, cz + 0.05, 0.6, 0.65, F + 0.6, 0.25, PALETTE.roofs[0], true);
  door(scene, parts, cx - 0.35, F, cz - 0.38, false, 0.2, 0.36);
  window_(scene, parts, cx - 0.65, F + 0.45, cz - 0.38, false, 0.14, 0.16);
  window_(scene, parts, cx - 0.15, F + 0.95, cz - 0.38, false, 0.14, 0.16);
  window_(scene, parts, cx - 0.6, F + 0.95, cz - 0.38, false, 0.14, 0.16);
  chimney(scene, parts, cx - 0.7, F + 1.25 + 0.2, cz + 0.2, 0.3);
  parts.push(box(scene, 0.22, 0.07, 0.03, cx + 0.45, F + 0.45, cz - 0.28, PALETTE.roofs[0]));
  parts.push(box(scene, 0.07, 0.22, 0.03, cx + 0.45, F + 0.45, cz - 0.28, PALETTE.roofs[0]));
  parts.push(box(scene, 0.28, 0.28, 0.02, cx + 0.45, F + 0.45, cz - 0.275, PALETTE.sail));
  return { root: mergeFlat("clinic", parts, scene) };
}

/** A tall open timber tower with X braces, a cabin at the top under a red roof, and the bell beneath it. */
function fireWatch(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  const H = 1.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = box(scene, 0.07, H, 0.07, x + sx * 0.3, F + H / 2, z + sz * 0.3, PALETTE.wood);
    leg.rotation.x = -sz * 0.06; leg.rotation.z = sx * 0.06;
    parts.push(leg);
  }
  for (const level of [0.6, 1.2]) {
    for (const sz of [-1, 1]) { const b1 = box(scene, 0.6, 0.04, 0.04, x, F + level, z + sz * 0.3, PALETTE.wood); b1.rotation.z = 0.5; parts.push(b1); const b2 = box(scene, 0.6, 0.04, 0.04, x, F + level, z + sz * 0.3, PALETTE.wood); b2.rotation.z = -0.5; parts.push(b2); }
  }
  parts.push(box(scene, 0.8, 0.06, 0.8, x, F + H, z, PALETTE.planks));
  railing(scene, parts, x - 0.4, z - 0.4, x + 0.4, z - 0.4, F + H, 0.2);
  railing(scene, parts, x - 0.4, z + 0.4, x + 0.4, z + 0.4, F + H, 0.2);
  parts.push(box(scene, 0.5, 0.4, 0.5, x, F + H + 0.2 + 0.03, z, PALETTE.walls[0]));
  window_(scene, parts, x, F + H + 0.26, z - 0.255, false, 0.16, 0.12, false);
  hip(scene, parts, x, z, 0.6, 0.6, F + H + 0.43, 0.28, PALETTE.roofs[0], 0.12);
  parts.push(cyl(scene, 0.03, 0.2, x, F + H + 0.8, z, PALETTE.wood, 4));
  const bell = MeshBuilder.CreateCylinder("bell", { diameterTop: 0.08, diameterBottom: 0.18, height: 0.18, tessellation: 6 }, scene);
  bell.position.set(x, F + H - 0.15, z);
  parts.push(tint(bell, PALETTE.lantern));
  return { root: mergeFlat("fireWatch", parts, scene) };
}

/** A shed with a timber roof, two round tanks (one rust-red, one white) and a pipe run between them. */
function treatmentPlant(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.0, 0.7, 0.9, cx + 0.35, F + 0.35, cz + 0.3, PALETTE.walls[0]));
  gable(scene, parts, cx + 0.35, cz + 0.3, 1.0, 0.9, F + 0.7, 0.32, PALETTE.planks, true);
  door(scene, parts, cx + 0.6, F, cz - 0.155, false, 0.24, 0.4);
  const tank = (x: number, z: number, s: number, hex: string) => {
    const m = MeshBuilder.CreatePolyhedron("tank", { type: 3, size: s }, scene);
    m.position.set(x, F + s * 0.9, z);
    parts.push(tint(m, hex));
  };
  tank(cx - 0.55, cz - 0.4, 0.28, PALETTE.roofs[0]);
  tank(cx - 0.5, cz + 0.35, 0.24, PALETTE.walls[0]);
  parts.push(cyl(scene, 0.05, 0.7, cx - 0.55, F + 0.3, cz, BLUE, 5).rotate(Axis.X, Math.PI / 2, Space.WORLD) as Mesh);
  parts.push(cyl(scene, 0.05, 0.9, cx - 0.55, F + 0.75, cz - 0.4, BLUE, 5));
  parts.push(cyl(scene, 0.09, 0.5, cx + 0.7, F + 1.0, cz + 0.6, STONE, 5));
  return { root: mergeFlat("treatmentPlant", parts, scene) };
}

/** After reference/services: a tall stilt tower with a blue cabin, red roof, railing, ladder and a red flag. */
function lifeguard(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  const H = 1.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.07, H, 0.07, x + sx * 0.26, F + H / 2, z + sz * 0.26, PALETTE.wood));
  for (const sz of [-1, 1]) { const br = box(scene, 0.55, 0.04, 0.04, x, F + 0.6, z + sz * 0.26, PALETTE.wood); br.rotation.z = 0.45; parts.push(br); }
  parts.push(box(scene, 0.8, 0.06, 0.8, x, F + H, z, PALETTE.planks));
  railing(scene, parts, x - 0.4, z - 0.4, x + 0.4, z - 0.4, F + H, 0.22);
  railing(scene, parts, x - 0.4, z - 0.4, x - 0.4, z + 0.4, F + H, 0.22);
  parts.push(box(scene, 0.5, 0.45, 0.45, x + 0.1, F + H + 0.03 + 0.225, z + 0.1, PALETTE.walls[0]));
  parts.push(box(scene, 0.52, 0.2, 0.47, x + 0.1, F + H + 0.03 + 0.3, z + 0.1, BLUE));
  hip(scene, parts, x + 0.1, z + 0.1, 0.5, 0.45, F + H + 0.48, 0.24, PALETTE.roofs[0], 0.12);
  for (let k = 0; k < 6; k++) parts.push(box(scene, 0.22, 0.03, 0.04, x - 0.36, F + 0.15 + k * 0.2, z - 0.42, PALETTE.wood));
  parts.push(cyl(scene, 0.03, 0.6, x + 0.1, F + H + 0.72 + 0.3, z + 0.1, PALETTE.wood, 4));
  parts.push(box(scene, 0.26, 0.16, 0.02, x + 0.24, F + H + 0.72 + 0.5, z + 0.1, PALETTE.roofs[0]));
  return { root: mergeFlat("lifeguard", parts, scene) };
}

// ---------- leisure ----------

/** A low white house with a shingle roof, two steaming chimneys and a round blue pool in front. */
function bathhouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.2, 0.65, 0.7, cx + 0.2, F + 0.325, cz + 0.15, PALETTE.walls[0]));
  gable(scene, parts, cx + 0.2, cz + 0.15, 1.2, 0.7, F + 0.65, 0.3, PALETTE.planks, true);
  chimney(scene, parts, cx - 0.25, F + 0.65 + 0.15, cz + 0.15, 0.3, PALETTE.walls[0]);
  chimney(scene, parts, cx + 0.65, F + 0.65 + 0.15, cz + 0.15, 0.3, PALETTE.walls[0]);
  door(scene, parts, cx + 0.2, F, cz - 0.205, false, 0.18, 0.32);
  window_(scene, parts, cx + 0.6, F + 0.4, cz - 0.205, false, 0.13, 0.13);
  parts.push(cyl(scene, 0.6, 0.14, cx - 0.55, F + 0.07, cz - 0.15, STONE_LIGHT, 10));
  parts.push(cyl(scene, 0.5, 0.03, cx - 0.55, F + 0.15, cz - 0.15, "#3f8fa8", 10));
  return { root: mergeFlat("bathhouse", parts, scene) };
}

/** After reference/leisure: a tall narrow inn, blue roof, a red lean-to, a hanging sign and lanterns. */
function tavern(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 0.8, 1.45, 0.72, cx - 0.35, F + 0.725, cz, PALETTE.walls[0]));
  gable(scene, parts, cx - 0.35, cz, 0.8, 0.72, F + 1.45, 0.45, BLUE, false);
  chimney(scene, parts, cx - 0.35, F + 1.45 + 0.3, cz + 0.25, 0.3, PALETTE.walls[0]);
  parts.push(box(scene, 0.7, 0.62, 0.6, cx + 0.4, F + 0.31, cz + 0.05, PALETTE.walls[0]));
  gable(scene, parts, cx + 0.4, cz + 0.05, 0.7, 0.6, F + 0.62, 0.26, PALETTE.roofs[0], true);
  door(scene, parts, cx - 0.35, F, cz - 0.365, false, 0.2, 0.36);
  window_(scene, parts, cx - 0.35, F + 0.75, cz - 0.365, false, 0.14, 0.16);
  window_(scene, parts, cx - 0.35, F + 1.15, cz - 0.365, false, 0.12, 0.14);
  window_(scene, parts, cx + 0.4, F + 0.35, cz - 0.255, false, 0.14, 0.14);
  // The hanging sign and a barrel.
  parts.push(box(scene, 0.3, 0.03, 0.03, cx - 0.35 - 0.4 - 0.12, F + 1.05, cz - 0.2, PALETTE.wood));
  parts.push(box(scene, 0.28, 0.16, 0.03, cx - 0.35 - 0.4 - 0.2, F + 0.93, cz - 0.2, PALETTE.planks));
  barrel(scene, parts, cx + 0.75, F, cz - 0.45, 0.2);
  const lantern = bracketLantern(scene, parts, cx - 0.35 + 0.4, F + 0.95, cz - 0.3, 1, 0);
  return { root: mergeFlat("tavern", parts, scene), lantern };
}

/** A red pillar shrine on a stone step, a little roof, a crossbar with paper streamers, lanterns. */
function shrine(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  parts.push(box(scene, 0.6, 0.08, 0.5, x, F + 0.04, z, STONE_LIGHT));
  parts.push(box(scene, 0.4, 0.08, 0.36, x, F + 0.12, z, STONE_LIGHT));
  parts.push(cyl(scene, 0.16, 0.7, x, F + 0.16 + 0.35, z, PALETTE.roofs[2], 6));
  parts.push(box(scene, 0.7, 0.04, 0.04, x, F + 0.7, z, PALETTE.wood));
  for (const t of [-0.28, -0.14, 0.14, 0.28]) parts.push(box(scene, 0.05, 0.16, 0.01, x + t, F + 0.6, z, PALETTE.sail));
  hip(scene, parts, x, z, 0.3, 0.28, F + 0.86, 0.18, "#4c5a66", 0.1);
  const lantern = bracketLantern(scene, parts, x - 0.3, F + 0.7, z, -1, 0);
  parts.push(box(scene, 0.03, 0.06, 0.03, x + 0.33, F + 0.66, z, PALETTE.wood));
  return { root: mergeFlat("shrine", parts, scene), lantern };
}

/** A square of flagstones with a bench under a red awning and a flower tub; walkers loiter here. */
function marketSquare(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) parts.push(box(scene, 0.44, 0.03, 0.44, cx - 0.72 + i * 0.48, F + 0.015, cz - 0.72 + j * 0.48, (i + j) % 2 ? STONE_LIGHT : "#a8a59d"));
  // Bench under a small red awning on posts.
  for (const sx of [-1, 1]) parts.push(cyl(scene, 0.06, 0.8, cx - 0.5 + sx * 0.35, F + 0.4, cz - 0.55, PALETTE.wood, 5));
  const awning = box(scene, 0.9, 0.04, 0.5, cx - 0.5, F + 0.82, cz - 0.55, PALETTE.roofs[0]); awning.rotation.x = 0.25; parts.push(awning);
  parts.push(box(scene, 0.6, 0.04, 0.2, cx - 0.5, F + 0.22, cz - 0.6, PALETTE.planks));
  parts.push(box(scene, 0.6, 0.18, 0.04, cx - 0.5, F + 0.32, cz - 0.5, PALETTE.planks));
  for (const sx of [-1, 1]) parts.push(box(scene, 0.04, 0.22, 0.2, cx - 0.5 + sx * 0.28, F + 0.11, cz - 0.6, PALETTE.wood));
  // A flower tub and a basin.
  parts.push(cyl(scene, 0.3, 0.2, cx + 0.5, F + 0.1, cz + 0.5, PALETTE.wood, 7));
  parts.push(MeshBuilder.CreateSphere("bloom", { diameter: 0.26, segments: 3 }, scene));
  parts[parts.length - 1].position.set(cx + 0.5, F + 0.28, cz + 0.5); tint(parts[parts.length - 1], "#79ad5e");
  parts.push(cyl(scene, 0.44, 0.14, cx - 0.5, F + 0.07, cz + 0.5, STONE_LIGHT, 8));
  parts.push(cyl(scene, 0.36, 0.02, cx - 0.5, F + 0.15, cz + 0.5, "#3f8fa8", 8));
  return { root: mergeFlat("marketSquare", parts, scene) };
}

/** A two-storey white house with a blue roof, a balcony on posts and lanterns either side of the door. */
function inn(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 1.3, 1.35, 1.1, cx - 0.15, F + 0.675, cz + 0.1, PALETTE.walls[0]));
  gable(scene, parts, cx - 0.15, cz + 0.1, 1.3, 1.1, F + 1.35, 0.5, BLUE, true, 0.16);
  chimney(scene, parts, cx - 0.55, F + 1.35 + 0.25, cz + 0.3, 0.3, PALETTE.walls[0]);
  door(scene, parts, cx - 0.15, F, cz - 0.455, false, 0.22, 0.38);
  window_(scene, parts, cx - 0.6, F + 0.45, cz - 0.455, false, 0.15, 0.16);
  window_(scene, parts, cx + 0.3, F + 0.45, cz - 0.455, false, 0.15, 0.16);
  window_(scene, parts, cx - 0.5, F + 1.0, cz - 0.455, false, 0.14, 0.16);
  window_(scene, parts, cx + 0.2, F + 1.0, cz - 0.455, false, 0.14, 0.16);
  // The balcony on the +x side.
  parts.push(box(scene, 0.5, 0.05, 0.9, cx + 0.75, F + 0.7, cz + 0.1, PALETTE.planks));
  railing(scene, parts, cx + 0.98, cz - 0.33, cx + 0.98, cz + 0.53, F + 0.72, 0.22);
  for (const t of [-0.35, 0.35]) parts.push(cyl(scene, 0.06, 0.7, cx + 0.95, F + 0.35, cz + 0.1 + t, PALETTE.wood, 5));
  door(scene, parts, cx + 0.505, F + 0.72, cz + 0.1, true, 0.18, 0.32);
  const lantern = bracketLantern(scene, parts, cx + 0.15, F + 0.55, cz - 0.45, 0, -1);
  return { root: mergeFlat("inn", parts, scene), lantern };
}

// ---------- damage, dispatch, signatures ----------

/** Damage shows as a lean and a scorched tint. The tint is baked into the vertex colours so a damaged building
 *  still shares the one flat material and merges into its chunk. */
/** Kinds whose factory reads its orientation off the footprint cells: the footprint turns, the mesh needn't. */
const CELL_ORIENTED: ReadonlySet<string> = new Set(["clamCamp", "lumberCamp"]);

/** Swing the built (unturned) mesh onto its turned footprint: a yaw about the footprint centre, baked into the vertices. */
function turn(m: BuildingMeshes, b: Building): void {
  const { cx, cz } = bounds(b.cells);
  const matrix = Matrix.Translation(-cx, 0, -cz).multiply(Matrix.RotationY(b.rot * Math.PI / 2)).multiply(Matrix.Translation(cx, 0, cz));
  m.root.bakeTransformIntoVertices(matrix);
  if (m.lantern) m.lantern.position.copyFrom(Vector3.TransformCoordinates(m.lantern.position, matrix));
}

/** Whether a piece that needs the street is off it: a street piece, a home or a workplace the network does not reach (or one cut by the spring tide). Roots — piers, docks, harbors — are the street's start and never count. */
function unreached(b: Building): boolean {
  const def = BUILDINGS[b.kind];
  if (def.network === "root") return false;
  return !b.reached && (def.network === "link" || def.residents > 0 || def.workers > 0);
}

/** An unreached piece fades toward bare, sun-bleached wood, so a gap in the street reads at a glance. */
function applyUnreached(b: Building, m: BuildingMeshes): BuildingMeshes {
  if (!unreached(b)) return m;
  const colors = m.root.getVerticesData(VertexBuffer.ColorKind);
  if (colors) {
    for (let i = 0; i < colors.length; i += 4) { colors[i] = colors[i] * 0.5 + 0.44; colors[i + 1] = colors[i + 1] * 0.5 + 0.43; colors[i + 2] = colors[i + 2] * 0.5 + 0.4; }
    m.root.updateVerticesData(VertexBuffer.ColorKind, colors);
  }
  return m;
}

function applyDamage(scene: Scene, b: Building, m: BuildingMeshes): BuildingMeshes {
  if (!b.damaged) return m;
  void scene;
  const { cx, cz } = bounds(b.cells);
  m.root.setPivotPoint(new Vector3(cx, b.floorY, cz));
  m.root.rotation.z = 0.09;
  m.root.rotation.x = -0.05;
  const colors = m.root.getVerticesData(VertexBuffer.ColorKind);
  if (colors) {
    for (let i = 0; i < colors.length; i += 4) { colors[i] *= 0.45; colors[i + 1] *= 0.42; colors[i + 2] *= 0.4; }
    m.root.updateVerticesData(VertexBuffer.ColorKind, colors);
  }
  return m;
}

// ---------- the Fjord's kinds (BIOMES.md §3.3) ----------

/** Stockfish racks: two A-frame drying racks hung with pale split fish, a salt barrel between them. */
function stockfishRacks(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  for (const rx of [-0.5, 0.5]) {
    for (const sz of [-0.32, 0.32]) {
      const legA = box(scene, 0.05, 0.9, 0.05, rx + cx - 0.14, F + 0.42, cz + sz, PALETTE.wood); legA.rotation.z = 0.28; parts.push(legA);
      const legB = box(scene, 0.05, 0.9, 0.05, rx + cx + 0.14, F + 0.42, cz + sz, PALETTE.wood); legB.rotation.z = -0.28; parts.push(legB);
    }
    parts.push(box(scene, 0.06, 0.06, 0.78, cx + rx, F + 0.86, cz, PALETTE.wood));
    for (let k = 0; k < 5; k++) {
      const fish = box(scene, 0.04, 0.26, 0.08, cx + rx + (k % 2 ? 0.05 : -0.05), F + 0.7, cz - 0.28 + k * 0.14, k % 3 ? "#e6dccb" : "#d9c9a5");
      fish.rotation.x = 0.15;
      parts.push(fish);
    }
  }
  barrel(scene, parts, cx, F, cz + 0.32, 0.2);
  crate(scene, parts, cx, F, cz - 0.34, 0.18);
  return { root: mergeFlat("stockfishRacks", parts, scene) };
}

/** Whaling station: a long tarred shed on a heavy quay, a flensing deck with a winch and a hoist, blubber barrels. */
function whalingStation(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, w - 0.02, 0.12, d - 0.02, cx, F - 0.06, cz, PALETTE.planks)];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, cx + sx * (w / 2 - 0.2), cz + sz * (d / 2 - 0.15), F - 0.12, 0.16, 6));
  parts.push(box(scene, 1.7, 0.85, 1.0, cx - 0.55, F + 0.425, cz + 0.35, "#3d2e26"));
  gable(scene, parts, cx - 0.55, cz + 0.35, 1.7, 1.0, F + 0.85, 0.7, "#2b2b2b", true, 0.16);
  chimney(scene, parts, cx - 1.1, F + 1.2, cz + 0.55, 0.5, STONE);
  door(scene, parts, cx - 0.3, F, cz + 0.35 - 0.505, false, 0.34, 0.6);
  window_(scene, parts, cx - 0.95, F + 0.5, cz + 0.35 - 0.505, false, 0.16, 0.14, false);
  // The flensing deck: a dark stain, a winch drum, a hoist frame with a hook, barrels of oil.
  parts.push(box(scene, 1.0, 0.02, 0.9, cx + 0.8, F + 0.01, cz - 0.3, "#4a3a30"));
  parts.push(cyl(scene, 0.32, 0.22, cx + 0.5, F + 0.11, cz - 0.55, PALETTE.wood, 8).rotate(Axis.X, Math.PI / 2, Space.WORLD) as Mesh);
  for (const sx of [-0.35, 0.35]) parts.push(box(scene, 0.06, 1.3, 0.06, cx + 1.05 + sx, F + 0.65, cz - 0.15, PALETTE.wood));
  parts.push(box(scene, 0.8, 0.06, 0.06, cx + 1.05, F + 1.3, cz - 0.15, PALETTE.wood));
  parts.push(box(scene, 0.015, 0.6, 0.015, cx + 1.05, F + 1.0, cz - 0.15, ROPE));
  parts.push(box(scene, 0.08, 0.1, 0.04, cx + 1.05, F + 0.66, cz - 0.15, "#4c5a66"));
  barrel(scene, parts, cx + 0.25, F, cz - 0.05, 0.22); barrel(scene, parts, cx + 0.5, F, cz + 0.15, 0.22); barrel(scene, parts, cx + 0.75, F, cz + 0.4, 0.2);
  for (const sx of [-1, 1]) bollard(scene, parts, cx + sx * (w / 2 - 0.2), F, cz - d / 2 + 0.15, "#8a3f33");
  const lantern = bracketLantern(scene, parts, cx - 0.3 + 0.3, F + 0.6, cz + 0.35 - 0.46, 0, -1);
  return { root: mergeFlat("whalingStation", parts, scene), lantern };
}

/** Iron mine: a timbered adit into the hill, rails out to a tipping cart, a spoil heap and a lamp on the frame. */
function ironMine(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F, 0.15);
  // The adit: a dark mouth framed in heavy timber, set into a rock face.
  parts.push(rock(scene, cx - 0.4, F + 0.35, cz + 0.45, 1.1, STONE, 3));
  parts.push(box(scene, 0.6, 0.62, 0.3, cx - 0.4, F + 0.31, cz + 0.05, "#1c1a1a"));
  for (const sx of [-0.33, 0.33]) parts.push(box(scene, 0.08, 0.7, 0.1, cx - 0.4 + sx, F + 0.35, cz - 0.05, PALETTE.wood));
  parts.push(box(scene, 0.8, 0.09, 0.12, cx - 0.4, F + 0.72, cz - 0.05, PALETTE.wood));
  // Rails and the cart.
  for (const sz of [-0.09, 0.09]) parts.push(box(scene, 1.4, 0.02, 0.03, cx + 0.1, F + 0.02, cz - 0.3 + sz, "#4c5a66"));
  parts.push(box(scene, 0.34, 0.2, 0.24, cx + 0.5, F + 0.16, cz - 0.3, "#4c5a66"));
  parts.push(box(scene, 0.3, 0.06, 0.2, cx + 0.5, F + 0.28, cz - 0.3, "#8a6a5a"));
  // Spoil heap and a stack of ore.
  parts.push(rock(scene, cx + 0.65, F + 0.05, cz + 0.5, 0.6, "#5d5854", 5));
  parts.push(rock(scene, cx + 0.3, F + 0.02, cz + 0.7, 0.35, "#7a5a4a", 2));
  const lantern = bracketLantern(scene, parts, cx - 0.4, F + 0.62, cz - 0.12, 0, -1);
  return { root: mergeFlat("ironMine", parts, scene), lantern };
}

/** Ice house: a squat stone store with a turf roof and a low door; sawdust barrels and blocks of ice by the step. */
function iceHouse(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, x, z, 1, 1, F);
  parts.push(box(scene, 0.7, 0.42, 0.62, x, F + 0.21, z, STONE));
  parts.push(box(scene, 0.72, 0.03, 0.64, x, F + 0.2, z, STONE_LIGHT));
  hip(scene, parts, x, z, 0.7, 0.62, F + 0.42, 0.24, "#3f7346", 0.12);
  parts.push(box(scene, 0.2, 0.26, 0.03, x - 0.1, F + 0.13, z - 0.32, PALETTE.wood));
  for (const [dx, dz] of [[0.42, -0.2], [0.42, 0.1]]) parts.push(box(scene, 0.16, 0.16, 0.16, x + dx, F + 0.08, z + dz, "#d5e6ea"));
  barrel(scene, parts, x - 0.4, F, z + 0.2, 0.18);
  return { root: mergeFlat("iceHouse", parts, scene) };
}

/** Ice-breaker pier: the pier with an iron-shod prow at its seaward end, a brazier, and a heavier pile every bay. */
function iceBreakerPier(scene: Scene, b: Building): BuildingMeshes {
  const base = pier(scene, b);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  const alongX = a.z === s.z;
  const dir = Math.sign(alongX ? s.x - a.x : s.z - a.z) || 1;
  const F = b.floorY;
  const parts: Mesh[] = [base.root];
  // The prow: an iron wedge past the end of the deck, pointing seaward, down to the water.
  const px = alongX ? s.x + dir * 0.6 : s.x, pz = alongX ? s.z : s.z + dir * 0.6;
  const prow = MeshBuilder.CreateCylinder("prow", { diameterTop: 0, diameterBottom: 0.7, height: 0.9, tessellation: 3 }, scene);
  prow.rotation.z = alongX ? -dir * Math.PI / 2 : 0;
  prow.rotation.x = alongX ? 0 : dir * Math.PI / 2;
  prow.position.set(px, F - 0.35, pz);
  parts.push(tint(prow, "#4c5a66"));
  for (let k = 0; k < b.cells.length; k++) {
    const c = cellCenter(b.cells[k]);
    parts.push(box(scene, alongX ? 0.9 : 0.06, 0.06, alongX ? 0.06 : 0.9, c.x, F + 0.03, c.z + (alongX ? 0.44 : 0), "#4c5a66"));
  }
  // A brazier on the root end keeps the crew's hands warm: a stone bowl with an ember cone.
  parts.push(cyl(scene, 0.22, 0.16, a.x - (alongX ? dir * 0.2 : 0.3), F + 0.08, a.z - (alongX ? 0.3 : dir * 0.2), STONE, 6));
  parts.push(cyl(scene, 0.14, 0.1, a.x - (alongX ? dir * 0.2 : 0.3), F + 0.2, a.z - (alongX ? 0.3 : dir * 0.2), "#ff6a2a", 5, 0));
  return { root: mergeFlat("iceBreakerPier", parts, scene) };
}

// ---------- the Atoll's kinds (BIOMES.md §3.2) ----------

/** Dive platform: a small raft deck on four poles in the lagoon, a ladder down, a diving rope and a basket of shell. */
function divePlatform(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [box(scene, 0.86, 0.08, 0.86, x, F - 0.04, z, PALETTE.planks)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(stilt(scene, x + sx * 0.36, z + sz * 0.36, F - 0.06, 0.08, 5));
  railing(scene, parts, x - 0.4, z - 0.4, x + 0.4, z - 0.4, F, 0.24);
  railing(scene, parts, x - 0.4, z - 0.4, x - 0.4, z + 0.4, F, 0.24);
  for (let k = 0; k < 3; k++) parts.push(box(scene, 0.04, 0.03, 0.2, x + 0.44, F - 0.12 - k * 0.14, z + 0.15, PALETTE.wood));
  parts.push(box(scene, 0.06, 0.6, 0.06, x + 0.3, F + 0.3, z + 0.3, PALETTE.wood));
  parts.push(box(scene, 0.015, 0.5, 0.015, x + 0.3, F + 0.05, z + 0.42, ROPE));
  crate(scene, parts, x - 0.25, F, z + 0.2, 0.2);
  parts.push(rock(scene, x - 0.25, F + 0.2, z + 0.2, 0.16, "#f7f1e3", 4));
  const lantern = postLantern(scene, parts, x - 0.32, z - 0.3, F);
  return { root: mergeFlat("divePlatform", parts, scene), lantern };
}

/** Pearl house: a thatched shed with a wide grading table under an awning, shell heaps, and a strongbox. */
function pearlHouse(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  parts.push(box(scene, 0.9, 0.7, 0.7, cx - 0.4, F + 0.35, cz, PALETTE.walls[0]));
  gable(scene, parts, cx - 0.4, cz, 0.9, 0.7, F + 0.7, 0.45, PALETTE.roofs[0], true, 0.18);
  door(scene, parts, cx - 0.4, F, cz - 0.355, false, 0.2, 0.36);
  // The awning and the table: pearls are graded in the shade.
  for (const sz of [-0.3, 0.3]) parts.push(box(scene, 0.05, 0.62, 0.05, cx + 0.55, F + 0.31, cz + sz, PALETTE.wood));
  parts.push(box(scene, 0.7, 0.03, 0.8, cx + 0.35, F + 0.64, cz, PALETTE.roofs[0]));
  parts.push(box(scene, 0.5, 0.04, 0.5, cx + 0.4, F + 0.3, cz, PALETTE.planks));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(scene, 0.04, 0.3, 0.04, cx + 0.4 + sx * 0.22, F + 0.15, cz + sz * 0.22, PALETTE.wood));
  for (let k = 0; k < 5; k++) parts.push(rock(scene, cx + 0.3 + (k % 3) * 0.1, F + 0.34, cz - 0.15 + Math.floor(k / 3) * 0.14, 0.05, "#f7f1e3", k));
  parts.push(rock(scene, cx + 0.05, F + 0.05, cz + 0.55, 0.28, "#e6dccb", 6));
  parts.push(box(scene, 0.22, 0.14, 0.16, cx - 0.05, F + 0.07, cz - 0.55, "#4c5a66"));
  const lantern = bracketLantern(scene, parts, cx - 0.05, F + 0.55, cz - 0.31, 0, -1);
  return { root: mergeFlat("pearlHouse", parts, scene), lantern };
}

/** Coconut grove: an open shelter of poles with a thatch, baskets of coconuts, a husking spike. */
function coconutGrove(scene: Scene, b: Building): BuildingMeshes {
  const { cx, cz, w, d } = bounds(b.cells); // cell-oriented, like the clam camp
  const F = b.floorY;
  const parts: Mesh[] = [];
  deck(scene, parts, cx, cz, w, d, F);
  const a = cellCenter(b.cells[0]), s = cellCenter(b.cells[b.cells.length - 1]);
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.3, 0.3]) parts.push(box(scene, 0.05, 0.8, 0.05, a.x + sx, F + 0.4, a.z + sz, PALETTE.wood));
  hip(scene, parts, a.x, a.z, 0.85, 0.85, F + 0.8, 0.3, PALETTE.roofs[0], 0.12);
  for (const [dx, dz] of [[-0.2, 0.1], [0.15, -0.15], [0.2, 0.2]]) {
    parts.push(cyl(scene, 0.24, 0.16, s.x + dx, F + 0.08, s.z + dz, "#b9a377", 6));
    for (let k = 0; k < 3; k++) parts.push(rock(scene, s.x + dx + (k - 1) * 0.06, F + 0.2, s.z + dz + (k % 2) * 0.05, 0.07, "#a98a55", k));
  }
  const spike = box(scene, 0.04, 0.5, 0.04, s.x - 0.3, F + 0.25, s.z - 0.3, PALETTE.wood);
  parts.push(spike);
  parts.push(box(scene, 0.02, 0.12, 0.02, s.x - 0.3, F + 0.55, s.z - 0.3, "#4c5a66"));
  return { root: mergeFlat("coconutGrove", parts, scene) };
}

/** Reef nursery: a floating frame of racks with coral fragments in the lagoon, buoys at the corners. */
function reefNursery(scene: Scene, b: Building): BuildingMeshes {
  const { x, z } = cellCenter(b.cells[0]);
  const F = b.floorY;
  const parts: Mesh[] = [];
  for (const sx of [-0.35, 0.35]) parts.push(box(scene, 0.06, 0.06, 0.86, x + sx, F - 0.02, z, PALETTE.wood));
  for (const sz of [-0.35, 0.35]) parts.push(box(scene, 0.86, 0.06, 0.06, x, F - 0.02, z + sz, PALETTE.wood));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(scene, 0.12, 0.12, x + sx * 0.38, F + 0.03, z + sz * 0.38, "#e0705a", 6));
  // Racks of fragments: three bars across, with small branching bits standing up.
  for (const sz of [-0.2, 0, 0.2]) {
    parts.push(box(scene, 0.7, 0.03, 0.03, x, F + 0.02, z + sz, PALETTE.planks));
    for (let k = 0; k < 4; k++) parts.push(box(scene, 0.04, 0.12, 0.04, x - 0.27 + k * 0.18, F + 0.09, z + sz, k % 2 ? "#e0705a" : "#f7f1e3"));
  }
  parts.push(box(scene, 0.04, 0.5, 0.04, x - 0.4, F + 0.2, z - 0.4, PALETTE.wood));
  parts.push(box(scene, 0.12, 0.08, 0.02, x - 0.34, F + 0.4, z - 0.4, "#f7f1e3"));
  return { root: mergeFlat("reefNursery", parts, scene) };
}

export function createBuildingMeshes(scene: Scene, b: Building, grid: Grid): BuildingMeshes {
  const m = buildMeshes(scene, b, grid);
  if (b.rot && !CELL_ORIENTED.has(b.kind) && mayTurn(b.kind)) turn(m, b); // older saves hold turned walkways
  return applyUnreached(b, applyDamage(scene, b, m));
}

function buildMeshes(scene: Scene, b: Building, grid: Grid): BuildingMeshes {
  switch (b.kind) {
    case "walkway": return walkway(scene, b, grid);
    case "raisedWalkway": return raisedWalkway(scene, b, grid);
    case "path": return path(scene, b, grid);
    case "fireWatch": return fireWatch(scene, b);
    case "breakwater": return breakwater(scene, b);
    case "seaWall": return seaWall(scene, b);
    case "outfall": return outfall(scene, b);
    case "treatmentPlant": return treatmentPlant(scene, b);
    case "clinic": return clinic(scene, b);
    case "lifeguard": return lifeguard(scene, b);
    case "sharkNet": return sharkNet(scene, b);
    case "harbor": return harbor(scene, b);
    case "inn": return inn(scene, b);
    case "lighthouse": return lighthouse(scene, b);
    case "well": return well(scene, b);
    case "bathhouse": return bathhouse(scene, b);
    case "tavern": return tavern(scene, b);
    case "shrine": return shrine(scene, b);
    case "marketSquare": return marketSquare(scene, b);
    case "hut": return home(scene, b, 0.62, 0.6);
    case "house": return home(scene, b, 0.78, 0.9);
    case "tallHouse": return home(scene, b, 0.66, 1.55);
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
    case "toolworks": return toolworks(scene, b);
    case "stockfishRacks": return stockfishRacks(scene, b);
    case "whalingStation": return whalingStation(scene, b);
    case "ironMine": return ironMine(scene, b);
    case "iceHouse": return iceHouse(scene, b);
    case "iceBreakerPier": return iceBreakerPier(scene, b);
    case "divePlatform": return divePlatform(scene, b);
    case "pearlHouse": return pearlHouse(scene, b);
    case "coconutGrove": return coconutGrove(scene, b);
    case "reefNursery": return reefNursery(scene, b);
    default: {
      // The later coasts' kinds live in view/pieces/ (one file per coast), built from the kit below.
      const f = COAST_PIECES[b.kind];
      if (!f) throw new Error(`no mesh for ${b.kind}`);
      return f(scene, b, grid);
    }
  }
}

/**
 * The primitives and pieces every factory is built from, for the coasts' files in view/pieces/: the palette's
 * mutable accents are read through `accents()` at build time, as the factories here read them.
 */
export const KIT = {
  box, cyl, pyramid, rock, gable, hip, window_, door, railing, chimney, crate, barrel, bollard, bracketLantern, postLantern,
  deck, shed, net, logPile, stilt, bounds, pier, sharkNet, lifeguard, bathhouse, homeRoof,
  accents: () => ({ blue: BLUE, trim: TRIM, stone: STONE, stoneLight: STONE_LIGHT, glass: GLASS, rope: ROPE }),
};

/** Everything about a building that changes its mesh; the view rebuilds when this changes. Street pieces also
 *  depend on what stands beside them. */
export function meshSignature(b: Building, grid: Grid): string {
  const joins = b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path" ? ":" + joinKey(b, grid) : "";
  return `${b.kind}:${b.level}:${b.lantern ? 1 : 0}:${b.damaged ? 1 : 0}:${unreached(b) ? 0 : 1}:${b.rot}${joins}`;
}

/** Whether the building's lantern should glow: homes need residents, everything else just a connection. */
export function lanternOn(b: Building): boolean {
  return b.reached && !b.cut && !b.damaged && (BUILDINGS[b.kind].residents === 0 || b.residents > 0);
}
