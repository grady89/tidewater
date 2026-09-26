// Keeps one mesh set per building in the ledger. Called every frame; creates for new buildings, rebuilds when a
// building's mesh signature changes (level, lantern), disposes for removed ones, and drives the lanterns.
// Read-only over the sim.
import { Color3, Scene } from "@babylonjs/core";
import { SimState } from "../sim/state";
import { BuildingMeshes, createBuildingMeshes, lanternMaterials, lanternOn, meshSignature, PALETTE } from "./buildings";

const LANTERN = Color3.FromHexString(PALETTE.lantern);

export class BuildingViews {
  private readonly meshes = new Map<number, { m: BuildingMeshes; sig: string }>();

  constructor(private readonly scene: Scene) {}

  /** `lamp` is the lantern brightness from the time of day (0 by day). */
  sync(state: SimState, lamp = 0): void {
    for (const [id, e] of this.meshes) {
      if (state.buildings[id]) continue;
      e.m.root.dispose();
      e.m.lantern?.dispose();
      this.meshes.delete(id);
    }
    const mats = lanternMaterials(this.scene);
    mats.lit.emissiveColor = LANTERN.scale(0.25 + Math.min(1, lamp) * 0.9);
    for (const b of Object.values(state.buildings)) {
      const sig = meshSignature(b);
      let e = this.meshes.get(b.id);
      if (e && e.sig !== sig) { e.m.root.dispose(); e.m.lantern?.dispose(); e = undefined; }
      if (!e) { e = { m: createBuildingMeshes(this.scene, b), sig }; this.meshes.set(b.id, e); }
      if (e.m.lantern) e.m.lantern.material = lanternOn(b) ? mats.lit : mats.dark;
    }
  }

  clear(): void {
    for (const e of this.meshes.values()) { e.m.root.dispose(); e.m.lantern?.dispose(); }
    this.meshes.clear();
  }
}
