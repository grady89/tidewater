// Pointer interaction: hover picks a cell, a ghost previews the footprint (tinted by placement validity and, for
// low decks, by which tides will flood it), click places (and pays), clicking an existing building inspects it,
// right-click removes. Placement writes to the sim through the Grid; meshes appear when the view syncs.
import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BuildingKind, BUILDINGS, PlacementClass } from "../sim/balance";
import { boatPurchaseBlocker, buyBoat, canAfford, placeCost, removeBuilding, tryPlace } from "../sim/economy";
import { LIFT_MAX } from "../sim/balance";
import { Grid, HALF, worldToCell } from "../sim/grid";
import { terrainHeight } from "../sim/heightfield";
import { addLantern, lanternBlocker } from "../sim/services";
import { Building, Cell } from "../sim/state";
import { floodFate } from "../sim/tide";

export type Tool = BuildingKind | "boat" | "lanternPost";
export type Fate = "safe" | "spring" | "always";

const CLICK_SLOP_PX = 5;
/** Per-cell pieces that are laid in runs: drag from one cell to another and the whole line goes down. */
const LINE_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["walkway", "raisedWalkway", "breakwater", "sharkNet", "seaWall"]);
const MAX_LINE = 40;

/** The cells from `a` to `b` as an L: first along the longer axis, then the other. Both ends included. */
export function linePath(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const di = b.i - a.i, dj = b.j - a.j;
  const iFirst = Math.abs(di) >= Math.abs(dj);
  let i = a.i, j = a.j;
  out.push({ i, j });
  const stepI = () => { while (i !== b.i) { i += Math.sign(di); out.push({ i, j }); } };
  const stepJ = () => { while (j !== b.j) { j += Math.sign(dj); out.push({ i, j }); } };
  if (iFirst) { stepI(); stepJ(); } else { stepJ(); stepI(); }
  return out.slice(0, MAX_LINE);
}

export class Placement {
  tool: Tool = "walkway";
  hover: Cell | null = null;
  /** Why the current hover can't be placed, for the HUD. Null when it can. */
  blocker: string | null = null;
  /** Which tides would flood the hovered footprint, when it can be placed. */
  fate: Fate = "safe";
  /** A non-blocking caution about the hovered footprint (it can go there, but won't be connected). */
  warn: string | null = null;
  /** The run being dragged out with a line tool: how many cells would be laid and what they cost. */
  line: { count: number; cost: number } | null = null;
  /** Called when the player clicks an existing building. */
  onSelect: (b: Building | null) => void = () => {};
  private readonly ghost: Mesh;
  private readonly lineGhosts: { ok: Mesh; bad: Mesh };
  private readonly mats: Record<"ok" | "spring" | "always" | "bad", StandardMaterial>;
  private down: { x: number; y: number; button: number } | null = null;
  private lineStart: Cell | null = null;
  private linePath: Cell[] = [];

  /** Line tools draw with the left button, so the camera must not grab the ground with it. */
  get dragsLine(): boolean { return LINE_TOOLS.has(this.tool); }

  /** Extra deck height for stilt pieces, in LIFT_STEP steps ([ and ] keys). */
  lift = 0;
  get liftable(): boolean { return this.tool !== "boat" && this.tool !== "lanternPost" && BUILDINGS[this.tool].floor === "stilts"; }
  adjustLift(delta: number): void {
    this.lift = Math.max(0, Math.min(LIFT_MAX, this.lift + delta));
    this.refresh();
  }
  private get toolLift(): number { return this.liftable ? this.lift : 0; }

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
    const lineGhost = (name: string, mat: StandardMaterial) => {
      const m = MeshBuilder.CreateBox(name, { size: 1 }, scene);
      m.scaling.y = 0.06; m.isPickable = false; m.material = mat; m.setEnabled(false);
      return m;
    };
    this.lineGhosts = { ok: lineGhost("ghostLineOk", this.mats.ok), bad: lineGhost("ghostLineBad", this.mats.bad) };

