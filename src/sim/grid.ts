// Cell model over the terrain, occupancy index, and placement rules. Buildings live in SimState; the Grid is the
// spatial index over them (rebuilt from state on load) plus the fixed terrain classification.
import { CLEARANCE, DRY_TERRAIN, SIZE, SPRING_HI, STILT_MIN, TIDE_HI, TIDE_LO, WALKWAY_SNAP } from "../config";
import { BEACH_MAX_HEIGHT, BuildingKind, BUILDINGS, LANDFILL_HEIGHT, LIFT_MAX, LIFT_STEP, PlacementClass } from "./balance";
import { cellIndex, DIRS, HALF, inBounds } from "./cells";
import { cellClass } from "./heightfield";
import { Island, island } from "./island";
import { isleCell } from "./isle";
import { Building, Cell, SimState } from "./state";

/** deep: always underwater. flat: the tidal flats, buildable. high: dry land above the tide. */
export type CellClass = "deep" | "flat" | "high";

// The lattice helpers live in cells.ts (so the island generator can share them without importing the Grid);
// they are re-exported here because this is where everything else looks for them.
export { cellCenter, cellIndex, DIRS, HALF, inBounds, worldToCell } from "./cells";

export class Grid {
  readonly heights = new Float32Array(SIZE * SIZE);
  private readonly classes: CellClass[] = new Array(SIZE * SIZE);
  private readonly occupancy: (Building | null)[] = new Array(SIZE * SIZE).fill(null);
  /** Cell index → deep? for the field code's hot loops. */
  readonly deep = new Uint8Array(SIZE * SIZE);
  /** Cell index → water at high tide (deep or flat)? */
  readonly water = new Uint8Array(SIZE * SIZE);
  /** Cell index → beach? Sand just above the tide line that touches water. Derived, never built. */
  readonly beach = new Uint8Array(SIZE * SIZE);
  /** Cell index → on the second island (locked until the town has a harbor)? */
  readonly isle = new Uint8Array(SIZE * SIZE);
  /** Bumped whenever the heights change (attach, landfill), so caches keyed on the terrain (the field flows) refresh. */
  terrainVersion = 0;

  constructor(public state: SimState) {
    this.attach(state);
  }

  isBeach(c: Cell): boolean {
    return inBounds(c.i, c.j) && this.beach[cellIndex(c.i, c.j)] === 1;
  }

  /** Does any of `cells` lie on the second island? */
  onIsle(cells: Cell[]): boolean {
    return cells.some(c => inBounds(c.i, c.j) && this.isle[cellIndex(c.i, c.j)] === 1);
  }

  /** The isle opens when the town has a harbor: that is where the ferry runs from. */
  isleOpen(): boolean {
    for (const b of Object.values(this.state.buildings)) if (b.kind === "harbor") return true;
    return false;
  }

  /** Point the index at a (loaded) state and rebuild occupancy from its buildings. */
  attach(state: SimState): void {
    this.state = state;
    this.resetTerrain();
    this.terrainVersion++;
    for (const k of state.landfill) this.applyLandfill({ i: Math.floor(k / SIZE) - HALF, j: (k % SIZE) - HALF });
    this.rebuild();
  }

  /** The ledger's island: its heightfield and tree sites, from `state.world.seed`. */
  get island(): Island { return island(this.state.world.seed); }

