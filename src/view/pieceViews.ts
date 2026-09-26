// Keeps one mesh set per piece in the ledger. Called every frame; creates for new pieces, disposes for removed ones,
// and mirrors the reached flag onto the lantern. Read-only over the sim.
import { Scene } from "@babylonjs/core";
import { Piece, SimState } from "../sim/state";
import { createHouse, createPier, createWalkway, lanternMaterials, PieceMeshes } from "./pieces";

export class PieceViews {
  private readonly meshes = new Map<number, PieceMeshes>();

  constructor(private readonly scene: Scene) {}

  sync(state: SimState): void {
    for (const [id, m] of this.meshes) {
      if (state.pieces[id]) continue;
      m.root.dispose();
      m.lantern?.dispose();
      this.meshes.delete(id);
    }
    const mats = lanternMaterials(this.scene);
    for (const p of Object.values(state.pieces)) {
      let m = this.meshes.get(p.id);
      if (!m) { m = this.build(p); this.meshes.set(p.id, m); }
      if (m.lantern) m.lantern.material = p.reached ? mats.lit : mats.dark;
    }
  }

  clear(): void {
    for (const m of this.meshes.values()) { m.root.dispose(); m.lantern?.dispose(); }
    this.meshes.clear();
  }

  private build(piece: Piece): PieceMeshes {
    switch (piece.kind) {
      case "house": return createHouse(this.scene, piece.cells[0], piece.id);
      case "walkway": return createWalkway(this.scene, piece.cells[0]);
      case "pier": return createPier(this.scene, piece.cells);
    }
  }
}
