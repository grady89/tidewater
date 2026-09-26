// Field overlays: one mesh of 64×64 flat quads draped over the island, coloured per cell from a ledger field.
// Only the colour buffer changes, and only while an overlay is shown. View only.
import { Color4, Mesh, Scene, StandardMaterial, VertexBuffer, VertexData } from "@babylonjs/core";
import { SIZE } from "../config";
import { CELLS } from "../sim/fields";
import { cellIndex, Grid, HALF } from "../sim/grid";
import { SimState } from "../sim/state";

export type OverlayKind = "pollution" | "fish" | "shark" | "fire";

export const OVERLAYS: { kind: OverlayKind; label: string }[] = [
  { kind: "pollution", label: "Pollution" },
  { kind: "fish", label: "Fish" },
  { kind: "shark", label: "Sharks" },
  { kind: "fire", label: "Fire" },
];

/** Colour ramps: [r, g, b] at full strength; alpha scales with the value. */
const RAMPS: Record<OverlayKind, { color: [number, number, number]; scale: number; deepOnly: boolean }> = {
  pollution: { color: [0.55, 0.22, 0.45], scale: 1.5, deepOnly: false },
  fish: { color: [0.25, 0.85, 0.75], scale: 1, deepOnly: true },
  shark: { color: [0.85, 0.3, 0.2], scale: 1.5, deepOnly: false },
  fire: { color: [1.0, 0.55, 0.15], scale: 3, deepOnly: false },
};

export class Overlays {
  private readonly mesh: Mesh;
  private readonly colors = new Float32Array(CELLS * 4 * 4);
  kind: OverlayKind | null = null;
  private frame = 0;

  constructor(scene: Scene, private readonly grid: Grid) {
    const positions = new Float32Array(CELLS * 4 * 3);
    const indices = new Uint32Array(CELLS * 6);
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const k = cellIndex(i, j);
      const y = Math.max(grid.heights[k] + 0.08, 0.95);
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      corners.forEach(([x, z], c) => { const o = (k * 4 + c) * 3; positions[o] = x + (c === 0 || c === 3 ? 0.03 : -0.03); positions[o + 1] = y; positions[o + 2] = z + (c < 2 ? 0.03 : -0.03); });
      const b = k * 4, o = k * 6;
      indices[o] = b; indices[o + 1] = b + 2; indices[o + 2] = b + 1;
      indices[o + 3] = b; indices[o + 4] = b + 3; indices[o + 5] = b + 2;
    }
    this.mesh = new Mesh("overlay", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = this.colors;
    vd.applyToMesh(this.mesh, true);
    const mat = new StandardMaterial("overlayMat", scene);
    mat.disableLighting = true;
    mat.emissiveColor.set(1, 1, 1);
    mat.alpha = 0.999;
    mat.backFaceCulling = false;
    this.mesh.material = mat;
    this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false;
    this.mesh.alphaIndex = 20;
    this.mesh.setEnabled(false);
  }

  show(kind: OverlayKind | null): void {
    this.kind = kind;
    this.mesh.setEnabled(kind !== null);
    this.frame = 0;
  }

  sync(state: SimState): void {
    if (!this.kind) return;
    if (this.frame++ % 6 !== 0) return;
    const ramp = RAMPS[this.kind];
    const field = state.fields[this.kind];
    const c = new Color4(0, 0, 0, 0);
    for (let k = 0; k < CELLS; k++) {
      let a = 0;
      if (!ramp.deepOnly || this.grid.deep[k]) a = Math.min(1, field[k] / ramp.scale);
      c.set(ramp.color[0], ramp.color[1], ramp.color[2], a * 0.65);
      for (let v = 0; v < 4; v++) { const o = (k * 4 + v) * 4; this.colors[o] = c.r; this.colors[o + 1] = c.g; this.colors[o + 2] = c.b; this.colors[o + 3] = c.a; }
    }
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors);
  }
}

export { SIZE };