  /** Classify every cell from the island's heightfield (landfill is applied on top afterwards). */
  private resetTerrain(): void {
    const height = this.island.height;
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const h = height(i + 0.5, j + 0.5);
      const k = cellIndex(i, j);
      this.heights[k] = h;
      this.isle[k] = isleCell({ i, j }) ? 1 : 0;
      this.classes[k] = cellClass(h);
      this.deep[k] = h < TIDE_LO ? 1 : 0;
      this.water[k] = h <= TIDE_HI ? 1 : 0;
    }
    this.beach.fill(0);
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const k = cellIndex(i, j);
      if (this.classes[k] !== "high" || this.heights[k] > BEACH_MAX_HEIGHT) continue;
      if (this.neighbors({ i, j }).some(n => this.water[cellIndex(n.i, n.j)])) this.beach[k] = 1;
    }
  }

  /** Raise one cell to dry ground. */
  applyLandfill(c: Cell): void {
    const k = cellIndex(c.i, c.j);
    this.terrainVersion++;
    this.heights[k] = LANDFILL_HEIGHT;
    this.classes[k] = "high";
    this.deep[k] = 0;
    this.water[k] = 0;
    this.beach[k] = 0;
  }

  private rebuild(): void {
    this.occupancy.fill(null);
    for (const b of Object.values(this.state.buildings)) for (const c of b.cells) this.occupancy[cellIndex(c.i, c.j)] = b;
  }

  heightAt(c: Cell): number { return this.heights[cellIndex(c.i, c.j)]; }
  classAt(c: Cell): CellClass | null { return inBounds(c.i, c.j) ? this.classes[cellIndex(c.i, c.j)] : null; }
  buildingAt(c: Cell): Building | null { return inBounds(c.i, c.j) ? this.occupancy[cellIndex(c.i, c.j)] : null; }
  /** `buildingAt` for an in-bounds (i, j) pair, for the per-tick loops that must not build cell objects. */
  buildingAtIJ(i: number, j: number): Building | null { return this.occupancy[cellIndex(i, j)]; }
  neighbors(c: Cell): Cell[] {
    return DIRS.map(d => ({ i: c.i + d.i, j: c.j + d.j })).filter(n => inBounds(n.i, n.j));
  }
  private touches(c: Cell, cls: CellClass): boolean {
    return this.neighbors(c).some(n => this.classAt(n) === cls);
  }

  /** Does `cells` satisfy the placement class? Base class on every cell; adjacency on at least one. */
  classOk(cls: PlacementClass, cells: Cell[]): boolean {
    const base = (c: Cell) => this.classAt(c);
    switch (cls) {
      case "flat": return cells.every(c => base(c) === "flat");
      case "deep": return cells.every(c => base(c) === "deep");
      case "high": return cells.every(c => base(c) === "high");
      case "flatOrHigh": return cells.every(c => base(c) === "flat" || base(c) === "high");
      case "flatOrDeep": return cells.every(c => base(c) === "flat" || base(c) === "deep");
      case "shore": return cells.every(c => base(c) === "flat") && cells.some(c => this.touches(c, "high"));
      case "edge": return cells.every(c => base(c) === "deep") && cells.some(c => this.touches(c, "flat"));
      case "beach": return cells.every(c => this.isBeach(c));
      case "highOrEdge": return cells.every(c => base(c) === "high") || this.classOk("edge", cells);
      case "street": return cells.every(c => base(c) === "flat" || (base(c) === "high" && this.heightAt(c) < DRY_TERRAIN));
    }
  }

  /** Terrain window check for kinds that have one (oyster beds). */
  terrainOk(kind: BuildingKind, cells: Cell[]): boolean {
    const t = BUILDINGS[kind].terrain;
    if (!t) return true;
    return cells.every(c => { const h = this.heightAt(c); return h >= t.min && h <= t.max; });
  }

  /** The cells a building of `kind` anchored at `c` would occupy, or null if that shape can't be formed there. */
  footprint(kind: BuildingKind, c: Cell, rot = 0): Cell[] | null {
    if (!inBounds(c.i, c.j)) return null;
    const def = BUILDINGS[kind];
    if (def.cls === "edge") {
      // Edge pieces sit in deep water against the shore: `d` cells seaward from the anchor, `w` cells across it.
      if (this.classAt(c) !== "deep") return null;
      for (const d of DIRS) {
        const shore = { i: c.i + d.i, j: c.j + d.j };
        if (this.classAt(shore) !== "flat") continue;
        const across = { i: d.j, j: -d.i };
        const cells: Cell[] = [];
        for (let k = 0; k < def.d; k++) for (let m = 0; m < def.w; m++) {
          const off = m - Math.floor((def.w - 1) / 2);
          cells.push({ i: c.i - d.i * k + across.i * off, j: c.j - d.j * k + across.j * off });
        }
        if (cells.every(x => inBounds(x.i, x.j) && this.classAt(x) === "deep")) return cells;
      }
      return null;
    }
    const cells: Cell[] = [];
    const w = rot % 2 ? def.d : def.w, d = rot % 2 ? def.w : def.d;
    for (let di = 0; di < w; di++) for (let dj = 0; dj < d; dj++) {
      const x = { i: c.i + di, j: c.j + dj };
      if (!inBounds(x.i, x.j)) return null;
      cells.push(x);
    }
    return cells;
  }

  /**
   * The turn that puts a building's door toward the street: the side of the footprint with the most walkways,
   * piers or markets against it (0 = −z, 1 = −x, 2 = +z, 3 = +x). A footprint that isn't square keeps its shape,
   * so only 0 and 2 are on offer for it. Nothing adjoining: 0.
   */
  facing(cells: Cell[]): number {
    const is = cells.map(c => c.i), js = cells.map(c => c.j);
    const square = Math.max(...is) - Math.min(...is) === Math.max(...js) - Math.min(...js);
    const count = [0, 0, 0, 0];
    const own = new Set(cells.map(c => cellIndex(c.i, c.j)));
    for (const c of cells) for (const [k, d] of [[0, { i: 0, j: -1 }], [1, { i: -1, j: 0 }], [2, { i: 0, j: 1 }], [3, { i: 1, j: 0 }]] as [number, Cell][]) {
      const n = { i: c.i + d.i, j: c.j + d.j };
      if (!inBounds(n.i, n.j) || own.has(cellIndex(n.i, n.j))) continue;
      const b = this.buildingAt(n);
      if (b && BUILDINGS[b.kind].network !== "leaf") count[k]++;
    }
    let best = 0;
    for (const k of square ? [0, 1, 2, 3] : [0, 2]) if (count[k] > count[best]) best = k;
    return best;
  }

  /** Does some cell touch a flat cell carrying a walkway? (Lumber camps must be served from the flats.) */
  /** Does the footprint touch a pier, dock, harbor or walkway — something crew can walk in over? */
  touchesLink(cells: Cell[]): boolean {
    return cells.some(c => this.neighbors(c).some(n => {
      const b = this.buildingAt(n);
      return !!b && BUILDINGS[b.kind].network !== "leaf" && !cells.some(x => x.i === n.i && x.j === n.j);
    }));
  }

  touchesWalkway(cells: Cell[]): boolean {
    return cells.some(c => this.neighbors(c).some(n => {
      const b = this.buildingAt(n);
      return !!b && (b.kind === "walkway" || b.kind === "raisedWalkway" || b.kind === "path");
    }));
  }

  /** Does the town already have one of `kind`? */
  has(kind: BuildingKind): boolean {
    for (const b of Object.values(this.state.buildings)) if (b.kind === kind) return true;
    return false;
  }

  /** Does some cell touch a building of `kind`? */
  touchesKind(cells: Cell[], kind: BuildingKind): boolean {
    return cells.some(c => this.neighbors(c).some(n => this.buildingAt(n)?.kind === kind));
  }

  canPlace(kind: BuildingKind, cells: Cell[]): boolean {
    const def = BUILDINGS[kind];
    return this.classOk(def.cls, cells) && this.terrainOk(kind, cells) && cells.every(c => !this.buildingAt(c))
      && (!def.needsWalkway || this.touchesWalkway(cells)) && (!def.needsLink || this.touchesLink(cells))
      && (!def.requires || this.has(def.requires))
      && (!def.touches || this.touchesKind(cells, def.touches))
      && (!this.onIsle(cells) || this.isleOpen());
  }

  /** Home capacity: the catalog's residents plus one per level above the first. */
  capacityOf(b: Building): number {
    const base = BUILDINGS[b.kind].residents;
    return base > 0 ? base + (b.level - 1) : 0;
  }

  /** Deck height a building of `kind` gets on these cells. */
  /** Deck height for a footprint; `lift` is the player's extra height in LIFT_STEP steps (stilt decks only). */
  floorFor(kind: BuildingKind, cells: Cell[], lift = 0): number {
    const f = BUILDINGS[kind].floor;
    const h = this.groundUnder(cells);
    if (typeof f === "number") return Math.max(f, h + 0.05); // a fixed floor never sinks into a hill
    if (f === "terrain") return h + 0.05;
    if (f === "ground") return Math.max(1.0, h + 0.05);
    // Auto-sized stilts: at least STILT_MIN over the cell and CLEARANCE over the tide the piece must clear — the
    // ordinary high tide for a street, the spring tide for a building. Then a lift (never below), then the snap:
    // rise to the highest neighbouring deck within WALKWAY_SNAP of the safe height so streets run level.
    const safe = Math.max(h + STILT_MIN, (f === "street" ? TIDE_HI : SPRING_HI) + CLEARANCE);
    let floor = safe + Math.max(0, Math.min(LIFT_MAX, lift)) * LIFT_STEP;
    for (const c of cells) for (const n of this.neighbors(c)) {
      const b = this.buildingAt(n);
      if (!b || cells.some(x => x.i === n.i && x.j === n.j)) continue;
      if (b.floorY > floor && b.floorY <= safe + WALKWAY_SNAP) floor = b.floorY;
    }
    return floor;
  }

  /** The highest terrain under a footprint. */
  groundUnder(cells: Cell[]): number {
    let h = -Infinity;
    for (const c of cells) h = Math.max(h, this.heightAt(c));
    return h;
  }

  /** Stilt length a deck at `floor` needs over these cells; 0 for kinds that don't price their stilts. */
  stiltLength(kind: BuildingKind, cells: Cell[], floor: number): number {
    const f = BUILDINGS[kind].floor;
    if (f !== "stilts" && f !== "street") return 0;
    return Math.max(0, floor - this.groundUnder(cells));
  }

  place(kind: BuildingKind, cells: Cell[], lift = 0, rot = 0): Building {
    const s = this.state;
    const b: Building = {
      id: s.nextId++, kind, cells, floorY: this.floorFor(kind, cells, lift), rot: rot & 3, cut: false, reached: false,
      workers: 0, residents: 0, boats: 0, atSea: false, ground: null, output: 0, happiness: 1, progress: 0, stress: 0,
      level: 1, streak: 0, lantern: false, injured: 0, shock: 0, fire: 0, damaged: false,
    };
    for (const c of cells) this.occupancy[cellIndex(c.i, c.j)] = b;
    s.buildings[b.id] = b;
    return b;
  }

  remove(b: Building): void {
    for (const c of b.cells) this.occupancy[cellIndex(c.i, c.j)] = null;
    delete this.state.buildings[b.id];
    this.state.assignments = this.state.assignments.filter(a => a.home !== b.id && a.work !== b.id);
  }

  /** Flat cells within `radius` (Chebyshev) of `cells` whose terrain is above `level`: the exposed flats. */
  exposedFlatsNear(cells: Cell[], radius: number, level: number): number {
    const seen = new Set<number>();
    for (const c of cells) for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
      const i = c.i + di, j = c.j + dj;
      if (!inBounds(i, j)) continue;
      const k = cellIndex(i, j);
      if (seen.has(k)) continue;
      if (this.classes[k] === "flat" && this.heights[k] > level && !this.occupancy[k]) seen.add(k);
    }
    return seen.size;
  }
}
