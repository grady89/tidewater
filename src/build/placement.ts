// Pointer interaction: hover picks a cell, a ghost previews the footprint (tinted by placement validity and, for
// low decks, by which tides will flood it), click places (and pays), right-click removes. Placement writes to the
// sim through the Grid; meshes appear when the view syncs.
import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial } from "@babylonjs/core";
import { BuildingKind, BUILDINGS, PlacementClass } from "../sim/balance";
import { boatPurchaseBlocker, buyBoat, canAfford, tryPlace } from "../sim/economy";
import { Grid, HALF, worldToCell } from "../sim/grid";
import { Building, Cell } from "../sim/state";
import { floodFate } from "../sim/tide";

export type Tool = BuildingKind | "boat";
export type Fate = "safe" | "spring" | "always";

const CLICK_SLOP_PX = 5;

export class Placement {
  tool: Tool = "walkway";
  hover: Cell | null = null;
  /** Why the current hover can't be placed, for the HUD. Null when it can. */
  blocker: string | null = null;
  /** Which tides would flood the hovered footprint, when it can be placed. */
  fate: Fate = "safe";
  private readonly ghost: Mesh;
  private readonly mats: Record<"ok" | "spring" | "always" | "bad", StandardMaterial>;
  private down: { x: number; y: number; button: number } | null = null;

  constructor(private readonly scene: Scene, private readonly camera: ArcRotateCamera, private readonly grid: Grid, canvas: HTMLCanvasElement) {
    this.ghost = MeshBuilder.CreateBox("ghost", { size: 1 }, scene);
    this.ghost.scaling.y = 0.06;
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);
    this.mats = {
      ok: this.ghostMaterial("ghostOk", "#a8c97a"),
      spring: this.ghostMaterial("ghostSpring", "#ffb859"),
      always: this.ghostMaterial("ghostFlood", "#c9674f"),
      bad: this.ghostMaterial("ghostBad", "#8d8a83"),
    };
    this.ghost.material = this.mats.ok;

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

  /** Height of the plane the pointer is picked against: the deck the tool would build. */
  private pickY(): number {
    if (this.tool === "boat") return BUILDINGS.pier.floor as number;
    const f = BUILDINGS[this.tool].floor;
    return f === "stilts" ? 0.6 : f;
  }

  /**
   * Cell under the pointer. Intersects the picking ray with the plane at the tool's deck height, so the ghost
   * sits under the cursor; buildable terrain is always below that plane.
   */
  private pickCell(): Cell | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    const o = ray.origin, d = ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (this.pickY() - o.y) / d.y;
    if (t <= 0) return null;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return null;
    return worldToCell(x, z);
  }

  /** Footprint, blocker and flood fate for placing the current tool at `anchor`. */
  private evaluate(anchor: Cell): { cells: Cell[]; blocker: string | null; fate: Fate; y: number } {
    const state = this.grid.state;
    if (this.tool === "boat") {
      const b = this.grid.buildingAt(anchor);
      return { cells: b && (BUILDINGS[b.kind].slots ?? 0) > 0 ? b.cells : [anchor], blocker: boatPurchaseBlocker(state, b), fate: "safe", y: b?.floorY ?? 1 };
    }
    const kind = this.tool;
    const def = BUILDINGS[kind];
    const cells = this.grid.footprint(kind, anchor);
    if (!cells) return { cells: [anchor], blocker: def.cls === "edge" ? "Needs deep water against the shore" : "Off the map", fate: "safe", y: this.pickY() };
    const y = this.grid.floorFor(kind, cells);
    if (!this.grid.classOk(def.cls, cells)) return { cells, blocker: classHint(def.cls), fate: "safe", y };
    if (!this.grid.terrainOk(kind, cells)) return { cells, blocker: `Needs ground between ${def.terrain!.min} and ${def.terrain!.max} m`, fate: "safe", y };
    if (cells.some(c => this.grid.buildingAt(c))) return { cells, blocker: "Occupied", fate: "safe", y };
    if (!canAfford(state, def.cost)) return { cells, blocker: `Costs ${costLabel(kind)}`, fate: "safe", y };
    return { cells, blocker: null, fate: floodFate(y), y };
  }

  refresh(): void {
    this.hover = this.pickCell();
    if (!this.hover) { this.ghost.setEnabled(false); this.blocker = null; return; }
    const { cells, blocker, fate, y } = this.evaluate(this.hover);
    this.blocker = blocker;
    this.fate = fate;
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    this.ghost.position.set((minI + maxI + 1) / 2, y, (minJ + maxJ + 1) / 2);
    this.ghost.scaling.x = maxI - minI + 0.96;
    this.ghost.scaling.z = maxJ - minJ + 0.96;
    this.ghost.material = blocker ? this.mats.bad : fate === "safe" ? this.mats.ok : this.mats[fate];
    this.ghost.setEnabled(true);
  }

  /** Place (and pay for) the current tool at `anchor`. Returns the building, or null if blocked. */
  place(anchor: Cell | null = this.hover): Building | null {
    if (!anchor) return null;
    const state = this.grid.state;
    if (this.tool === "boat") {
      const at = this.grid.buildingAt(anchor);
      const ok = at ? buyBoat(state, at) : false;
      this.refresh();
      return ok ? at : null;
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
    case "flatOrDeep": return "Needs the flats or shallows";
    case "shore": return "Needs the shore";
    case "edge": return "Needs deep water against the shore";
  }
}
