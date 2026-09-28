// The assets pilot's side-by-side (docs/assets): an asset's primitive kit and its Blender build, one instance each,
// a little apart on the island where the game would draw them (boats, the whale and the turtle on the water, the palm
// on dry ground), thin-instanced and painted exactly as their kits are. Console: `__tidewater.view.assetCompare`.
import { Color4, Matrix, Mesh, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import type { BiomeId } from "../sim/biomes";
import { Grid } from "../sim/grid";
import { SimState } from "../sim/state";
import { ASSET_HOME, AssetName, boatAsset, loadAsset, palmAsset, turtleAsset, whaleAsset } from "./assets";
import { lookOf } from "./biomes";
import { primitiveBoatKit } from "./boats";
import { PALETTE } from "./buildings";
import { ground } from "./ground";
import { primitiveTreeKit } from "./trees";
import { primitiveTurtle, primitiveWhale } from "./wildlife";

const BOATS: readonly AssetName[] = ["dory", "outrigger", "longboat"];
const triangles = (meshes: Mesh[]) => meshes.reduce((n, m) => n + (m.getTotalIndices() / 3), 0);

export interface CompareInfo { name: AssetName; look: BiomeId; at: { x: number; y: number; z: number }; spacing: number; primitive: { tris: number; x: number }; blender: { tris: number; x: number; parts: string[] } }

export class AssetCompare {
  private meshes: Mesh[] = [];

  constructor(private readonly scene: Scene, private readonly grid: Grid) {}

  clear(): void {
    for (const m of this.meshes) m.dispose(false, false);
    this.meshes = [];
  }

  /** A spot for the pair near (x, z): open water deep enough to float in for sea kinds, dry clear ground for the palm. */
  private spot(state: SimState, near: { x: number; z: number }, onLand: boolean, spacing: number): { x: number; z: number } {
    const level = state.tide.level;
    const ok = (x: number, z: number) => {
      for (const dx of [-spacing / 2 - 0.8, 0, spacing / 2 + 0.8]) for (const dz of [-0.8, 0.8]) {
        const gx = x + dx, gz = z + dz;
        const c = { i: Math.floor(gx), j: Math.floor(gz) };
        if (Math.abs(gx) > 30 || Math.abs(gz) > 30 || this.grid.buildingAt(c)) return false;
        // Clear of trees for two cells round, so a palm is not lost in a wood (or a boat under a canopy).
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (this.grid.treeOn([{ i: c.i + di, j: c.j + dj }])) return false;
        const h = ground(gx, gz);
        if (onLand ? h < level + 0.4 : h > level - 0.5) return false;
      }
      return true;
    };
    let best = { x: near.x, z: near.z }, bd = Infinity;
    for (let i = -28; i <= 28; i++) for (let j = -28; j <= 28; j++) {
      const x = i + 0.5, z = j + 0.5;
      const d = (x - near.x) ** 2 + (z - near.z) ** 2;
      if (d < bd && ok(x, z)) { bd = d; best = { x, z }; }
    }
    return best;
  }

  /** Show `name` (in `look`, its own by default) beside its primitive near (x, z). Resolves once the asset has loaded. */
  async show(state: SimState, name: AssetName, look: BiomeId = ASSET_HOME[name], near = { x: 0, z: 0 }, yaw = 0.55): Promise<CompareInfo> {
    this.clear();
    const t = await loadAsset(this.scene, name, look);
    const theLook = lookOf(look);
    const boat = BOATS.includes(name);
    const spacing = name === "whale" ? 3.4 : name === "palm" ? 3 : name === "turtle" ? 1.1 : 2.2;
    const at = this.spot(state, near, name === "palm", spacing);
    const level = state.tide.level;
    let prim: Mesh[], blend: Mesh[];
    let y = level;
    if (boat) {
      const p = primitiveBoatKit(this.scene, name as "dory"), b = boatAsset(this.scene, name as "dory", look)!;
      prim = [p.hull, p.sail]; blend = [b.hull, b.sail];
      y = level - 0.036;
    } else if (name === "palm") {
      const p = primitiveTreeKit(this.scene, "palm", theLook.trees.trunk, theLook.trees.leaves), b = palmAsset(this.scene)!;
      prim = [p.trunks, p.canopies]; blend = [b.trunks, b.canopies];
      y = ground(at.x, at.z) - 0.05;
    } else if (name === "whale") {
      const p = primitiveWhale(this.scene), b = whaleAsset(this.scene)!;
      prim = [p.whales, p.spouts]; blend = [b.whales, b.spouts];
      y = level + 0.05;
    } else {
      prim = [primitiveTurtle(this.scene)]; blend = [turtleAsset(this.scene)!];
      y = level - 0.05;
    }
    const place = (meshes: Mesh[], x: number) => {
      for (const m of meshes) {
        const spout = m.name === "spouts";
        const pos = new Vector3(x, spout ? level + 0.1 : y, at.z);
        const s = spout ? 1.2 : 1;
        const mat = Matrix.Compose(new Vector3(s, s, s), Quaternion.FromEulerAngles(0, yaw, 0), pos);
        m.thinInstanceSetBuffer("matrix", new Float32Array(mat.asArray()), 16, true);
        // Painted as their kits paint them: a boat's hull in a hull colour, a palm's fronds in the look's first leaf.
        const tintWith = m.name === "boatHulls" ? PALETTE.hulls[3] : m.name === "treeCanopies" ? theLook.trees.leaves[0] : null;
        if (tintWith) { const c = Color4.FromHexString(tintWith); m.thinInstanceSetBuffer("color", new Float32Array([c.r, c.g, c.b, 1]), 4, true); }
        m.setEnabled(true);
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
        this.meshes.push(m);
      }
    };
    const px = at.x - spacing / 2, bx = at.x + spacing / 2;
    place(prim, px);
    place(blend, bx);
    return { name, look, at: { x: at.x, y, z: at.z }, spacing, primitive: { tris: triangles(prim), x: px }, blender: { tris: triangles(blend), x: bx, parts: [...t.parts.keys()] } };
  }
}
