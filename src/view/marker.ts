// The pier suggestion: a pulsing ring on the deep cell the first pier should go on, shown until the town has one.
// Recomputed when the building set changes. View only.
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { Grid } from "../sim/grid";
import { suggestPier } from "../sim/start";
import { Cell, SimState } from "../sim/state";
import { PALETTE } from "./buildings";

export class PierMarker {
  private readonly ring: Mesh;
  private key = "";
  cell: Cell | null = null;

  constructor(scene: Scene, private readonly grid: Grid) {
    this.ring = MeshBuilder.CreateTorus("pierMarker", { diameter: 1.3, thickness: 0.12, tessellation: 24 }, scene);
    const mat = new StandardMaterial("pierMarkerMat", scene);
    mat.diffuseColor = Color3.FromHexString(PALETTE.lantern);
    mat.emissiveColor = Color3.FromHexString(PALETTE.lantern).scale(0.8);
    mat.specularColor = Color3.Black();
    this.ring.material = mat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
  }

  sync(state: SimState, viewTime: number): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1];
    if (key !== this.key) {
      this.key = key;
      const hasPier = Object.values(state.buildings).some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor");
      this.cell = hasPier ? null : suggestPier(this.grid);
    }
    if (!this.cell) { this.ring.setEnabled(false); return; }
    const pulse = 1 + 0.12 * Math.sin(viewTime * 3);
    this.ring.position.set(this.cell.i + 0.5, state.tide.level + 0.15, this.cell.j + 0.5);
    this.ring.scaling.set(pulse, 1, pulse);
    this.ring.setEnabled(true);
  }
}
