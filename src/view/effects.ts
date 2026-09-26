// Ambient effects driven by the ledger: shark fins patrolling the riskiest water; flames and smoke over burning
// buildings. Storm and wave effects join in M11. View only.
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CELLS } from "../sim/fields";
import { HALF } from "../sim/grid";
import { Building, SimState } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";

const FIN_COUNT = 3;
const FIN_MIN_RISK = 0.25;
const FLAMES_PER_FIRE = 4;
const PUFFS_PER_FIRE = 5;

export class Effects {
  private readonly fins: Mesh;
  private readonly flames: Mesh;
  private readonly smoke: Mesh;
  private finCells: number[] = [];
  private frame = 0;
  private finMatrices = new Float32Array(FIN_COUNT * 16);
  private flameMatrices = new Float32Array(0);
  private smokeMatrices = new Float32Array(0);
  burning = 0;

  constructor(scene: Scene) {
    // A fin: a thin triangular prism.
    const fin = MeshBuilder.CreateCylinder("fin", { diameterTop: 0, diameterBottom: 0.5, height: 0.45, tessellation: 3 }, scene);
    fin.scaling.set(1, 1, 0.25);
    fin.position.y = 0.22;
    this.fins = mergeFlat("sharkFins", [tint(fin, "#4c5a66")], scene);

    // A flame: a slim cone, self-lit.
    const flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.34, height: 0.7, tessellation: 5 }, scene);
    flame.position.y = 0.35;
    this.flames = mergeFlat("flames", [tint(flame, "#ffb859")], scene);
    const flameMat = new StandardMaterial("flameMat", scene);
    flameMat.diffuseColor = Color3.FromHexString("#ffb859");
    flameMat.emissiveColor = new Color3(1.0, 0.5, 0.15);
    flameMat.specularColor = Color3.Black();
    this.flames.material = flameMat;

    // A puff of smoke: a low-poly sphere.
    const puff = MeshBuilder.CreateSphere("puff", { diameter: 0.45, segments: 4 }, scene);
    this.smoke = mergeFlat("smoke", [tint(puff, "#8d8a83")], scene);
    const smokeMat = new StandardMaterial("smokeMat", scene);
    smokeMat.diffuseColor = new Color3(0.4, 0.4, 0.42);
    smokeMat.alpha = 0.7;
    this.smoke.material = smokeMat;

    for (const m of [this.fins, this.flames, this.smoke]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
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

  private syncFins(state: SimState, viewTime: number): void {
    if (this.frame % 60 === 0 || this.finCells.length === 0) this.pickCells(state);
    const n = this.finCells.length;
    if (n === 0) { this.fins.setEnabled(false); return; }
    this.fins.setEnabled(true);
    const level = state.tide.level;
    const scale = new Vector3(1, 1, 1);
    this.finCells.forEach((k, idx) => {
      const ci = Math.floor(k / 64) - HALF + 0.5, cj = (k % 64) - HALF + 0.5;
      const t = viewTime * 0.5 + idx * 2.1;
      const x = ci + Math.cos(t) * 0.9, z = cj + Math.sin(t) * 0.9;
      const pos = new Vector3(x, level + waveHeight(x, z, viewTime) - 0.1, z);
      Matrix.Compose(scale, Quaternion.FromEulerAngles(0, -t + Math.PI / 2, 0), pos).copyToArray(this.finMatrices, idx * 16);
    });
    this.fins.thinInstanceSetBuffer("matrix", this.finMatrices.subarray(0, n * 16), 16, false);
  }

  private syncFire(state: SimState, viewTime: number): void {
    const burning: Building[] = [];
    for (const b of Object.values(state.buildings)) if (b.fire > 0) burning.push(b);
    this.burning = burning.length;
    if (!burning.length) { this.flames.setEnabled(false); this.smoke.setEnabled(false); return; }
    const nf = burning.length * FLAMES_PER_FIRE, ns = burning.length * PUFFS_PER_FIRE;
    if (this.flameMatrices.length !== nf * 16) this.flameMatrices = new Float32Array(nf * 16);
    if (this.smokeMatrices.length !== ns * 16) this.smokeMatrices = new Float32Array(ns * 16);
    let fi = 0, si = 0;
    for (const b of burning) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const w = Math.max(...is) - Math.min(...is) + 1, d = Math.max(...js) - Math.min(...js) + 1;
      for (let k = 0; k < FLAMES_PER_FIRE; k++) {
        const a = k * 1.7 + b.id;
        const x = cx + Math.cos(a) * 0.3 * w, z = cz + Math.sin(a) * 0.3 * d;
        const s = 0.7 + 0.4 * Math.abs(Math.sin(viewTime * 7 + k * 1.3 + b.id));
        Matrix.Compose(new Vector3(s, s * 1.3, s), Quaternion.FromEulerAngles(0, viewTime * 2 + k, 0.1 * Math.sin(viewTime * 5 + k)), new Vector3(x, b.floorY + 0.3, z)).copyToArray(this.flameMatrices, fi++ * 16);
      }
      for (let k = 0; k < PUFFS_PER_FIRE; k++) {
        const u = ((viewTime * 0.35 + k / PUFFS_PER_FIRE + b.id * 0.13) % 1);
        const x = cx + Math.sin(k * 2.3 + b.id) * 0.25 + u * 0.4, z = cz + Math.cos(k * 1.9 + b.id) * 0.25;
        const s = 0.5 + u * 1.2;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.Identity(), new Vector3(x, b.floorY + 1.0 + u * 2.4, z)).copyToArray(this.smokeMatrices, si++ * 16);
      }
    }
    this.flames.setEnabled(true); this.smoke.setEnabled(true);
    this.flames.thinInstanceSetBuffer("matrix", this.flameMatrices, 16, false);
    this.smoke.thinInstanceSetBuffer("matrix", this.smokeMatrices, 16, false);
  }

  sync(state: SimState, viewTime: number): void {
    this.frame++;
    this.syncFins(state, viewTime);
    this.syncFire(state, viewTime);
  }
}
