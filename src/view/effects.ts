// Ambient effects driven by the ledger's fields: shark fins patrolling the riskiest water. Storm, wave, fire and
// damage effects join this file in later milestones. View only.
import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { CELLS } from "../sim/fields";
import { HALF } from "../sim/grid";
import { SimState } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";

const FIN_COUNT = 3;
const FIN_MIN_RISK = 0.25;

export class Effects {
  private readonly fins: Mesh;
  private finCells: number[] = [];
  private frame = 0;
  private matrices = new Float32Array(FIN_COUNT * 16);

  constructor(scene: Scene) {
    // A fin: a thin triangular prism.
    const fin = MeshBuilder.CreateCylinder("fin", { diameterTop: 0, diameterBottom: 0.5, height: 0.45, tessellation: 3 }, scene);
    fin.scaling.set(1, 1, 0.25);
    fin.position.y = 0.22;
    this.fins = mergeFlat("sharkFins", [tint(fin, "#4c5a66")], scene);
    this.fins.isPickable = false;
    this.fins.alwaysSelectAsActiveMesh = true;
    this.fins.setEnabled(false);
  }

  /** The riskiest water cells, refreshed every second or so. */
  private pickCells(state: SimState): void {
    const f = state.fields.shark;
    const best: { k: number; v: number }[] = [];
    for (let k = 0; k < CELLS; k++) {
      const v = f[k];
      if (v < FIN_MIN_RISK) continue;
      if (best.length < FIN_COUNT) { best.push({ k, v }); best.sort((a, b) => b.v - a.v); }
      else if (v > best[best.length - 1].v) { best[best.length - 1] = { k, v }; best.sort((a, b) => b.v - a.v); }
    }
    this.finCells = best.map(b => b.k);
  }

  get finCount(): number { return this.finCells.length; }

  sync(state: SimState, viewTime: number): void {
    if (this.frame++ % 60 === 0) this.pickCells(state);
    const n = this.finCells.length;
    if (n === 0) { this.fins.setEnabled(false); return; }
    this.fins.setEnabled(true);
    const level = state.tide.level;
    const scale = new Vector3(1, 1, 1);
    this.finCells.forEach((k, idx) => {
      const ci = Math.floor(k / 64) - HALF + 0.5, cj = (k % 64) - HALF + 0.5;
      const t = viewTime * 0.5 + idx * 2.1;
      const x = ci + Math.cos(t) * 0.9, z = cj + Math.sin(t) * 0.9;
      const yaw = -t + Math.PI / 2;
      const pos = new Vector3(x, level + waveHeight(x, z, viewTime) - 0.1, z);
      Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, 0), pos).copyToArray(this.matrices, idx * 16);
    });
    this.fins.thinInstanceSetBuffer("matrix", this.matrices.subarray(0, n * 16), 16, false);
  }
}
