// Boats as thin instances: hulls (per-instance colour) and sails (one draw call each). Positions are a pure
// function of sim state and view time: moored at their harbour, heeled on the mud when the water is gone, or
// along the deep-water path to the harbour's ground while the sim says they're at sea. View only.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { HIGH_WATER_MARK, LOW_WATER_MARK } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellCenter, Grid, worldToCell } from "../sim/grid";
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

export interface BoatPose { x: number; z: number; atSea: boolean; moored: boolean; fishing?: boolean }

/** Two rounds of corner-cutting (Chaikin) over the cell centres; the ends stay put. */
function smooth(points: Vector3[]): Vector3[] {
  let pts = points;
  for (let round = 0; round < 2 && pts.length > 2; round++) {
    const out: Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(new Vector3(a.x * 0.75 + b.x * 0.25, 0, a.z * 0.75 + b.z * 0.25));
      out.push(new Vector3(a.x * 0.25 + b.x * 0.75, 0, a.z * 0.25 + b.z * 0.75));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** The point a fraction `s` (0–1) along a polyline, by segment index. */
function pointAt(path: Vector3[], s: number): { x: number; z: number } {
  const idx = s * (path.length - 1);
  const i0 = Math.min(path.length - 2, Math.max(0, Math.floor(idx))), f = idx - i0;
  const a = path[i0], b = path[i0 + 1];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

interface Instance { pos: Vector3; yaw: number; roll: number; color: Color4 }

export class Boats {
  private readonly hull: Mesh;
  private readonly sail: Mesh;
  private readonly floats: Mesh;
  private readonly paths = new Map<string, Vector3[]>();
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private sailMatrices = new Float32Array(0);
  poses: BoatPose[] = [];

  constructor(scene: Scene, private readonly grid: Grid) {
    // After reference/boat: a double-ended planked hull (a hexagonal prism stretched along x gives the pointed
    // bow and stern in six flat facets), a dark band at the waterline, a pale gunwale, an open cockpit with two
    // thwarts and a coil of net, a mast with a boom and a tall triangular sail. The upper hull is white so the
    // instance colour paints it; everything else keeps its own colour in the second mesh.
    const hullParts: Mesh[] = [];
    const upper = MeshBuilder.CreateCylinder("hb", { diameter: 0.5, height: 0.16, tessellation: 6 }, scene);
    upper.scaling.set(2.4, 1, 1);
    upper.position.set(0, 0.2, 0);
    hullParts.push(tint(upper, "#ffffff"));
    this.hull = mergeFlat("boatHulls", hullParts, scene);
    const hullMat = flatMaterial(scene).clone("boatHullMat") as StandardMaterial;
    this.hull.material = hullMat;

    const sailParts: Mesh[] = [];
    const lower = MeshBuilder.CreateCylinder("hl", { diameterTop: 0.5, diameterBottom: 0.3, height: 0.14, tessellation: 6 }, scene);
    lower.scaling.set(2.4, 1, 1);
    lower.position.set(0, 0.05, 0);
    sailParts.push(tint(lower, "#4c5a66"));
    const gunwale = MeshBuilder.CreateCylinder("gw", { diameter: 0.54, height: 0.035, tessellation: 6 }, scene);
    gunwale.scaling.set(2.4, 1, 1);
    gunwale.position.set(0, 0.29, 0);
    sailParts.push(tint(gunwale, "#f2ece0"));
    const cockpit = MeshBuilder.CreateCylinder("ck", { diameter: 0.36, height: 0.03, tessellation: 6 }, scene);
    cockpit.scaling.set(2.2, 1, 1);
    cockpit.position.set(0, 0.29, 0);
    sailParts.push(tint(cockpit, "#5a4636"));
    for (const tx of [-0.3, 0.32]) {
      const thwart = MeshBuilder.CreateBox("tw", { width: 0.08, height: 0.03, depth: 0.34 }, scene);
      thwart.position.set(tx, 0.32, 0);
      sailParts.push(tint(thwart, PALETTE.planks));
    }
    const net = MeshBuilder.CreateSphere("net", { diameter: 0.2, segments: 4 }, scene);
    net.scaling.set(1.3, 0.55, 1);
    net.position.set(-0.46, 0.33, 0.05);
    sailParts.push(tint(net, "#b9a377"));
    const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.04, height: 1.05, tessellation: 4 }, scene);
    mast.position.set(0.08, 0.8, 0);
    sailParts.push(tint(mast, PALETTE.wood));
    const boom = MeshBuilder.CreateCylinder("boom", { diameter: 0.03, height: 0.62, tessellation: 4 }, scene);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(-0.22, 0.45, 0.02);
    sailParts.push(tint(boom, PALETTE.wood));
    // The sail: a three-sided prism squashed flat, then stretched tall; its foot lies along the boom.
    const sail = MeshBuilder.CreateCylinder("sail", { diameter: 0.6, height: 0.02, tessellation: 3 }, scene);
    sail.rotation.x = Math.PI / 2;
    sail.rotation.y = Math.PI;
    sail.scaling.set(1, 1, 1);
    sail.position.set(-0.2, 0.74, 0.03);
    sail.scaling.set(1.0, 1, 2.0);
    sailParts.push(tint(sail, PALETTE.sail));
    this.sail = mergeFlat("boatSails", sailParts, scene);

    // Net floats, shown trailing a boat while it fishes.
    const ring = MeshBuilder.CreateTorus("nf", { diameter: 0.12, thickness: 0.05, tessellation: 6 }, scene);
    this.floats = mergeFlat("netFloats", [tint(ring, PALETTE.roofs[0])], scene);
    for (const m of [this.hull, this.sail, this.floats]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    this.floats.setEnabled(false);
  }

  /** The sea route as cell centres, with the harbour's own cells dropped (a trip starts from the mooring). */
  private pathFor(harbour: Building, ground: Cell): Vector3[] {
    const key = `${harbour.id}:${ground.i},${ground.j}`;
    let p = this.paths.get(key);
    if (!p) {
      p = seaPath(this.grid, harbour, ground)
        .filter(c => !harbour.cells.some(h => h.i === c.i && h.j === c.j))
        .map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); });
      this.paths.set(key, p);
    }
    return p;
  }

  /** Mooring positions alongside the harbour's deck, skipping cells something else stands on (a walkway laid
   *  beside a pier, say), so no boat is ever parked inside a deck. */
  private moorings(h: Building): { x: number; z: number; yaw: number }[] {
    const slots = BUILDINGS[h.kind].slots ?? 0;
    const candidates: { x: number; z: number; yaw: number }[] = [];
    if (h.kind === "pier") {
      const a = cellCenter(h.cells[0]), s = cellCenter(h.cells[h.cells.length - 1]);
      const alongX = a.z === s.z;
      const mx = (a.x + s.x) / 2, mz = (a.z + s.z) / 2;
      const tip = { x: s.x + Math.sign(s.x - a.x) * 0.9, z: s.z + Math.sign(s.z - a.z) * 0.9 };
      for (const along of [-0.2, 0.6]) for (const side of [-1, 1]) {
        candidates.push(alongX ? { x: mx + along, z: mz + side * 0.78, yaw: 0 } : { x: mx + side * 0.78, z: mz + along, yaw: Math.PI / 2 });
      }
      candidates.push({ x: tip.x, z: tip.z, yaw: alongX ? Math.PI / 2 : 0 });
    } else {
      const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const w = Math.max(...is) - Math.min(...is) + 1, d = Math.max(...js) - Math.min(...js) + 1;
      candidates.push(
        { x: cx - w / 2 - 0.5, z: cz - 0.35, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz + 0.35, yaw: Math.PI / 2 },
        { x: cx - 0.35, z: cz - d / 2 - 0.5, yaw: 0 }, { x: cx + 0.35, z: cz + d / 2 + 0.5, yaw: 0 },
        { x: cx - w / 2 - 0.5, z: cz + 0.6, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz - 0.6, yaw: Math.PI / 2 },
        { x: cx - 0.35, z: cz + d / 2 + 0.5, yaw: 0 }, { x: cx + 0.35, z: cz - d / 2 - 0.5, yaw: 0 },
      );
    }
    const free = candidates.filter(m => !this.grid.buildingAt(worldToCell(m.x, m.z)));
    const pool = free.length ? free : candidates;
    const out: { x: number; z: number; yaw: number }[] = [];
    for (let k = 0; k < slots; k++) out.push(pool[k % pool.length]);
    return out;
  }

  sync(state: SimState, viewTime: number): void {
    const level = state.tide.level;
    const instances: Instance[] = [];
    const poses: BoatPose[] = [];
    const floats: Vector3[] = [];
    let colorIndex = 0;
    for (const h of Object.values(state.buildings)) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
      const moorings = this.moorings(h);
      const route = h.atSea && h.ground ? this.pathFor(h, h.ground) : null;
      const u = h.atSea ? phaseProgress(state.tide, HIGH_WATER_MARK, LOW_WATER_MARK) : 0;
      for (let k = 0; k < h.boats; k++) {
        const color = Color4.FromHexString(PALETTE.hulls[(colorIndex++) % PALETTE.hulls.length]);
        // A trip starts from the boat's own mooring and joins the sea route outside the harbour, so it never
        // sails through the deck. The route is smoothed so the boat rounds corners on an arc, and the hull
        // always points along its own motion: a boat moves along its keel, never sideways.
        const m0 = moorings[k % moorings.length];
        const path = route && route.length > 0 ? smooth([new Vector3(m0.x, 0, m0.z), ...route]) : null;
        if (path && path.length > 1) {
          let s: number, drift = 0;
          if (u < OUT) s = u / OUT;
          else if (u < BACK) { s = 1; drift = (u - OUT) / (BACK - OUT); }
          else s = 1 - (u - BACK) / (1 - BACK);
          const outbound = u < BACK;
          const at = pointAt(path, s);
          // Heading from a short look along the path in the direction of travel.
          const ahead = pointAt(path, Math.min(1, Math.max(0, s + (outbound ? 0.02 : -0.02))));
          let dx = ahead.x - at.x, dz = ahead.z - at.z;
          if (Math.hypot(dx, dz) < 1e-4) { const back = pointAt(path, Math.min(1, Math.max(0, s - (outbound ? 0.02 : -0.02)))); dx = at.x - back.x; dz = at.z - back.z; }
          const heading = Math.atan2(dx, dz);
          const side = (k - (h.boats - 1) / 2) * 0.7;
          const px = at.x + Math.cos(heading) * side + Math.sin(drift * Math.PI * 2 + k) * 0.6 * (s === 1 ? 1 : 0);
          const pz = at.z - Math.sin(heading) * side + Math.cos(drift * Math.PI * 2 + k) * 0.6 * (s === 1 ? 1 : 0);
          // The hull's bow is +x, so the yaw that puts +x onto the travel direction is heading − π/2.
          const yaw = heading - Math.PI / 2 + (s === 1 ? drift * Math.PI * 2 : 0);
          instances.push({ pos: new Vector3(px, level + waveHeight(px, pz, viewTime) - DRAFT * 0.3, pz), yaw, roll: 0.04 * Math.sin(viewTime * 1.3 + k), color });
          poses.push({ x: px, z: pz, atSea: true, moored: false, fishing: s === 1 });
          if (s === 1) {
            // On the ground: the net is out — a line of floats trails off the quarter, bobbing.
            for (let f = 0; f < 4; f++) {
              const fx = px - Math.cos(yaw) * (0.45 + f * 0.28) + Math.sin(yaw) * 0.25, fz = pz + Math.sin(yaw) * (0.45 + f * 0.28) + Math.cos(yaw) * 0.25;
              floats.push(new Vector3(fx, level + waveHeight(fx, fz, viewTime) + 0.02 + 0.02 * Math.sin(viewTime * 2.5 + f), fz));
            }
          }
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
    if (floats.length === 0) this.floats.setEnabled(false);
    else {
      const m = new Float32Array(floats.length * 16);
      floats.forEach((p, k) => Matrix.Translation(p.x, p.y, p.z).copyToArray(m, k * 16));
      this.floats.thinInstanceSetBuffer("matrix", m, 16, false);
      this.floats.setEnabled(true);
    }
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
