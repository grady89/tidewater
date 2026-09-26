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
    // After reference/ships: a blue double-ended hull with a pale sheer line, a bowsprit, two masts with a
    // jib and furled sails on their booms, cargo crates on deck.
    const parts: Mesh[] = [];
    const hull = MeshBuilder.CreateCylinder("th", { diameter: 1.1, height: 0.42, tessellation: 6 }, scene);
    hull.scaling.set(3.1, 1, 1);
    hull.position.set(0, 0.36, 0);
    parts.push(tint(hull, "#2f6f8f"));
    const lower = MeshBuilder.CreateCylinder("tl", { diameterTop: 1.1, diameterBottom: 0.6, height: 0.3, tessellation: 6 }, scene);
    lower.scaling.set(3.1, 1, 1);
    lower.position.set(0, 0.0, 0);
    parts.push(tint(lower, "#4c5a66"));
    const sheer = MeshBuilder.CreateCylinder("ts", { diameter: 1.16, height: 0.05, tessellation: 6 }, scene);
    sheer.scaling.set(3.1, 1, 1);
    sheer.position.set(0, 0.6, 0);
    parts.push(tint(sheer, PALETTE.walls[0]));
    const deck = MeshBuilder.CreateCylinder("td", { diameter: 0.9, height: 0.04, tessellation: 6 }, scene);
    deck.scaling.set(3.0, 1, 1);
    deck.position.set(0, 0.6, 0);
    parts.push(tint(deck, PALETTE.planks));
    const sprit = MeshBuilder.CreateCylinder("tb", { diameter: 0.05, height: 0.9, tessellation: 4 }, scene);
    sprit.rotation.z = Math.PI / 2; sprit.rotation.x = 0; sprit.position.set(1.95, 0.7, 0);
    parts.push(tint(sprit, PALETTE.wood));
    for (const [cx, cz, s] of [[-0.2, 0.15, 0.22], [0.15, -0.15, 0.2], [-0.45, -0.1, 0.18], [0.1, 0.2, 0.16]] as [number, number, number][]) {
      const c = MeshBuilder.CreateBox("tc", { size: s }, scene); c.position.set(cx, 0.62 + s / 2, cz); parts.push(tint(c, "#b9a377"));
    }
    for (const [mx, mh] of [[0.6, 2.6], [-0.7, 2.2]] as [number, number][]) {
      const mast = MeshBuilder.CreateCylinder("tmast", { diameter: 0.07, height: mh, tessellation: 5 }, scene);
      mast.position.set(mx, 0.6 + mh / 2, 0);
      parts.push(tint(mast, PALETTE.wood));
      const boom = MeshBuilder.CreateCylinder("tboom", { diameter: 0.05, height: 1.1, tessellation: 4 }, scene);
      boom.rotation.z = Math.PI / 2; boom.position.set(mx - 0.5, 1.05, 0);
      parts.push(tint(boom, PALETTE.wood));
      const furled = MeshBuilder.CreateCylinder("tf", { diameter: 0.14, height: 1.0, tessellation: 5 }, scene);
      furled.rotation.z = Math.PI / 2; furled.position.set(mx - 0.5, 1.13, 0);
      parts.push(tint(furled, PALETTE.sail));
    }
    // The jib, set forward of the main mast.
    const jib = MeshBuilder.CreateCylinder("tsail", { diameter: 1.3, height: 0.02, tessellation: 3 }, scene);
    jib.rotation.x = Math.PI / 2; jib.rotation.y = Math.PI;
    jib.position.set(1.15, 1.75, 0.03); jib.scaling.set(1.0, 1, 1.7);
    parts.push(tint(jib, PALETTE.sail));
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
