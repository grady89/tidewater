// Pointer interaction: hover picks a cell, a ghost previews the footprint (tinted by placement validity and, for
// low decks, by which tides will flood it), click places (and pays), clicking an existing building inspects it,
// right-click removes. Placement writes to the sim through the Grid; meshes appear when the view syncs.
import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BuildingKind, BUILDINGS, LINE_KINDS, PlacementClass, ROTATABLE_CLASSES, STREET_STEP_MAX } from "../sim/balance";
import { autoStilts, boatPurchaseBlocker, buyBoat, canAfford, placeCost, removeBuilding, tryPlace } from "../sim/economy";
import { BOAT_COST, LANDFILL_COST, LANTERN_COST, LIFT_MAX, PLANT_COST } from "../sim/balance";
import { CLEARANCE } from "../config";
import type { BiomeId } from "../sim/biomes";
import { DIRS, Grid, HALF, inBounds, worldToCell } from "../sim/grid";
import { Axis, linePath, MAX_LINE, routePath } from "./line";
export { linePath, routePath } from "./line";
import { ground as groundHeight } from "../view/ground";
import { addLandfill, clearBlocker, clearTree, landfillBlocker, plantBlocker, plantTree } from "../sim/land";
import { MATERIAL_LABEL, UNBUILDABLE } from "../sim/materials";
import { addLantern, lanternBlocker } from "../sim/services";
import { Building, Cell } from "../sim/state";
import { floodFate } from "../sim/tide";

export type Tool = BuildingKind | "boat" | "lanternPost" | "landfill" | "plantTree" | "clearTree";
const SPECIAL: ReadonlySet<Tool> = new Set<Tool>(["boat", "lanternPost", "landfill", "plantTree", "clearTree"]);
export function isBuildingTool(t: Tool): t is BuildingKind { return !SPECIAL.has(t); }
export type Fate = "safe" | "spring" | "always";

