// The ferry: once the town has a harbor, a small boat shuttles between it and the isle's shore on a fixed
// timetable, along the sea BFS route. Pure function of ledger + view time; the ledger knows nothing of it.
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { cellCenter, cellIndex, Grid, HALF } from "../sim/grid";
import { ISLE } from "../sim/isle";
import { seaPath } from "../sim/sea";
import { Building, Cell, SimState } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";
import { PALETTE } from "./buildings";

export type FerryLeg = "out" | "landed" | "back" | "berthed";
export interface FerryPose { x: number; z: number; leg: FerryLeg }

const PERIOD = 70;
const OUT_END = 0.42, LANDED_END = 0.5, BACK_END = 0.92;

export class Ferry {
  private readonly mesh: Mesh;
  private route: { id: number; path: Vector3[] } | null = null;
  pose: FerryPose | null = null;

  constructor(scene: Scene, private readonly grid: Grid) {
    const parts: Mesh[] = [];
    const hull = MeshBuilder.CreateBox("fh", { width: 1.3, height: 0.3, depth: 0.6 }, scene);
    hull.position.set(0, 0.15, 0);
    parts.push(tint(hull, PALETTE.hulls[3]));
    const bow = MeshBuilder.CreateCylinder("fbow", { diameter: 0.6, height: 0.3, tessellation: 3 }, scene);
    bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 2;
    bow.position.set(0.8, 0.15, 0);
    parts.push(tint(bow, PALETTE.hulls[3]));
    const cabin = MeshBuilder.CreateBox("fcabin", { width: 0.5, height: 0.32, depth: 0.5 }, scene);
    cabin.position.set(-0.25, 0.46, 0);
    parts.push(tint(cabin, PALETTE.walls[0]));
    const roof = MeshBuilder.CreateBox("froof", { width: 0.6, height: 0.05, depth: 0.6 }, scene);
    roof.position.set(-0.25, 0.65, 0);
    parts.push(tint(roof, PALETTE.roofs[0]));
    const stack = MeshBuilder.CreateCylinder("fstack", { diameter: 0.1, height: 0.35, tessellation: 5 }, scene);
    stack.position.set(0.15, 0.5, 0);
    parts.push(tint(stack, "#3a2a1a"));
    this.mesh = mergeFlat("ferry", parts, scene);
    this.mesh.isPickable = false;
    this.mesh.setEnabled(false);
  }

  /** The isle's landing: the water cell on its rim nearest the harbor that the sea route can reach. */
  private landing(harbor: Building): Cell | null {
    const hc = cellCenter(harbor.cells[0]);
    let best: Cell | null = null, bd = Infinity;
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const k = cellIndex(i, j);
      if (!this.grid.isle[k] || this.grid.classAt({ i, j }) !== "deep") continue;
      const shore = this.grid.neighbors({ i, j }).some(n => this.grid.classAt(n) !== "deep");
      if (!shore) continue;
      const d = Math.hypot(i + 0.5 - hc.x, j + 0.5 - hc.z) + Math.hypot(i + 0.5 - ISLE.x, j + 0.5 - ISLE.z) * 0.3;
      if (d < bd) { bd = d; best = { i, j }; }
    }
    return best;
  }

  private path(harbor: Building): Vector3[] {
    if (this.route?.id === harbor.id) return this.route.path;
    const to = this.landing(harbor);
    const cells = to ? seaPath(this.grid, harbor, to, SIZE * 2) : [];
    const path = cells.map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); });
    this.route = { id: harbor.id, path };
    return path;
  }

  sync(state: SimState, viewTime: number): void {
    const harbor = Object.values(state.buildings).find(b => b.kind === "harbor");
    const path = harbor ? this.path(harbor) : [];
    if (!harbor || path.length < 3) { this.pose = null; this.mesh.setEnabled(false); return; }
    const u = (viewTime / PERIOD) % 1;
    const berth = 1, last = path.length - 1;
    let leg: FerryLeg, idx: number;
    if (u < OUT_END) { leg = "out"; idx = berth + (u / OUT_END) * (last - berth); }
    else if (u < LANDED_END) { leg = "landed"; idx = last; }
    else if (u < BACK_END) { leg = "back"; idx = last - ((u - LANDED_END) / (BACK_END - LANDED_END)) * (last - berth); }
    else { leg = "berthed"; idx = berth; }
    const i0 = Math.max(berth, Math.min(last - 1, Math.floor(idx))), f = Math.min(1, Math.max(0, idx - i0));
    const a = path[i0], b = path[i0 + 1];
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    const heading = leg === "back" ? Math.atan2(a.x - b.x, a.z - b.z) : Math.atan2(b.x - a.x, b.z - a.z);
    this.mesh.position.set(x, state.tide.level + waveHeight(x, z, viewTime) - 0.05, z);
    this.mesh.rotation.set(0.02 * Math.sin(viewTime * 1.3), heading - Math.PI / 2, 0.03 * Math.sin(viewTime * 1.1));
    this.mesh.setEnabled(true);
    this.pose = { x, z, leg };
  }
}
