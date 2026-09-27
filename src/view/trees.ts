// Trees as two thin-instance meshes (trunks, canopies with per-instance colour), scaled by the ledger's tree
// ages so felling and regrowth are visible. After reference/trees: tall conifers with the canopy in three
// stacked tiers, each tier a little darker toward the ground, on a plain straight trunk. Rebuilt only when an
// age changes.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { SimState } from "../sim/state";
import { treeSites } from "../sim/trees";
import { ground } from "./ground";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";

const TRUNK = "#5b4634";
const LEAVES = ["#4a8a55", "#5a9a5c", "#3f7f4d"];

export class Trees {
  private readonly trunks: Mesh;
  private readonly canopies: Mesh;
  private lastKey = "";
  /** Bump when the ground changes (landfill) so trees re-seat. */
  groundKey = 0;

  constructor(scene: Scene) {
    const trunk = MeshBuilder.CreateCylinder("t", { diameterTop: 0.14, diameterBottom: 0.22, height: 1.3, tessellation: 5 }, scene);
    trunk.position.y = 0.65;
    this.trunks = mergeFlat("treeTrunks", [tint(trunk, TRUNK)], scene);
    // Three tiers of foliage; the vertex tint darkens the lower tiers under the per-instance green.
    const tiers: Mesh[] = [];
    for (const [y, dia, h, shade] of [[1.45, 1.4, 1.1, "#c8c8c8"], [2.15, 1.05, 1.0, "#e4e4e4"], [2.8, 0.66, 0.95, "#ffffff"]] as [number, number, number, string][]) {
      const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: dia, height: h, tessellation: 7 }, scene);
      cone.position.y = y;
      cone.rotation.y = y * 0.7;
      tiers.push(tint(cone, shade));
    }
    this.canopies = mergeFlat("treeCanopies", tiers, scene);
    this.canopies.material = flatMaterial(scene).clone("canopyMat") as StandardMaterial;
    for (const m of [this.trunks, this.canopies]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
  }

  sync(state: SimState): void {
    const sites = treeSites(state);
    const key = state.trees.join(",") + "|" + this.groundKey;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const n = sites.length;
    const trunkM = new Float32Array(n * 16), canopyM = new Float32Array(n * 16), colors = new Float32Array(n * 4);
    let seed = 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    sites.forEach((site, k) => {
      const age = state.trees[k] ?? 1;
      const s = age < 0 ? 0 : site.s * (0.05 + 0.95 * age); // cleared trees are gone
      const yaw = rnd() * Math.PI;
      const pos = new Vector3(site.x, ground(site.x, site.z) - 0.05, site.z);
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
