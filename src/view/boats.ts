// Boats as thin instances: hulls (per-instance colour) and sails (one draw call each). Positions are a pure
// function of sim state and view time: moored at their harbour, heeled on the mud when the water is gone, or
// along the deep-water path to the harbour's ground while the sim says they're at sea. View only.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { HIGH_WATER_MARK, LOW_WATER_MARK } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellCenter, Grid } from "../sim/grid";
import { terrainHeight } from "../sim/heightfield";
import { seaPath } from "../sim/sea";
import { Building, Cell, SimState } from "../sim/state";
import { phaseProgress } from "../sim/tide";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";
import { PALETTE } from "./buildings";

const DRAFT = 0.12;
const HEEL = 0.42; // radians, resting on the mud
const OUT = 0.3, BACK = 0.7; // trip fractions: leaving, fishing, returning

export interface BoatPose { x: number; z: number; atSea: boolean; moored: boolean }

interface Instance { pos: Vector3; yaw: number; roll: number; color: Color4 }

export class Boats {
  private readonly hull: Mesh;
  private readonly sail: Mesh;
  private readonly paths = new Map<string, Vector3[]>();
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private sailMatrices = new Float32Array(0);
  poses: BoatPose[] = [];

  constructor(scene: Scene, private readonly grid: Grid) {
    // Hull: a box with a wedge bow, tinted white so the instance colour is the hull colour.
    const hullParts: Mesh[] = [];
    const body = MeshBuilder.CreateBox("hb", { width: 0.9, height: 0.22, depth: 0.42 }, scene);
    body.position.set(-0.1, 0.11, 0);
    hullParts.push(tint(body, "#ffffff"));
    const bow = MeshBuilder.CreateCylinder("bow", { diameterTop: 0.42, diameterBottom: 0.42, height: 0.22, tessellation: 3 }, scene);
    bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 2;
    bow.position.set(0.42, 0.11, 0);
    bow.scaling.set(1, 0.7, 1);
    hullParts.push(tint(bow, "#ffffff"));
    const gunwale = MeshBuilder.CreateBox("gw", { width: 0.7, height: 0.05, depth: 0.3 }, scene);
    gunwale.position.set(-0.1, 0.245, 0);
    hullParts.push(tint(gunwale, "#ffffff"));
    this.hull = mergeFlat("boatHulls", hullParts, scene);
    const hullMat = flatMaterial(scene).clone("boatHullMat") as StandardMaterial;
    this.hull.material = hullMat;

    // Sail and mast, fixed colours.
    const sailParts: Mesh[] = [];
    const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.04, height: 0.9, tessellation: 4 }, scene);
    mast.position.set(0, 0.67, 0);
    sailParts.push(tint(mast, PALETTE.wood));
    const sail = MeshBuilder.CreateCylinder("sail", { diameterTop: 0, diameterBottom: 0.7, height: 0.72, tessellation: 3 }, scene);
    sail.rotation.z = -Math.PI / 2; sail.rotation.x = Math.PI / 2;
    sail.position.set(-0.28, 0.6, 0.03);
    sail.scaling.set(1, 1, 0.08);
    sailParts.push(tint(sail, PALETTE.sail));
    this.sail = mergeFlat("boatSails", sailParts, scene);

    for (const m of [this.hull, this.sail]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
  }

  private pathFor(harbour: Building, ground: Cell): Vector3[] {
    const key = `${harbour.id}:${ground.i},${ground.j}`;
    let p = this.paths.get(key);
    if (!p) {
      p = seaPath(this.grid, harbour, ground).map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); });
      this.paths.set(key, p);
    }
    return p;
  }

  /** Mooring positions alongside the harbour's deck. */
  private moorings(h: Building): { x: number; z: number; yaw: number }[] {
    const out: { x: number; z: number; yaw: number }[] = [];
    const slots = BUILDINGS[h.kind].slots ?? 0;
    if (h.kind === "pier") {
      const a = cellCenter(h.cells[0]), s = cellCenter(h.cells[h.cells.length - 1]);
      const alongX = a.z === s.z;
      for (let k = 0; k < slots; k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const along = (a.x + s.x) / 2 + (alongX ? 0 : 0), alongZ = (a.z + s.z) / 2;
        out.push(alongX
          ? { x: along + (k >= 2 ? 0.6 : -0.2), z: alongZ + side * 0.78, yaw: 0 }
          : { x: (a.x + s.x) / 2 + side * 0.78, z: alongZ + (k >= 2 ? 0.6 : -0.2), yaw: Math.PI / 2 });
      }
    } else {
      const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const w = Math.max(...is) - Math.min(...is) + 1, d = Math.max(...js) - Math.min(...js) + 1;
      const sides = [
        { x: cx - w / 2 - 0.5, z: cz - 0.35, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz + 0.35, yaw: Math.PI / 2 },
        { x: cx - 0.35, z: cz - d / 2 - 0.5, yaw: 0 }, { x: cx + 0.35, z: cz + d / 2 + 0.5, yaw: 0 },
        { x: cx - w / 2 - 0.5, z: cz + 0.6, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz - 0.6, yaw: Math.PI / 2 },
      ];
      for (let k = 0; k < slots; k++) out.push(sides[k % sides.length]);
    }
    return out;
  }

  sync(state: SimState, viewTime: number): void {
    const level = state.tide.level;
    const instances: Instance[] = [];
    const poses: BoatPose[] = [];
    let colorIndex = 0;
    for (const h of Object.values(state.buildings)) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
      const moorings = this.moorings(h);
      const path = h.atSea && h.ground ? this.pathFor(h, h.ground) : null;
      const u = h.atSea ? phaseProgress(state.tide, HIGH_WATER_MARK, LOW_WATER_MARK) : 0;
      for (let k = 0; k < h.boats; k++) {
        const color = Color4.FromHexString(PALETTE.hulls[(colorIndex++) % PALETTE.hulls.length]);
        if (path && path.length > 1) {
          // Along the path out, loitering at the ground, and back; boats fan out a little across the track.
          let s: number, drift = 0;
          if (u < OUT) s = u / OUT;
          else if (u < BACK) { s = 1; drift = (u - OUT) / (BACK - OUT); }
          else s = 1 - (u - BACK) / (1 - BACK);
          const idx = s * (path.length - 1);
          const i0 = Math.min(path.length - 2, Math.floor(idx)), f = idx - i0;
          const a = path[i0], b = path[i0 + 1];
          const dir = b.subtract(a); dir.y = 0;
          const heading = Math.atan2(dir.x, dir.z);
          const side = (k - (h.boats - 1) / 2) * 0.7;
          const px = a.x + (b.x - a.x) * f + Math.cos(heading) * side + Math.sin(drift * Math.PI * 2 + k) * 0.6 * (s === 1 ? 1 : 0);
          const pz = a.z + (b.z - a.z) * f - Math.sin(heading) * side + Math.cos(drift * Math.PI * 2 + k) * 0.6 * (s === 1 ? 1 : 0);
          const yaw = (u >= BACK ? heading + Math.PI : heading) + (s === 1 ? drift * Math.PI * 2 : 0);
          instances.push({ pos: new Vector3(px, level + waveHeight(px, pz, viewTime) - DRAFT * 0.3, pz), yaw, roll: 0.04 * Math.sin(viewTime * 1.3 + k), color });
          poses.push({ x: px, z: pz, atSea: true, moored: false });
        } else {
          const m = moorings[k % moorings.length];
          const bed = terrainHeight(m.x, m.z);
          const afloat = level - bed > DRAFT;
          const y = afloat ? level + waveHeight(m.x, m.z, viewTime) - DRAFT * 0.3 : bed + 0.05;
          const roll = afloat ? 0.03 * Math.sin(viewTime * 1.1 + k * 2) : HEEL * (k % 2 === 0 ? 1 : -1);
          instances.push({ pos: new Vector3(m.x, y, m.z), yaw: m.yaw, roll, color });
          poses.push({ x: m.x, z: m.z, atSea: false, moored: true });
        }
      }
    }
    this.poses = poses;
    this.write(instances);
  }

  private write(instances: Instance[]): void {
    const n = instances.length;
    if (this.matrices.length !== n * 16) {
      this.matrices = new Float32Array(n * 16);
      this.sailMatrices = new Float32Array(n * 16);
      this.colors = new Float32Array(n * 4);
    }
    const scale = new Vector3(1, 1, 1);
    for (let k = 0; k < n; k++) {
      const it = instances[k];
      const q = Quaternion.FromEulerAngles(0, it.yaw, it.roll);
      Matrix.Compose(scale, q, it.pos).copyToArray(this.matrices, k * 16);
      Matrix.Compose(scale, q, it.pos).copyToArray(this.sailMatrices, k * 16);
      this.colors[k * 4] = it.color.r; this.colors[k * 4 + 1] = it.color.g; this.colors[k * 4 + 2] = it.color.b; this.colors[k * 4 + 3] = 1;
    }
    if (n === 0) { this.hull.setEnabled(false); this.sail.setEnabled(false); return; }
    this.hull.setEnabled(true); this.sail.setEnabled(true);
    this.hull.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.hull.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.sail.thinInstanceSetBuffer("matrix", this.sailMatrices, 16, false);
  }
}
