// Trees as two thin-instance meshes (trunks, canopies with per-instance colour), scaled by the ledger's tree
// ages so felling and regrowth are visible. Rebuilt only when an age changes.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { terrainHeight } from "../sim/heightfield";
import { SimState } from "../sim/state";
import { TREE_SITES } from "../sim/trees";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";

const TRUNK = "#5b4634";
const LEAVES = ["#4a8a55", "#5a9a5c", "#3f7f4d"];

export class Trees {
  private readonly trunks: Mesh;
  private readonly canopies: Mesh;
  private lastKey = "";

  constructor(scene: Scene) {
    const trunk = MeshBuilder.CreateCylinder("t", { diameter: 0.22, height: 0.9, tessellation: 5 }, scene);
    trunk.position.y = 0.45;
    this.trunks = mergeFlat("treeTrunks", [tint(trunk, TRUNK)], scene);
    const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: 1.3, height: 2.3, tessellation: 6 }, scene);
    cone.position.y = 0.9 + 1.15;
    this.canopies = mergeFlat("treeCanopies", [tint(cone, "#ffffff")], scene);
    this.canopies.material = flatMaterial(scene).clone("canopyMat") as StandardMaterial;
    for (const m of [this.trunks, this.canopies]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
  }

  sync(state: SimState): void {
    const key = state.trees.join(",");
    if (key === this.lastKey) return;
    this.lastKey = key;
    const n = TREE_SITES.length;
    const trunkM = new Float32Array(n * 16), canopyM = new Float32Array(n * 16), colors = new Float32Array(n * 4);
    let seed = 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    TREE_SITES.forEach((site, k) => {
      const age = state.trees[k] ?? 1;
      const s = site.s * (0.05 + 0.95 * age);
      const yaw = rnd() * Math.PI;
      const pos = new Vector3(site.x, terrainHeight(site.x, site.z) - 0.05, site.z);
      const q = Quaternion.FromEulerAngles(0, yaw, 0);
      Matrix.Compose(new Vector3(s, s, s), q, pos).copyToArray(trunkM, k * 16);
      Matrix.Compose(new Vector3(s, s, s), q, pos).copyToArray(canopyM, k * 16);
      const c = Color4.FromHexString(LEAVES[k % 3]);
      colors[k * 4] = c.r; colors[k * 4 + 1] = c.g; colors[k * 4 + 2] = c.b; colors[k * 4 + 3] = 1;
    });
    this.trunks.thinInstanceSetBuffer("matrix", trunkM, 16, true);
    this.canopies.thinInstanceSetBuffer("matrix", canopyM, 16, true);
    this.canopies.thinInstanceSetBuffer("color", colors, 4, true);
  }
}