    canvas.addEventListener("pointermove", () => this.refresh());
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.ghost.setEnabled(false); });
    canvas.addEventListener("pointerdown", e => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 0 && this.dragsLine && this.hover) this.lineStart = this.hover;
    });
    canvas.addEventListener("pointerup", e => {
      const d = this.down;
      this.down = null;
      const start = this.lineStart;
      this.lineStart = null;
      if (!d || d.button !== e.button) { this.refresh(); return; }
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX;
      if (e.button === 0 && start && this.linePath.length > 1) { this.placeLine(); return; }
      if (moved) { this.refresh(); return; }
      if (e.button === 0) this.click();
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
    if (this.tool === "boat" || this.tool === "lanternPost") return BUILDINGS.pier.floor as number;
    const f = BUILDINGS[this.tool].floor;
    return typeof f === "number" ? f : 0.6;
  }

  /** Tools that can go on the hill are picked against the terrain itself. */
  private picksTerrain(): boolean {
    if (this.tool === "boat" || this.tool === "lanternPost") return false;
    const cls = BUILDINGS[this.tool].cls;
    return cls === "high" || cls === "flatOrHigh";
  }

  /**
   * Cell under the pointer. Flats tools intersect the picking ray with the plane at the tool's deck height, so the
   * ghost sits under the cursor (buildable terrain is always below that plane); hill tools march the heightfield.
   */
  private pickCell(): Cell | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    const o = ray.origin, d = ray.direction;
    let x: number, z: number;
    if (this.picksTerrain()) {
      const under = (t: number) => o.y + d.y * t < terrainHeight(o.x + d.x * t, o.z + d.z * t);
      let hit = -1, prev = 0;
      for (let t = 0.35; t < 250; t += 0.35) {
        if (d.y >= 0 && o.y + d.y * t > 8) return null;
        if (under(t)) { let lo = prev, hi = t; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (under(m)) hi = m; else lo = m; } hit = hi; break; }
        prev = t;
      }
      if (hit < 0) return null;
      x = o.x + d.x * hit; z = o.z + d.z * hit;
    } else {
      if (Math.abs(d.y) < 1e-6) return null;
      const t = (this.pickY() - o.y) / d.y;
      if (t <= 0) return null;
      x = o.x + d.x * t; z = o.z + d.z * t;
    }
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return null;
    return worldToCell(x, z);
  }

  /** The blocker for the current tool at `anchor` (null = it can go there). */
  check(anchor: Cell): string | null {
    return this.evaluate(anchor).blocker;
  }

  /** Footprint, blocker, caution and flood fate for placing the current tool at `anchor`. */
  private evaluate(anchor: Cell): { cells: Cell[]; blocker: string | null; warn: string | null; fate: Fate; y: number } {
    const state = this.grid.state;
    if (this.tool === "boat") {
      const b = this.grid.buildingAt(anchor);
      return { cells: b && (BUILDINGS[b.kind].slots ?? 0) > 0 ? b.cells : [anchor], blocker: boatPurchaseBlocker(state, b), warn: null, fate: "safe", y: b?.floorY ?? 1 };
    }
    if (this.tool === "lanternPost") {
      const b = this.grid.buildingAt(anchor);
      return { cells: [anchor], blocker: lanternBlocker(state, this.grid, anchor), warn: null, fate: "safe", y: b?.floorY ?? 1 };
    }
    const kind = this.tool;
    const def = BUILDINGS[kind];
    const cells = this.grid.footprint(kind, anchor);
    if (!cells) return { cells: [anchor], blocker: def.cls === "edge" ? "Needs deep water against the shore" : "Off the map", warn: null, fate: "safe", y: this.pickY() };
    const y = this.grid.floorFor(kind, cells, this.toolLift);
    const no = (blocker: string) => ({ cells, blocker, warn: null, fate: "safe" as Fate, y });
    if (!this.grid.classOk(def.cls, cells)) return no(classHint(def.cls));
    if (!this.grid.terrainOk(kind, cells)) return no(`Needs ground between ${def.terrain!.min} and ${def.terrain!.max} m`);
    if (cells.some(c => this.grid.buildingAt(c))) return no("Occupied");
    if (this.grid.onIsle(cells) && !this.grid.isleOpen()) return no("Across the water: a harbor's ferry opens the isle");
    if (def.needsWalkway && !this.grid.touchesWalkway(cells)) return no("Must touch a walkway on the flats");
    if (def.needsLink && !this.grid.touchesLink(cells)) return no("Must touch a pier or a raised walkway (they bridge deep water)");
    if (def.requires && !this.grid.has(def.requires)) return no(`Requires a ${BUILDINGS[def.requires].name.toLowerCase()}`);
    if (def.touches && !this.grid.touchesKind(cells, def.touches)) return no(`Must touch the ${BUILDINGS[def.touches].name.toLowerCase()}`);
    if (!canAfford(state, placeCost(kind, this.toolLift))) return no(`Costs ${costLabel(kind, this.toolLift)}`);
    // Placeable. Caution when nothing it touches is on the network: it would stand idle until a street reaches it.
    let warn: string | null = null;
    if (def.network !== "root" && !cells.some(c => this.grid.neighbors(c).some(n => { const b = this.grid.buildingAt(n); return !!b && (b.reached || BUILDINGS[b.kind].network === "root"); }))) {
      warn = def.network === "link" ? "Not joined to the town yet: streets need a pier at one end" : "No street touches it: nobody can reach it";
    }
    return { cells, blocker: null, warn, fate: floodFate(y), y };
  }

  /** The cells of the run being dragged, with what each would cost; blocked cells are skipped, not fatal. */
  private evaluateLine(): { cells: Cell[]; ok: boolean[]; cost: number } {
    const kind = this.tool as BuildingKind;
    const cost = placeCost(kind, this.toolLift).money;
    const ok = this.linePath.map(c => {
      const cells = this.grid.footprint(kind, c);
      return !!cells && this.grid.classOk(BUILDINGS[kind].cls, cells) && !this.grid.buildingAt(c) && (!this.grid.onIsle(cells) || this.grid.isleOpen());
    });
    return { cells: this.linePath, ok, cost: ok.filter(Boolean).length * cost };
  }

  /** Lay the dragged run in order, so each deck meets the one before; stop when the money runs out. */
  private placeLine(): void {
    const kind = this.tool as BuildingKind;
    for (const c of this.linePath) tryPlace(this.grid.state, this.grid, kind, c, this.toolLift);
    this.linePath = [];
    this.line = null;
    this.onSelect(null);
    this.refresh();
  }

  private showLine(): void {
    const { cells, ok, cost } = this.evaluateLine();
    this.line = { count: ok.filter(Boolean).length, cost };
    const okM: number[] = [], badM: number[] = [];
    cells.forEach((c, k) => {
      const y = ok[k] ? this.grid.floorFor(this.tool as BuildingKind, [c], this.toolLift) : this.pickY();
      Matrix.Compose(new Vector3(0.96, 1, 0.96), Quaternion.Identity(), new Vector3(c.i + 0.5, y, c.j + 0.5)).copyToArray(ok[k] ? okM : badM, (ok[k] ? okM : badM).length);
    });
    for (const [mesh, m] of [[this.lineGhosts.ok, okM], [this.lineGhosts.bad, badM]] as [Mesh, number[]][]) {
      if (!m.length) { mesh.setEnabled(false); continue; }
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
      mesh.setEnabled(true);
    }
    this.ghost.setEnabled(false);
  }

  refresh(): void {
    this.hover = this.pickCell();
    if (this.lineStart && this.hover) {
      this.linePath = linePath(this.lineStart, this.hover);
      this.showLine();
      this.blocker = null; this.warn = null;
      return;
    }
    this.lineGhosts.ok.setEnabled(false); this.lineGhosts.bad.setEnabled(false);
    this.line = null;
    if (!this.hover) { this.ghost.setEnabled(false); this.blocker = null; this.warn = null; return; }
    const { cells, blocker, warn, fate, y } = this.evaluate(this.hover);
    this.blocker = blocker;
    this.warn = warn;
    this.fate = fate;
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    this.ghost.position.set((minI + maxI + 1) / 2, y, (minJ + maxJ + 1) / 2);
    this.ghost.scaling.x = maxI - minI + 0.96;
    this.ghost.scaling.z = maxJ - minJ + 0.96;
    this.ghost.material = blocker ? this.mats.bad : fate === "safe" ? this.mats.ok : this.mats[fate];
    this.ghost.setEnabled(true);
  }

  /** Left click: place if possible, otherwise inspect whatever is there. */
  private click(): void {
    if (!this.hover) return;
    const existing = this.grid.buildingAt(this.hover);
    const placed = this.place();
    if (placed) { this.onSelect(null); return; }
    this.onSelect(existing);
  }

  /** Place (and pay for) the current tool at `anchor`. Returns the building, or null if blocked. */
  place(anchor: Cell | null = this.hover): Building | null {
    if (!anchor) return null;
    const state = this.grid.state;
    let result: Building | null = null;
    if (this.tool === "boat") {
      const at = this.grid.buildingAt(anchor);
      result = at && buyBoat(state, at) ? at : null;
    } else if (this.tool === "lanternPost") {
      result = addLantern(state, this.grid, anchor) ? this.grid.buildingAt(anchor) : null;
    } else {
      result = tryPlace(state, this.grid, this.tool, anchor, this.toolLift);
    }
    this.refresh();
    return result;
  }

  remove(at: Cell | null = this.hover): void {
    if (!at) return;
    const b = this.grid.buildingAt(at);
    if (!b) return;
    removeBuilding(this.grid.state, this.grid, b);
    this.onSelect(null);
    this.refresh();
  }
}

export function costLabel(kind: BuildingKind, lift = 0): string {
  const c = placeCost(kind, lift);
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
    case "beach": return "Needs a beach: sand above the tide line";
    case "highOrEdge": return "Needs high ground or deep water against the shore";
  }
}
