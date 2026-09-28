// Trees as two thin-instance meshes (trunks, canopies with per-instance colour), scaled by the ledger's tree
// ages so felling and regrowth are visible. After reference/trees: tall conifers with the canopy in three
// stacked tiers, each tier a little darker toward the ground, on a plain straight trunk. Rebuilt only when an
// age changes.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { SimState } from "../sim/state";
import { treeSites } from "../sim/trees";
import { ground } from "./ground";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { BiomeLook, TreeKit } from "./biomes";

const TRUNK = "#5b4634";
const LEAVES = ["#4a8a55", "#5a9a5c", "#3f7f4d"];

export class Trees {
  private trunks: Mesh;
  private canopies: Mesh;
  private readonly scene: Scene;
  private kitKey = "";
  private leaves: readonly string[] = LEAVES;
  private lastKey = "";
  /** Bump when the ground changes (landfill) so trees re-seat. */
  groundKey = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    ({ trunks: this.trunks, canopies: this.canopies } = this.buildKit("conifer", TRUNK, LEAVES));
  }

  /** The biome look's tree kit and colours (view/biomes): rebuilds the two meshes when they change. */
  setLook(look: BiomeLook): void {
    const key = `${look.trees.kit}|${look.trees.trunk}|${look.trees.leaves.join(",")}`;
    if (key === this.kitKey) return;
    this.kitKey = key;
    this.leaves = look.trees.leaves;
    this.trunks.dispose(); this.canopies.dispose();
    ({ trunks: this.trunks, canopies: this.canopies } = this.buildKit(look.trees.kit, look.trees.trunk, look.trees.leaves));
    this.lastKey = "";
  }

  /**
   * One tree kit as two thin-instanced meshes. Conifer: after reference/trees, three stacked tiers, each a little
   * darker toward the ground, on a plain straight trunk. Pine: taller and thinner, two narrow tiers high up over a
   * bare trunk, for a dark slope of them. Palm: a tall trunk leaning a touch, a crown of six flat fronds.
   */
  private buildKit(kit: TreeKit, trunkHex: string, leaves: readonly string[]): { trunks: Mesh; canopies: Mesh } {
    const scene = this.scene;
    void leaves;
    const tall = kit === "pine" ? 2.2 : kit === "palm" ? 2.6 : kit === "mangrove" ? 0.9 : 1.3;
    const trunk = MeshBuilder.CreateCylinder("t", { diameterTop: kit === "palm" ? 0.16 : 0.14, diameterBottom: 0.22, height: tall, tessellation: 5 }, scene);
    trunk.position.y = tall / 2;
    if (kit === "palm") trunk.rotation.z = 0.08;
    const trunkParts = [tint(trunk, trunkHex)];
    if (kit === "mangrove") {
      // Prop roots: five arched stilts splaying from the trunk into the mud.
      for (let k = 0; k < 5; k++) {
        const a = k * 1.256;
        const root = MeshBuilder.CreateCylinder("r", { diameterTop: 0.06, diameterBottom: 0.04, height: 0.75, tessellation: 4 }, scene);
        root.position.set(Math.cos(a) * 0.22, 0.28, Math.sin(a) * 0.22);
        root.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
        trunkParts.push(tint(root, trunkHex));
      }
    }
    const trunks = mergeFlat("treeTrunks", trunkParts, scene);
    const tiers: Mesh[] = [];
    if (kit === "conifer") {
      // Three tiers of foliage; the vertex tint darkens the lower tiers under the per-instance green.
      for (const [y, dia, h, shade] of [[1.45, 1.4, 1.1, "#c8c8c8"], [2.15, 1.05, 1.0, "#e4e4e4"], [2.8, 0.66, 0.95, "#ffffff"]] as [number, number, number, string][]) {
        const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: dia, height: h, tessellation: 7 }, scene);
        cone.position.y = y;
        cone.rotation.y = y * 0.7;
        tiers.push(tint(cone, shade));
      }
    } else if (kit === "pine") {
      for (const [y, dia, h, shade] of [[2.1, 0.95, 1.3, "#c0c0c0"], [2.95, 0.6, 1.1, "#ffffff"]] as [number, number, number, string][]) {
        const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: dia, height: h, tessellation: 6 }, scene);
        cone.position.y = y;
        cone.rotation.y = y * 0.7;
        tiers.push(tint(cone, shade));
      }
    } else if (kit === "mangrove") {
      // A low round crown of three overlapping clumps.
      for (const [dx, dy, dz, dia] of [[0, 1.15, 0, 1.2], [0.35, 1.0, 0.2, 0.8], [-0.3, 1.02, -0.2, 0.85]] as [number, number, number, number][]) {
        const clump = MeshBuilder.CreateSphere("c", { diameter: dia, segments: 4 }, scene);
        clump.scaling.set(1, 0.62, 1);
        clump.position.set(dx, dy, dz);
        tiers.push(tint(clump, dy > 1.1 ? "#ffffff" : "#d4d4d4"));
      }
    } else {
      const top = tall + 0.05;
      for (let k = 0; k < 6; k++) {
        const frond = MeshBuilder.CreateBox("f", { width: 1.3, height: 0.05, depth: 0.32 }, scene);
        frond.position.set(Math.cos(k * 1.047) * 0.55, top - 0.12, Math.sin(k * 1.047) * 0.55);
        frond.rotation.y = -k * 1.047;
        frond.rotation.z = -0.35;
        tiers.push(tint(frond, k % 2 ? "#ffffff" : "#d8d8d8"));
      }
      const crown = MeshBuilder.CreateSphere("cr", { diameter: 0.3, segments: 4 }, scene);
      crown.position.y = top;
      tiers.push(tint(crown, "#b9a377"));
    }
    const canopies = mergeFlat("treeCanopies", tiers, scene);
    canopies.material = flatMaterial(scene).clone("canopyMat") as StandardMaterial;
    for (const m of [trunks, canopies]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    return { trunks, canopies };
  }

  sync(state: SimState, storm = 0): void {
    const sites = treeSites(state);
    const bend = this.kitKey.startsWith("palm") ? Math.round(storm * 20) / 20 : 0; // palms lean in a cyclone; other kits stand
    const key = state.trees.join(",") + "|" + this.groundKey + "|" + bend;
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
      const q = Quaternion.FromEulerAngles(0, yaw, 0.45 * bend * (0.7 + 0.3 * Math.sin(k * 1.7)));
      Matrix.Compose(new Vector3(s, s, s), q, pos).copyToArray(trunkM, k * 16);
      Matrix.Compose(new Vector3(s, s, s), q, pos).copyToArray(canopyM, k * 16);
      const c = Color4.FromHexString(this.leaves[k % this.leaves.length]);
      colors[k * 4] = c.r; colors[k * 4 + 1] = c.g; colors[k * 4 + 2] = c.b; colors[k * 4 + 3] = 1;
    });
    this.trunks.thinInstanceSetBuffer("matrix", trunkM, 16, true);
    this.canopies.thinInstanceSetBuffer("matrix", canopyM, 16, true);
    this.canopies.thinInstanceSetBuffer("color", colors, 4, true);
  }
}
