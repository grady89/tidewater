// Pointer interaction: hover picks a cell, a ghost previews the footprint, click places (and pays), right-click
// removes. Placement writes to the sim through the Grid; meshes appear when the view syncs.
import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { BuildingKind, BUILDINGS, PlacementClass } from "../sim/balance";
import { boatPurchaseBlocker, buyBoat, canAfford, tryPlace } from "../sim/economy";
import { Grid, HALF, worldToCell } from "../sim/grid";
import { Building, Cell } from "../sim/state";

export type Tool = BuildingKind | "boat";

const CLICK_SLOP_PX = 5;

export class Placement {
  tool: Tool = "walkway";
  hover: Cell | null = null;
  /** Why the current hover can't be placed, for the HUD. Null when it can. */
  blocker: string | null = null;
  private readonly ghost: Mesh;
  private readonly ghostOk: StandardMaterial;
  private readonly ghostBad: StandardMaterial;
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

  setTool(tool: Tool): void {
    this.tool = tool;
    this.refresh();
  }

  private floorY(): number {
    return this.tool === "boat" ? BUILDINGS.pier.floor : BUILDINGS[this.tool].floor;
  }

  /**
   * Cell under the pointer. Intersects the picking ray with the plane at the current tool's floor height, so the
   * ghost sits exactly under the cursor; buildable terrain is always below that plane.
   */
  private pickCell(): Cell | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    const o = ray.origin, d = ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (this.floorY() - o.y) / d.y;
    if (t <= 0) return null;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return null;
    return worldToCell(x, z);
  }

  /** Footprint and blocker for placing the current tool at `anchor`. */
  private evaluate(anchor: Cell): { cells: Cell[]; blocker: string | null } {
    const state = this.grid.state;
    if (this.tool === "boat") {
      const b = this.grid.buildingAt(anchor);
      return { cells: b?.kind === "pier" ? b.cells : [anchor], blocker: boatPurchaseBlocker(state, b) };
    }
    const def = BUILDINGS[this.tool];
    const cells = this.grid.footprint(this.tool, anchor);
    if (!cells) return { cells: [anchor], blocker: def.cls === "edge" ? "Needs deep water against the shore" : "Off the map" };
    if (!this.grid.classOk(def.cls, cells)) return { cells, blocker: classHint(def.cls) };
    if (cells.some(c => this.grid.buildingAt(c))) return { cells, blocker: "Occupied" };
    if (!canAfford(state, def.cost)) return { cells, blocker: `Costs ${costLabel(this.tool)}` };
    return { cells, blocker: null };
  }

  refresh(): void {
    this.hover = this.pickCell();
    if (!this.hover) { this.ghost.setEnabled(false); this.blocker = null; return; }
    const { cells, blocker } = this.evaluate(this.hover);
    this.blocker = blocker;
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    this.ghost.position.set((minI + maxI + 1) / 2, this.floorY(), (minJ + maxJ + 1) / 2);
    this.ghost.scaling.x = maxI - minI + 0.96;
    this.ghost.scaling.z = maxJ - minJ + 0.96;
    this.ghost.material = blocker ? this.ghostBad : this.ghostOk;
    this.ghost.setEnabled(true);
  }

  /** Place (and pay for) the current tool at `anchor`. Returns the building, or null if blocked. */
  place(anchor: Cell | null = this.hover): Building | null {
    if (!anchor) return null;
    const state = this.grid.state;
    if (this.tool === "boat") {
      const pier = this.grid.buildingAt(anchor);
      const ok = pier ? buyBoat(state, pier) : false;
      this.refresh();
      return ok ? pier : null;
    }
    const b = tryPlace(state, this.grid, this.tool, anchor);
    this.refresh();
    return b;
  }

  remove(at: Cell | null = this.hover): void {
    if (!at) return;
    const b = this.grid.buildingAt(at);
    if (!b) return;
    this.grid.remove(b);
    this.refresh();
  }
}

export function costLabel(kind: BuildingKind): string {
  const c = BUILDINGS[kind].cost;
  const parts = [`${c.money}$`];
  if (c.planks) parts.push(`${c.planks} planks`);
  if (c.timber) parts.push(`${c.timber} timber`);
  return parts.join(" + ");
}

function classHint(cls: PlacementClass): string {
  switch (cls) {
    case "flat": return "Needs the tidal flats";
    case "deep": return "Needs deep water";
    case "high": return "Needs high ground";
    case "flatOrHigh": return "Needs land";
    case "shore": return "Needs the shore";
    case "edge": return "Needs deep water against the shore";
  }
}
