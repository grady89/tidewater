// The trade ship: one mesh that sails in from the open sea through the visit's high water, lies at the harbor
// around the peak, and sails out again. Position is a function of ledger + view time. View only.
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { HIGH_WATER_MARK, LOW_WATER_MARK, SIZE } from "../config";
import { cellCenter, Grid } from "../sim/grid";
import { seaEntry, seaPath } from "../sim/sea";
import { Building, SimState } from "../sim/state";
import { isRising, phaseProgress } from "../sim/tide";
import { mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";
import { PALETTE } from "./buildings";

export type ShipLeg = "away" | "in" | "berthed" | "out";
export interface ShipPose { x: number; z: number; leg: ShipLeg }

const IN_END = 0.38, OUT_START = 0.62;

export class Ship {
  private readonly mesh: Mesh;
  private pathFor: { id: number; path: Vector3[] } | null = null;
  pose: ShipPose | null = null;

  constructor(scene: Scene, private readonly grid: Grid) {
    const parts: Mesh[] = [];
    const hull = MeshBuilder.CreateBox("th", { width: 2.6, height: 0.5, depth: 1.0 }, scene);
    hull.position.set(-0.2, 0.25, 0);
    parts.push(tint(hull, PALETTE.hulls[1]));
    const bow = MeshBuilder.CreateCylinder("tbow", { diameter: 1.0, height: 0.5, tessellation: 3 }, scene);
    bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 2;
    bow.position.set(1.4, 0.25, 0); bow.scaling.set(1, 0.9, 1);
    parts.push(tint(bow, PALETTE.hulls[1]));
    const deck = MeshBuilder.CreateBox("tdeck", { width: 2.4, height: 0.08, depth: 0.9 }, scene);
    deck.position.set(-0.2, 0.54, 0);
    parts.push(tint(deck, PALETTE.planks));
    const cabin = MeshBuilder.CreateBox("tcabin", { width: 0.7, height: 0.45, depth: 0.7 }, scene);
    cabin.position.set(-1.0, 0.8, 0);
    parts.push(tint(cabin, PALETTE.walls[0]));
    for (const mx of [-0.2, 0.7]) {
      const mast = MeshBuilder.CreateCylinder("tmast", { diameter: 0.07, height: 2.2, tessellation: 5 }, scene);
      mast.position.set(mx, 1.6, 0);
      parts.push(tint(mast, PALETTE.wood));
      const sail = MeshBuilder.CreateCylinder("tsail", { diameterTop: 0, diameterBottom: 1.3, height: 1.4, tessellation: 3 }, scene);
      sail.rotation.z = -Math.PI / 2; sail.rotation.x = Math.PI / 2;
      sail.position.set(mx - 0.55, 1.5, 0.04); sail.scaling.set(1, 1, 0.06);
      parts.push(tint(sail, PALETTE.sail));
    }
    this.mesh = mergeFlat("tradeShip", parts, scene);
    this.mesh.isPickable = false;
    this.mesh.setEnabled(false);
  }

  private path(harbor: Building): Vector3[] {
    if (this.pathFor?.id === harbor.id) return this.pathFor.path;
    const entry = seaEntry(this.grid, harbor);
    const cells = entry ? seaPath(this.grid, harbor, entry, SIZE * 2) : [];
    const path = cells.map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); });
    this.pathFor = { id: harbor.id, path };
    return path;
  }

  sync(state: SimState, viewTime: number): void {
    const harbor = Object.values(state.buildings).find(b => b.kind === "harbor");
    const t = state.trade;
    let leg: ShipLeg = "away";
    if (harbor && state.phase === "high") {
      const rising = isRising(state.tide);
      const visiting = rising ? state.tide.cycle + 1 === t.nextVisit : state.tide.cycle === t.shipCycle;
      if (visiting) {
        const u = phaseProgress(state.tide, HIGH_WATER_MARK, LOW_WATER_MARK);
        leg = u < IN_END ? "in" : u < OUT_START ? "berthed" : "out";
        const path = this.path(harbor);
        if (path.length > 2) {
          // path[0] is inside the harbor; the berth is the first cell outside it; the entry is the last.
          const berth = 1, last = path.length - 1;
          let idx: number;
          if (leg === "in") idx = last - (u / IN_END) * (last - berth);
          else if (leg === "berthed") idx = berth;
          else idx = berth + ((u - OUT_START) / (1 - OUT_START)) * (last - berth);
          const i0 = Math.max(berth, Math.min(last - 1, Math.floor(idx))), f = Math.min(1, Math.max(0, idx - i0));
          const a = path[i0], b = path[i0 + 1];
          const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
          const heading = leg === "out" ? Math.atan2(b.x - a.x, b.z - a.z) : Math.atan2(a.x - b.x, a.z - b.z);
          this.mesh.position.set(x, state.tide.level + waveHeight(x, z, viewTime) - 0.05, z);
          this.mesh.rotation.set(0.02 * Math.sin(viewTime * 0.9), heading - Math.PI / 2, 0.03 * Math.sin(viewTime * 1.1));
          this.mesh.setEnabled(true);
          this.pose = { x, z, leg };
          return;
        }
      }
    }
    this.mesh.setEnabled(false);
    this.pose = null;
    void leg;
  }
}