const CLICK_SLOP_PX = 5;
/** Per-cell pieces that are laid in runs: drag from one cell to another and the whole line goes down. */
const LINE_TOOLS: ReadonlySet<Tool> = new Set<Tool>(LINE_KINDS);
/** Buildings on land turn with R (streets, and everything in the water, keep their one orientation). */
const ROTATABLE = ROTATABLE_CLASSES;
/** Where the door is for each quarter turn: −z, −x, +z, +x. */
const DOOR_SIDE: readonly Cell[] = [{ i: 0, j: -1 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }];

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
  /** Called after each placement (the tool, what it touched, what it cost) and each removal (with the refund). */
  onPlace: (tool: Tool, b: Building, cost: number) => void = () => {};
  onRemove: (b: Building, refund: number) => void = () => {};
  private readonly ghost: Mesh;
  private readonly lineGhosts: { ok: Mesh; bad: Mesh };
  private readonly mats: Record<"ok" | "spring" | "always" | "bad", StandardMaterial>;
  private down: { x: number; y: number; button: number } | null = null;
  private lineStart: Cell | null = null;
  /** The axis the pointer left the start cell on: the L bends after that leg. */
  private lineAxis: Axis | null = null;
  private linePath: Cell[] = [];

  /**
   * Phones (ui/mobile.ts): the canvas's own pointer handlers leave touches alone, and placing takes two steps. A tap
   * pins the ghost to a cell (`pinned`); a street tool's drag lays out a run that waits there; `confirm` builds
   * what is pinned, `cancel` drops it. While a finger drags a run, `pinPoint` is the screen point it is over.
   */
  touchMode = false;
  pinned: Cell | null = null;
  private pinPoint: { x: number; y: number } | null = null;

  /** Line tools draw with the left button, so the camera must not grab the ground with it. */
  get dragsLine(): boolean { return LINE_TOOLS.has(this.tool); }
  /** Off while the World is shown (the canvas is shared); the ghost hides and clicks are ignored. */
  private _enabled = true;
  get enabled(): boolean { return this._enabled; }
  set enabled(on: boolean) {
    this._enabled = on;
    if (!on) { this.hover = null; this.down = null; this.lineStart = null; this.linePath = []; this.tagAt = null; this.tag.hidden = true; this.ghost.setEnabled(false); this.ghostStilts.setEnabled(false); this.ghostDoor.setEnabled(false); this.lineGhosts.ok.setEnabled(false); this.lineGhosts.bad.setEnabled(false); }
  }

  /** Extra deck height for auto-sized pieces, in LIFT_STEP steps ([ and ] keys); never below the safe height. */
  lift = 0;
  get liftable(): boolean { return isBuildingTool(this.tool) && autoStilts(this.tool); }
  /** Stilt length (floor − ground) and full price of the hovered footprint, for the ghost's label. */
  stilt = 0;
  cost = 0;
  /** The price (and any caution) pinned beside the ghost, so the real cost is read where the eye is. */
  private readonly tag: HTMLElement;
  private tagAt: { x: number; y: number; z: number } | null = null;
  private readonly ghostStilts: Mesh;
  /** Called with the cell when landfill goes down, so the view can raise the ground. */
  onLandfill: (c: Cell) => void = () => {};
  /** Set when a land tool succeeded (the smoke reads it); the view polls the ledger anyway. */
  landChanged = false;
  adjustLift(delta: number): void {
    this.lift = Math.max(0, Math.min(LIFT_MAX, this.lift + delta));
    this.refresh();
  }
  private get toolLift(): number { return this.liftable ? this.lift : 0; }

  /** Quarter turns the player gave the ghost with R; null lets the door face the street on its own. */
  turns: number | null = null;
  get rotatable(): boolean { return isBuildingTool(this.tool) && ROTATABLE.has(BUILDINGS[this.tool].cls) && !LINE_TOOLS.has(this.tool); }
  /** R: one more quarter turn from whatever the ghost shows now (its own facing, or the last turn given). */
  rotate(): void {
    if (!this.rotatable) return;
    const current = this.hover ? this.evaluate(this.hover).rot : (this.turns ?? 0);
    this.turns = (current + 1) & 3;
    this.refresh();
  }
  private readonly ghostDoor: Mesh;

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
      // The thickness is in the geometry, not the scaling: thin instances sit in the mesh's own frame, and a
      // 0.06 y-scale would flatten every instance's height onto the sea (the run's ghost was buried for a while).
      const m = MeshBuilder.CreateBox(name, { width: 1, height: 0.06, depth: 1 }, scene);
      m.isPickable = false; m.material = mat; m.setEnabled(false);
      return m;
    };
    this.lineGhosts = { ok: lineGhost("ghostLineOk", this.mats.ok), bad: lineGhost("ghostLineBad", this.mats.bad) };
    // The ghost's stilts: four thin posts from the deck down to the ground, so the stilt length is seen.
    this.ghostStilts = MeshBuilder.CreateBox("ghostStilts", { size: 1 }, scene);
    this.ghostStilts.isPickable = false;
    this.ghostStilts.material = this.mats.ok;
    this.ghostStilts.setEnabled(false);
    // The ghost's door: a blue tab on the side the door will face, so a turn is seen before it is paid for.
    this.ghostDoor = MeshBuilder.CreateBox("ghostDoor", { size: 1 }, scene);
    this.ghostDoor.isPickable = false;
    const doorMat = this.ghostMaterial("ghostDoorMat", "#2f6f8f");
    doorMat.alpha = 0.95;
    this.ghostDoor.material = doorMat;
    this.ghostDoor.setEnabled(false);
    this.tag = document.createElement("div");
    this.tag.id = "costTag";
    this.tag.hidden = true;
    document.body.appendChild(this.tag);

    const touch = (e: PointerEvent) => this.touchMode && e.pointerType === "touch";
    canvas.addEventListener("pointermove", e => { if (this.enabled && !touch(e)) this.refresh(); });
    canvas.addEventListener("pointerleave", e => { if (touch(e)) return; this.hover = null; this.ghost.setEnabled(false); this.ghostStilts.setEnabled(false); this.ghostDoor.setEnabled(false); });
    canvas.addEventListener("pointerdown", e => {
      if (!this.enabled || touch(e)) return;
      this.refresh(); // pick where the press lands, not where the pointer last moved
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 0 && this.dragsLine && this.hover) { this.lineStart = this.hover; this.lineAxis = null; }
    });
    canvas.addEventListener("pointerup", e => {
      if (touch(e)) return;
      const d = this.down;
      this.down = null;
      const start = this.lineStart;
      this.lineStart = null;
      if (!d || d.button !== e.button) { this.linePath = []; this.refresh(); return; }
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX;
      if (e.button === 0 && start && this.linePath.length > 1) { this.placeLine(); return; }
      this.linePath = [];
      this.refresh();
      if (moved && !start) return; // a line drag that never left its cell is a click
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
    if (tool !== this.tool) { this.turns = null; this.pinned = null; this.lineStart = null; this.linePath = []; }
    this.tool = tool;
    this.refresh();
  }

  /** Height of the plane the pointer is picked against: the deck the tool would build. */
  private pickY(): number {
    const t = this.grid.tides;
    if (this.tool === "boat" || this.tool === "lanternPost") return t.pierFloor;
    if (this.tool === "landfill") return t.hi;
    if (!isBuildingTool(this.tool)) return t.groundFloor;
    const f = BUILDINGS[this.tool].floor;
    if (typeof f === "number") return f * t.scale;
    if (f === "street") return t.hi + CLEARANCE;
    if (f === "stilts") return t.floodHi + CLEARANCE;
    return t.hi;
  }

  /** Tools that can go on the hill are picked against the terrain itself. */
  private picksTerrain(): boolean {
    if (this.tool === "plantTree" || this.tool === "clearTree") return true;
    if (!isBuildingTool(this.tool)) return false;
    const cls = BUILDINGS[this.tool].cls;
    return cls === "high" || cls === "flatOrHigh" || cls === "street";
  }

  /**
   * Cell under the pointer. Flats tools intersect the picking ray with the plane at the tool's deck height, so the
   * ghost sits under the cursor (buildable terrain is always below that plane); hill tools march the heightfield.
   */
  private pickCell(px = this.scene.pointerX, py = this.scene.pointerY): Cell | null {
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), this.camera);
    const o = ray.origin, d = ray.direction;
    let x: number, z: number;
    if (this.picksTerrain()) {
      const under = (t: number) => o.y + d.y * t < groundHeight(o.x + d.x * t, o.z + d.z * t);
      let hit = -1, prev = 0;
      for (let t = 0.35; t < 250; t += 0.35) {
        if (d.y >= 0 && o.y + d.y * t > 8) return null;
        if (under(t)) { let lo = prev, hi = t; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (under(m)) hi = m; else lo = m; } hit = hi; break; }
        prev = t;
      }
      if (hit < 0) return null;
      x = o.x + d.x * hit; z = o.z + d.z * hit;
      // Over water the ground lies far below the pointer, so the terrain hit lands cells beyond the deck the
      // player points at (a drag begun on the pier began three cells past it): there, pick the deck plane.
      if (groundHeight(x, z) < this.grid.state.tide.level && Math.abs(d.y) > 1e-6) {
        const t = (this.pickY() - o.y) / d.y;
        if (t > 0) { x = o.x + d.x * t; z = o.z + d.z * t; }
      }
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

  /** Footprint, blocker, caution, flood fate, stilt length, price and turn for placing the current tool at `anchor`. */
  private evaluate(anchor: Cell): { cells: Cell[]; blocker: string | null; warn: string | null; fate: Fate; y: number; stilt: number; cost: number; rot: number } {
    const state = this.grid.state;
    if (this.tool === "boat") {
      const b = this.grid.buildingAt(anchor);
      return { cells: b && (BUILDINGS[b.kind].slots ?? 0) > 0 ? b.cells : [anchor], blocker: boatPurchaseBlocker(state, b), warn: null, fate: "safe", y: b?.floorY ?? 1, stilt: 0, cost: BOAT_COST, rot: 0 };
    }
    if (this.tool === "lanternPost") {
      const b = this.grid.buildingAt(anchor);
      return { cells: [anchor], blocker: lanternBlocker(state, this.grid, anchor), warn: null, fate: "safe", y: b?.floorY ?? 1, stilt: 0, cost: LANTERN_COST, rot: 0 };
    }
    if (this.tool === "landfill") return { cells: [anchor], blocker: landfillBlocker(state, this.grid, anchor), warn: null, fate: "safe", y: this.grid.tides.landfillHeight + 0.03, stilt: 0, cost: LANDFILL_COST.money, rot: 0 };
    if (this.tool === "plantTree") return { cells: [anchor], blocker: plantBlocker(state, this.grid, anchor), warn: null, fate: "safe", y: this.grid.heightAt(anchor) + 0.05, stilt: 0, cost: PLANT_COST, rot: 0 };
    if (this.tool === "clearTree") return { cells: [anchor], blocker: clearBlocker(state, this.grid, anchor), warn: null, fate: "safe", y: this.grid.heightAt(anchor) + 0.05, stilt: 0, cost: 0, rot: 0 };
    const kind = this.tool;
    const def = BUILDINGS[kind];
    const cells = this.grid.footprint(kind, anchor, this.turns ?? 0);
    if (!cells) return { cells: [anchor], blocker: def.cls === "edge" ? "Needs deep water against the shore" : "Off the map", warn: null, fate: "safe", y: this.pickY(), stilt: 0, cost: def.cost.money, rot: this.turns ?? 0 };
    const rot = this.rotatable ? (this.turns ?? this.grid.facing(cells)) : 0;
    const y = this.grid.floorFor(kind, cells, this.toolLift);
    const stilt = this.grid.stiltLength(kind, cells, y);
    const cost = placeCost(kind, stilt, this.grid.state.world.biome).money;
    const no = (blocker: string) => ({ cells, blocker, warn: null, fate: "safe" as Fate, y, stilt, cost, rot });
    if (!this.grid.inCatalog(kind)) return no("Not built on this coast");
    if (!this.grid.classOk(def.cls, cells)) return no(classHint(def.cls));
    if (!this.grid.terrainOk(kind, cells)) return no(`Needs ground between ${def.terrain!.min} and ${def.terrain!.max} m`);
    if (!this.grid.materialOk(kind, cells)) return no(def.material && !cells.some(c => UNBUILDABLE.has(this.grid.materialAt(c))) ? `Needs ${MATERIAL_LABEL[def.material]}` : "Nothing stands on the lava field");
    if (cells.some(c => this.grid.buildingAt(c))) return no("Occupied");
    if (this.grid.treeOn(cells)) return no("A tree stands here: clear it (Land tab) or go round");
    if (!this.grid.slopeOk(kind, cells)) return no("Too steep to walk: a path takes gentler ground");
    if (!this.grid.joinStepOk(kind, cells)) return no(`Too big a step to the street beside it: a path climbs at most ${BUILDINGS.path.maxRise} m a cell, a stair ${STREET_STEP_MAX} m`);
    if (this.grid.onIsle(cells) && !this.grid.isleOpen()) return no("Across the water: a harbor's ferry opens the isle");
    if (def.needsWalkway && !this.grid.touchesWalkway(cells)) return no("Must touch a walkway on the flats");
    if (def.needsLink && !this.grid.touchesLink(cells)) return no("Must touch a pier or a raised walkway (they bridge deep water)");
    if (def.requires && !this.grid.has(def.requires)) return no(`Requires a ${BUILDINGS[def.requires].name.toLowerCase()}`);
    if (def.touches && !this.grid.touchesKind(cells, def.touches)) return no(`Must touch the ${BUILDINGS[def.touches].name.toLowerCase()}`);
    if (!canAfford(state, placeCost(kind, stilt, state.world.biome))) return no(`Costs ${costLabel(kind, stilt, state.world.biome)}`);
    // Placeable. Caution when nothing it touches is on the network: it would stand idle until a street reaches it.
    let warn: string | null = null;
    if (def.network !== "root" && !cells.some(c => this.grid.neighbors(c).some(n => { const b = this.grid.buildingAt(n); return !!b && (b.reached || BUILDINGS[b.kind].network === "root"); }))) {
      warn = def.network === "link" ? "Not joined to the town yet: a street starts at a pier, dock or harbor and runs to here without a gap" : "No street touches it: nobody can reach it";
    }
    return { cells, blocker: null, warn, fate: floodFate(y, this.grid.tides), y, stilt, cost, rot };
  }

  /** The blue door tab on the side the building will face. */
  private showDoor(cells: Cell[], y: number, rot: number, on: boolean): void {
    if (!on) { this.ghostDoor.setEnabled(false); return; }
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is) + 1, minJ = Math.min(...js), maxJ = Math.max(...js) + 1;
    const cx = (minI + maxI) / 2, cz = (minJ + maxJ) / 2;
    const side = DOOR_SIDE[rot & 3];
    const x = side.i === 0 ? cx : side.i < 0 ? minI + 0.05 : maxI - 0.05;
    const z = side.j === 0 ? cz : side.j < 0 ? minJ + 0.05 : maxJ - 0.05;
    this.ghostDoor.position.set(x, y + 0.1, z);
    this.ghostDoor.scaling.set(side.i === 0 ? 0.32 : 0.08, 0.2, side.i === 0 ? 0.08 : 0.32);
    this.ghostDoor.setEnabled(true);
  }

  private fitsKind(kind: BuildingKind, c: Cell): boolean {
    const cells = this.grid.footprint(kind, c);
    return !!cells && this.grid.classOk(BUILDINGS[kind].cls, cells) && !this.grid.buildingAt(c) && (!this.grid.onIsle(cells) || this.grid.isleOpen())
      && !this.grid.treeOn(cells) && this.grid.slopeOk(kind, cells) && this.grid.joinStepOk(kind, cells);
  }

  /** A street piece or a berth orthogonally beside `c`: the run leaves from it when `c` itself cannot take the run. */
  private streetBeside(c: Cell): Building | null {
    for (const d of DIRS) {
      const b = this.grid.buildingAt({ i: c.i + d.i, j: c.j + d.j });
      if (b && BUILDINGS[b.kind].network !== "leaf") return b;
    }
    return null;
  }

  /**
   * What the current line tool lays at `c`: the tool's own kind where it fits; for the two streets, the other
   * one where only it fits (a walkway run climbs onto the dry hill as a path, a path run drops onto the flats as
   * a walkway — one drag, one street). Null where nothing fits.
   */
  private lineKindAt(c: Cell): BuildingKind | null {
    const kind = this.tool as BuildingKind;
    if (this.fitsKind(kind, c)) return kind;
    const other = kind === "walkway" ? "path" : kind === "path" ? "walkway" : null;
    return other && this.fitsKind(other, c) ? other : null;
  }

  /** Whether one cell of the current line tool can be laid at `c` (class, occupancy, the isle's ferry). */
  private lineFits(c: Cell): boolean {
    return this.lineKindAt(c) !== null;
  }

  /** The nearest cell within `r` of `c` where `kind` can stand, `c` itself first (a pier click lands beside the spot). */
  private snapTo(kind: BuildingKind, c: Cell, r: number): Cell | null {
    let best: Cell | null = null, bd = Infinity;
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const n = { i: c.i + di, j: c.j + dj };
      if (!inBounds(n.i, n.j)) continue;
      const fp = this.grid.footprint(kind, n);
      if (!fp || !this.grid.canPlace(kind, fp)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** What laying the current line tool at `c` would cost (its own stilts against the ground; Infinity where nothing fits). */
  private lineCostAt(c: Cell): number {
    const k = this.lineKindAt(c);
    if (!k) return Infinity;
    const cells = this.grid.footprint(k, c)!;
    return placeCost(k, this.grid.stiltLength(k, cells, this.grid.floorFor(k, cells, this.toolLift)), this.grid.state.world.biome).money;
  }

  /** The nearest cell within `r` of `c` under a pier, dock or harbor: the boat tool's click lands beside the berth as often as on it. */
  private nearestBerth(c: Cell, r: number): Cell | null {
    let best: Cell | null = null, bd = Infinity;
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const n = { i: c.i + di, j: c.j + dj };
      if (!inBounds(n.i, n.j)) continue;
      const b = this.grid.buildingAt(n);
      if (!b || (BUILDINGS[b.kind].slots ?? 0) === 0) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Pin `text` beside the world point `at` (null hides it). */
  private setTag(text: string | null, kind: "ok" | "warn" | "blocked", at: { x: number; y: number; z: number } | null): void {
    this.tagAt = text ? at : null;
    if (text) { this.tag.textContent = text; this.tag.className = kind; }
    this.syncTag();
  }

  /** Re-project the tag onto the screen (called every frame: the camera moves under a still pointer). */
  syncTag(): void {
    const at = this.tagAt;
    if (!at || !this.enabled) { this.tag.hidden = true; return; }
    const engine = this.scene.getEngine();
    const s = Vector3.Project(new Vector3(at.x, at.y, at.z), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    if (s.z > 1) { this.tag.hidden = true; return; }
    const k = engine.getHardwareScalingLevel();
    const r = (engine.getRenderingCanvas() as HTMLCanvasElement).getBoundingClientRect();
    this.tag.style.left = `${s.x * k + r.left}px`;
    this.tag.style.top = `${s.y * k + r.top}px`;
    this.tag.hidden = false;
  }

  /** The cells of the run being dragged, with what each would cost; blocked cells are skipped, not fatal. */
  private evaluateLine(): { cells: Cell[]; ok: boolean[]; cost: number } {
    const kind = this.tool as BuildingKind;
    let cost = 0;
    const ok = this.linePath.map(c => {
      const k = this.lineKindAt(c) ?? kind;
      const fits = k !== kind || this.fitsKind(kind, c);
      // Each cell prices its own stilts (the run is laid in order, so later cells may snap to earlier ones; the
      // preview prices each against the ground alone, which is the floor of what it will cost).
      if (fits) { const cells = this.grid.footprint(k, c)!; cost += placeCost(k, this.grid.stiltLength(k, cells, this.grid.floorFor(k, cells, this.toolLift)), this.grid.state.world.biome).money; }
      return fits;
    });
    return { cells: this.linePath, ok, cost };
  }

  /** Lay the dragged run in order, so each deck meets the one before; stop when the money runs out. */
  private placeLine(): void {
    const kind = this.tool as BuildingKind;
    for (const c of this.linePath) {
      const before = this.grid.state.resources.money;
      const k = this.lineKindAt(c) ?? kind;
      const b = tryPlace(this.grid.state, this.grid, k, c, this.toolLift, 0);
      if (b) this.onPlace(k, b, before - this.grid.state.resources.money);
    }
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
      // A ground piece's ghost stands on the rendered ground as a low block: a slab sinks into the slope.
      const kindAt = this.lineKindAt(c) ?? (this.tool as BuildingKind);
      const onGround = ok[k] && BUILDINGS[kindAt].floor === "terrain";
      const y = !ok[k] ? this.pickY() : onGround ? groundHeight(c.i + 0.5, c.j + 0.5) + 0.14 : this.grid.floorFor(kindAt, [c], this.toolLift);
      Matrix.Compose(new Vector3(0.96, onGround ? 4 : 1, 0.96), Quaternion.Identity(), new Vector3(c.i + 0.5, y, c.j + 0.5)).copyToArray(ok[k] ? okM : badM, (ok[k] ? okM : badM).length);
    });
    for (const [mesh, m] of [[this.lineGhosts.ok, okM], [this.lineGhosts.bad, badM]] as [Mesh, number[]][]) {
      if (!m.length) { mesh.setEnabled(false); continue; }
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
      mesh.setEnabled(true);
    }
    this.ghost.setEnabled(false);
  }

  /** Four ghost posts from the deck at `y` down to the ground under the footprint's corners. */
  private showStilts(cells: Cell[], y: number, on: boolean): void {
    if (!on) { this.ghostStilts.setEnabled(false); return; }
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is) + 1, minJ = Math.min(...js), maxJ = Math.max(...js) + 1;
    const m: number[] = [];
    for (const x of [minI + 0.15, maxI - 0.15]) for (const z of [minJ + 0.15, maxJ - 0.15]) {
      const g = this.grid.heightAt(worldToCell(x, z));
      const h = Math.max(0.02, y - g);
      Matrix.Compose(new Vector3(0.06, h, 0.06), Quaternion.Identity(), new Vector3(x, g + h / 2, z)).copyToArray(m, m.length);
    }
    this.ghostStilts.material = this.ghost.material;
    this.ghostStilts.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
    this.ghostStilts.setEnabled(true);
  }

  refresh(): void {
    this.hover = this.touchMode
      ? (this.pinPoint ? this.pickCell(this.pinPoint.x, this.pinPoint.y) : this.pinned)
      : this.pickCell();
    if (this.lineStart && this.hover) {
      this.ghostStilts.setEnabled(false);
      this.ghostDoor.setEnabled(false);
      // The run is one street from where the drag began to the pointer: straight, or one bend after the leg
      // the pointer left the start cell on, and routed round whatever blocks it (the cheapest way, with the
      // fewest turns). It is recomputed from the start on every move, so a wobble of the hand leaves no
      // staircase; another bend is another drag, from the end of this one. Where no route exists the plain L
      // shows, red where it cannot go.
      const start = this.lineStart, end = this.hover;
      if (this.lineAxis === null && (end.i !== start.i || end.j !== start.j)) this.lineAxis = Math.abs(end.i - start.i) >= Math.abs(end.j - start.j) ? "i" : "j";
      const axis = this.lineAxis ?? undefined;
      // A drag begun on ground the run cannot take, beside a street (the flats at the foot of the hill, where a
      // path cannot go), leaves from that street, so the run joins it.
      const from = this.grid.buildingAt(start) ?? (this.lineFits(start) ? null : this.streetBeside(start));
      const to = this.grid.buildingAt(end);
      const kind = this.tool as BuildingKind;
      const step = (p: Cell, q: Cell) => this.grid.stepOk(this.lineKindAt(p) ?? kind, p, this.lineKindAt(q) ?? kind, q);
      const body = routePath(start, end, c => this.lineFits(c), MAX_LINE, { cost: c => this.lineCostAt(c), axis, step, startCells: from?.cells, goalCells: to?.cells })
        ?? linePath(start, end, axis).slice(1);
      this.linePath = (this.lineFits(start) ? [start, ...body] : body).slice(0, MAX_LINE);
      this.showLine();
      this.blocker = null; this.warn = null;
      const laid = this.line && this.line.count > 0;
      this.setTag(laid ? `${this.line!.count} × ${BUILDINGS[this.tool as BuildingKind].name.toLowerCase()} · ${this.line!.cost}$` : "Nothing can be laid here", laid ? "ok" : "blocked", { x: this.hover.i + 0.5, y: this.pickY(), z: this.hover.j + 0.5 });
      return;
    }
    this.lineGhosts.ok.setEnabled(false); this.lineGhosts.bad.setEnabled(false);
    this.line = null;
    if (!this.hover) { this.ghost.setEnabled(false); this.ghostStilts.setEnabled(false); this.ghostDoor.setEnabled(false); this.blocker = null; this.warn = null; this.setTag(null, "ok", null); return; }
    // An edge piece's spot (pier, outfall, shipyard) is one exact cell: a click that lands a cell off takes the
    // nearest spot that works.
    const edgeKind = (this.tool as string) in BUILDINGS && BUILDINGS[this.tool as BuildingKind].cls === "edge" ? (this.tool as BuildingKind) : null;
    if (edgeKind) { const fp = this.grid.footprint(edgeKind, this.hover); if (!fp || !this.grid.canPlace(edgeKind, fp)) { const snapped = this.snapTo(edgeKind, this.hover, 1); if (snapped) this.hover = snapped; } }
    // The boat tool: a click within two cells of a pier, dock or harbor buys there.
    if (this.tool === "boat") { const at = this.grid.buildingAt(this.hover); if (!at || (BUILDINGS[at.kind].slots ?? 0) === 0) { const berth = this.nearestBerth(this.hover, 2); if (berth) this.hover = berth; } }
    const { cells, blocker, warn, fate, y, stilt, cost, rot } = this.evaluate(this.hover);
    this.stilt = stilt;
    this.cost = cost;
    this.showStilts(cells, y, !blocker && this.liftable);
    this.showDoor(cells, y, rot, !blocker && this.rotatable);
    this.blocker = blocker;
    this.warn = warn;
    this.fate = fate;
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const minI = Math.min(...is), maxI = Math.max(...is), minJ = Math.min(...js), maxJ = Math.max(...js);
    const onGround = isBuildingTool(this.tool) && BUILDINGS[this.tool].floor === "terrain";
    this.ghost.scaling.y = onGround ? 0.24 : 0.06;
    this.ghost.position.set((minI + maxI + 1) / 2, onGround ? groundHeight((minI + maxI + 1) / 2, (minJ + maxJ + 1) / 2) + 0.14 : y, (minJ + maxJ + 1) / 2);
    this.ghost.scaling.x = maxI - minI + 0.96;
    this.ghost.scaling.z = maxJ - minJ + 0.96;
    this.ghost.material = blocker ? this.mats.bad : fate === "safe" ? this.mats.ok : this.mats[fate];
    this.ghost.setEnabled(true);
    const f = fate as string;
    const note = blocker ?? [`${cost}$`, stilt > 0.05 ? `stilts ${stilt.toFixed(1)} m` : null, f === "safe" ? null : f === "always" ? "floods every tide" : "floods at spring tides", warn].filter((t): t is string => t !== null).join(" · ");
    this.setTag(note, blocker ? "blocked" : warn || f !== "safe" ? "warn" : "ok", { x: (minI + maxI + 1) / 2, y: y + 0.3, z: (minJ + maxJ + 1) / 2 });
  }

  /** Left click: place if possible, otherwise inspect whatever is there. */
  private click(): void {
    if (!this.hover) return;
    const existing = this.grid.buildingAt(this.hover);
    const placed = this.place();
    if (placed) { this.onSelect(null); return; }
    this.onSelect(existing);
  }

  /** The cell under a screen point (canvas pixels), picked as the current tool picks. */
  cellAt(x: number, y: number): Cell | null {
    return this.pickCell(x, y);
  }

  /** A finger went down (touch mode): a street tool starts a run there. */
  touchStart(x: number, y: number): void {
    if (!this.enabled || !this.dragsLine) return;
    this.pinned = null;
    this.pinPoint = { x, y };
    const c = this.pickCell(x, y);
    this.lineStart = c; this.lineAxis = null; this.linePath = [];
    this.refresh();
  }
  /** The finger moved: the run follows it. */
  touchMove(x: number, y: number): void {
    if (!this.lineStart) return;
    this.pinPoint = { x, y };
    this.refresh();
  }
  /**
   * The finger lifted. A run that left its cell waits for confirm, its end pinned; anything else was a tap, which
   * pins the ghost where it landed (tapping a run's cell with a street tool pins that one cell).
   */
  touchEnd(x: number, y: number): void {
    if (!this.enabled) return;
    const end = this.pickCell(x, y);
    this.pinPoint = null;
    if (this.lineStart && this.linePath.length > 1) { this.pinned = end ?? this.hover; this.refresh(); return; }
    this.lineStart = null; this.linePath = [];
    this.pinned = end;
    this.refresh();
  }
  /** A second finger came down: whatever the first was drawing is dropped (the camera takes the gesture). */
  touchAbort(): void {
    this.pinPoint = null;
    if (this.lineStart) { this.lineStart = null; this.linePath = []; this.pinned = null; this.refresh(); }
  }
  /** Something is pinned and waiting for confirm (a ghost, or a run). */
  get pending(): "run" | "piece" | null {
    if (this.lineStart && this.linePath.length > 1 && this.pinned) return "run";
    return this.pinned ? "piece" : null;
  }
  /** Build what is pinned. Returns whether anything was built. */
  confirm(): boolean {
    if (this.lineStart && this.linePath.length > 1) {
      const before = this.grid.state.resources.money;
      this.placeLine();
      this.lineStart = null; this.pinned = null; this.refresh();
      return this.grid.state.resources.money !== before;
    }
    if (!this.pinned) return false;
    const b = this.place(this.pinned);
    if (b || this.landChanged) { this.pinned = null; this.refresh(); }
    return !!b;
  }
  /** Drop what is pinned. */
  cancel(): void {
    this.pinned = null; this.pinPoint = null; this.lineStart = null; this.linePath = [];
    this.refresh();
  }

  /**
   * Place (and pay for) the current tool at `anchor`. Returns the building, or null if blocked. `rot` overrides
   * the ghost's turn for this one placement (null = face the street); undefined uses the ghost's.
   */
  place(anchor: Cell | null = this.hover, rot: number | null | undefined = undefined): Building | null {
    if (!anchor) return null;
    const state = this.grid.state;
    const before = state.resources.money;
    let result: Building | null = null;
    if (this.tool === "boat") {
      const at = this.grid.buildingAt(anchor);
      result = at && buyBoat(state, at) ? at : null;
    } else if (this.tool === "lanternPost") {
      result = addLantern(state, this.grid, anchor) ? this.grid.buildingAt(anchor) : null;
    } else if (this.tool === "landfill") {
      if (addLandfill(state, this.grid, anchor)) { this.onLandfill(anchor); this.landChanged = true; }
    } else if (this.tool === "plantTree") {
      if (plantTree(state, this.grid, anchor)) this.landChanged = true;
    } else if (this.tool === "clearTree") {
      if (clearTree(state, this.grid, anchor)) this.landChanged = true;
    } else {
      result = tryPlace(state, this.grid, this.tool, anchor, this.toolLift, rot === undefined ? this.turns : rot);
    }
    if (result) this.onPlace(this.tool, result, before - state.resources.money);
    this.refresh();
    return result;
  }

  remove(at: Cell | null = this.hover): void {
    if (!at) return;
    const b = this.grid.buildingAt(at);
    if (!b) return;
    const refund = removeBuilding(this.grid.state, this.grid, b);
    this.onRemove(b, refund);
    this.onSelect(null);
    this.refresh();
  }
}

export function costLabel(kind: BuildingKind, stilt = 0, biome: BiomeId = "tidewater"): string {
  const c = placeCost(kind, stilt, biome);
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
    case "street": return "Needs the flats or the beach (paths take the dry hill)";
  }
}
