// Cell model over the terrain, occupancy index, and placement rules. Buildings live in SimState; the Grid is the
// spatial index over them (rebuilt from state on load) plus the fixed terrain classification.
import { SIZE, STILT_LENGTH, TIDE_HI, TIDE_LO } from "../config";
import { BuildingKind, BUILDINGS, PlacementClass } from "./balance";
import { terrainHeight } from "./heightfield";
import { Building, Cell, SimState } from "./state";

/** deep: always underwater. flat: the tidal flats, buildable. high: dry land above the tide. */
export type CellClass = "deep" | "flat" | "high";

/** Cells span i, j in [-HALF, HALF). Cell (i, j) covers x in [i, i+1), z in [j, j+1). */
export const HALF = SIZE / 2;

export const DIRS: readonly Cell[] = [{ i: 1, j: 0 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 0, j: -1 }];

export function inBounds(i: number, j: number): boolean {
  return i >= -HALF && i < HALF && j >= -HALF && j < HALF;
}
export function cellIndex(i: number, j: number): number {
  return (i + HALF) * SIZE + (j + HALF);
}
export function cellCenter(c: Cell): { x: number; z: number } {
  return { x: c.i + 0.5, z: c.j + 0.5 };
}
export function worldToCell(x: number, z: number): Cell {
  return { i: Math.floor(x), j: Math.floor(z) };
}

export class Grid {
  readonly heights = new Float32Array(SIZE * SIZE);
  private readonly classes: CellClass[] = new Array(SIZE * SIZE);
  private readonly occupancy: (Building | null)[] = new Array(SIZE * SIZE).fill(null);

  constructor(public state: SimState) {
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const h = terrainHeight(i + 0.5, j + 0.5);
      const k = cellIndex(i, j);
      this.heights[k] = h;
      this.classes[k] = h < TIDE_LO ? "deep" : h <= TIDE_HI ? "flat" : "high";
    }
    this.rebuild();
  }

  /** Point the index at a (loaded) state and rebuild occupancy from its buildings. */
  attach(state: SimState): void {
    this.state = state;
    this.rebuild();
  }

  private rebuild(): void {
    this.occupancy.fill(null);
    for (const b of Object.values(this.state.buildings)) for (const c of b.cells) this.occupancy[cellIndex(c.i, c.j)] = b;
  }

  heightAt(c: Cell): number { return this.heights[cellIndex(c.i, c.j)]; }
  classAt(c: Cell): CellClass | null { return inBounds(c.i, c.j) ? this.classes[cellIndex(c.i, c.j)] : null; }
  buildingAt(c: Cell): Building | null { return inBounds(c.i, c.j) ? this.occupancy[cellIndex(c.i, c.j)] : null; }
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
    }
  }

  /** Terrain window check for kinds that have one (oyster beds). */
  terrainOk(kind: BuildingKind, cells: Cell[]): boolean {
    const t = BUILDINGS[kind].terrain;
    if (!t) return true;
    return cells.every(c => { const h = this.heightAt(c); return h >= t.min && h <= t.max; });
  }

  /** The cells a building of `kind` anchored at `c` would occupy, or null if that shape can't be formed there. */
  footprint(kind: BuildingKind, c: Cell): Cell[] | null {
    if (!inBounds(c.i, c.j)) return null;
    const def = BUILDINGS[kind];
    if (def.cls === "edge") {
      // Edge pieces sit in deep water against the shore and extend seaward, away from the flat cell they touch.
      if (this.classAt(c) !== "deep") return null;
      for (const d of DIRS) {
        const shore = { i: c.i + d.i, j: c.j + d.j };
        if (this.classAt(shore) !== "flat") continue;
        const cells: Cell[] = [];
        for (let k = 0; k < def.d; k++) cells.push({ i: c.i - d.i * k, j: c.j - d.j * k });
        if (cells.every(x => this.classAt(x) === "deep")) return cells;
      }
      return null;
    }
    const cells: Cell[] = [];
    for (let di = 0; di < def.w; di++) for (let dj = 0; dj < def.d; dj++) {
      const x = { i: c.i + di, j: c.j + dj };
      if (!inBounds(x.i, x.j)) return null;
      cells.push(x);
    }
    return cells;
  }

  canPlace(kind: BuildingKind, cells: Cell[]): boolean {
    return this.classOk(BUILDINGS[kind].cls, cells) && this.terrainOk(kind, cells) && cells.every(c => !this.buildingAt(c));
  }

  /** Deck height a building of `kind` gets on these cells. */
  floorFor(kind: BuildingKind, cells: Cell[]): number {
    const f = BUILDINGS[kind].floor;
    if (f !== "stilts") return f;
    let h = -Infinity;
    for (const c of cells) h = Math.max(h, this.heightAt(c));
    return h + STILT_LENGTH;
  }

  place(kind: BuildingKind, cells: Cell[]): Building {
    const s = this.state;
    const b: Building = {
      id: s.nextId++, kind, cells, floorY: this.floorFor(kind, cells), cut: false, reached: false,
      workers: 0, residents: 0, boats: 0, atSea: false, output: 0, happiness: 1,
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
