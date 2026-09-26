// Pointer interaction: hover picks a cell, a ghost previews the footprint, click places, right-click removes.
import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { Cell, FLOOR_Y, Grid, HALF, Piece, PieceKind, worldToCell } from "./grid";
import { createHouse, createPier, createWalkway, lanternMaterials, PieceMeshes } from "./pieces";

const CLICK_SLOP_PX = 5;

export class Placement {
  tool: PieceKind = "walkway";
  hover: Cell | null = null;
  private readonly ghost: Mesh;
  private readonly ghostOk: StandardMaterial;
  private readonly ghostBad: StandardMaterial;
  private readonly meshes = new Map<number, PieceMeshes>();
  private down: { x: number; y: number; button: number } | null = null;

  constructor(private readonly scene: Scene, private readonly camera: ArcRotateCamera, private readonly grid: Grid, canvas: HTMLCanvasElement) {
    this.ghost = MeshBuilder.CreateBox("ghost", { size: 1 }, scene);
    this.ghost.scaling.y = 0.06;
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);
    this.ghostOk = this.ghostMaterial("ghostOk", "#a8c97a");
    this.ghostBad = this.ghostMaterial("ghostBad", "#c9674f");
    this.ghost.material = this.ghostOk;

    canvas.addEventListener("pointermove", () => this.refresh());
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.ghost.setEnabled(false); });
    canvas.addEventListener("pointerdown", e => { this.down = { x: e.clientX, y: e.clientY, button: e.button }; });
    canvas.addEventListener("pointerup", e => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== e.button || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      if (e.button === 0) this.place();
      else if (e.button === 2) this.remove();
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
  }

  private ghostMaterial(name: string, hex: string): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.emissiveColor = Color3.FromHexString(hex).scale(0.4);
    m.specularColor = Color3.Black();
    m.alpha = 0.6;
    return m;
  }

  setTool(kind: PieceKind): void {
    this.tool = kind;
    this.refresh();
  }

  /**
   * Cell under the pointer. Intersects the picking ray with the plane at the current tool's floor height, so the
   * ghost sits exactly under the cursor; buildable terrain is always below that plane.
   */
  private pickCell(): Cell | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    const o = ray.origin, d = ray.direction;
    const floorY = FLOOR_Y[this.tool];
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (floorY - o.y) / d.y;
    if (t <= 0) return null;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return null;
    return worldToCell(x, z);
  }

  refresh(): void {
    this.hover = this.pickCell();
    if (!this.hover) { this.ghost.setEnabled(false); return; }
    const footprint = this.grid.footprint(this.tool, this.hover);
    const cells = footprint ?? [this.hover];
    const ok = footprint !== null && this.grid.canPlace(this.tool, cells);
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    this.ghost.position.set((minI + maxI + 1) / 2, FLOOR_Y[this.tool], (minJ + maxJ + 1) / 2);
    this.ghost.scaling.x = maxI - minI + 0.96;
    this.ghost.scaling.z = maxJ - minJ + 0.96;
    this.ghost.material = ok ? this.ghostOk : this.ghostBad;
    this.ghost.setEnabled(true);
  }

  place(anchor: Cell | null = this.hover): Piece | null {
    if (!anchor) return null;
    const cells = this.grid.footprint(this.tool, anchor);
    if (!cells || !this.grid.canPlace(this.tool, cells)) return null;
    const piece = this.grid.place(this.tool, cells);
    this.meshes.set(piece.id, this.build(piece));
    this.refresh();
    return piece;
  }

  remove(at: Cell | null = this.hover): void {
    if (!at) return;
    const piece = this.grid.pieceAt(at);
    if (!piece) return;
    const m = this.meshes.get(piece.id);
    m?.root.dispose();
    m?.lantern?.dispose();
    this.meshes.delete(piece.id);
    this.grid.remove(piece);
    this.refresh();
  }

  private build(piece: Piece): PieceMeshes {
    switch (piece.kind) {
      case "house": return createHouse(this.scene, piece.cells[0], piece.id);
      case "walkway": return createWalkway(this.scene, piece.cells[0]);
      case "pier": return createPier(this.scene, piece.cells);
    }
  }

  /** Lanterns show reachability: lit while the house is connected to a pier. */
  syncVisuals(): void {
    const mats = lanternMaterials(this.scene);
    for (const [id, m] of this.meshes) {
      if (!m.lantern) continue;
      m.lantern.material = this.grid.pieces.get(id)!.reached ? mats.lit : mats.dark;
    }
  }
}
