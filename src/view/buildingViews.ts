// Keeps one mesh set per building in the ledger. Called every frame; creates for new buildings, disposes for
// removed ones, and mirrors the reached flag onto the lantern. Read-only over the sim.
import { Scene } from "@babylonjs/core";
import { SimState } from "../sim/state";
import { BuildingMeshes, createBuildingMeshes, lanternMaterials } from "./buildings";

export class BuildingViews {
  private readonly meshes = new Map<number, BuildingMeshes>();

  constructor(private readonly scene: Scene) {}

  sync(state: SimState): void {
    for (const [id, m] of this.meshes) {
      if (state.buildings[id]) continue;
      m.root.dispose();
      m.lantern?.dispose();
      this.meshes.delete(id);
    }
    const mats = lanternMaterials(this.scene);
    for (const b of Object.values(state.buildings)) {
      let m = this.meshes.get(b.id);
      if (!m) { m = createBuildingMeshes(this.scene, b); this.meshes.set(b.id, m); }
      if (m.lantern) m.lantern.material = b.reached && b.residents > 0 ? mats.lit : mats.dark;
    }
  }

  clear(): void {
    for (const m of this.meshes.values()) { m.root.dispose(); m.lantern?.dispose(); }
    this.meshes.clear();
  }
}
